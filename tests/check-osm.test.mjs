import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkWalkNet, checkWater, checkBridges, readJson, run, statsTable, LIMITS } from '../tools/check-osm.mjs';

const TODAY = new Date('2026-11-20T12:00:00Z');
const BBOX = [52.0, 21.0, 52.2, 21.3]; // [s, w, n, e]
const Q = 1e5;
const q = v => Math.round(v * Q);

/** Koduje graf do formatu walknet.json (zapis różnicowy, jak build-walknet.mjs). */
function encodeNet(nodes, edges) {
  const qLat = nodes.map(([la]) => q(la)), qLon = nodes.map(([, lo]) => q(lo));
  const sorted = [...edges].sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
  return {
    version: 1, quant: Q,
    nodes: { dLat: qLat.map((v, i) => (i ? v - qLat[i - 1] : v)), dLon: qLon.map((v, i) => (i ? v - qLon[i - 1] : v)) },
    edges: { a: sorted.map((e, i) => (i ? e[0] - sorted[i - 1][0] : e[0])), b: sorted.map(e => e[1] - e[0]), len: sorted.map(e => e[2]) },
  };
}

/** Siatka k x k węzłów rozpięta na prostokącie [s, w, n, e], połączona krawędziami. */
function lattice(rect, k = 100, offset = 0) {
  const [s, w, n, e] = rect;
  const nodes = [], edges = [];
  for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) nodes.push([s + (n - s) * y / (k - 1), w + (e - w) * x / (k - 1)]);
  for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
    const i = offset + y * k + x;
    if (x + 1 < k) edges.push([i, i + 1, 100]);
    if (y + 1 < k) edges.push([i, i + k, 100]);
  }
  return { nodes, edges };
}
const margin = (b, d = 0.01) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
const goodNet = () => { const { nodes, edges } = lattice(margin(BBOX, 0.001)); return encodeNet(nodes, edges); };
const ring = (lat, lon, d = 0.005) => [[lat, lon], [lat, lon + d], [lat + d, lon + d], [lat + d, lon]].map(([a, b]) => [q(a), q(b)]);
const goodWater = () => ({ polys: [ring(52.05, 21.05), ring(52.1, 21.15)], lines: [[[q(52.1), q(21.0)], [q(52.12), q(21.2)]]] });
const goodBridges = () => ({ lines: [[[q(52.1), q(21.1)], [q(52.1), q(21.101)]], [[q(52.12), q(21.1)], [q(52.121), q(21.1)]]] });
const has = (findings, re) => findings.some(f => re.test(f));

test('walknet: poprawny graf w bboxie = zero zgłoszeń i pełne pokrycie', () => {
  const r = checkWalkNet(goodNet(), BBOX);
  assert.deepEqual(r.findings, []);
  assert.equal(r.metrics.occupancy, 1);
  assert.ok(r.metrics.inBboxShare > 0.9);
  assert.equal(r.metrics.mainShare, 1);
});

test('walknet: graf poza gridBbox (inny prostokąt, ale w Polsce) = błąd spójności z bboxem', () => {
  const shifted = lattice([53.0, 21.0, 53.2, 21.3]);
  const r = checkWalkNet(encodeNet(shifted.nodes, shifted.edges), BBOX);
  assert.ok(has(r.findings, /BŁĄD.*w gridBbox/), r.findings.join('\n'));
  assert.equal(r.metrics.inBboxShare, 0);
});

test('walknet: graf pokrywający tylko część bboxa = błąd pokrycia (węzły w bboxie, ale jest ich za mało)', () => {
  const [s, w, n, e] = BBOX;
  const half = lattice([s, w, n, w + (e - w) * 0.3]); // tylko zachodnie 30% bboxa
  const r = checkWalkNet(encodeNet(half.nodes, half.edges), BBOX);
  assert.ok(r.metrics.inBboxShare > LIMITS.nodesInBboxMin, 'sam udział w bboxie by nie wykrył');
  assert.ok(has(r.findings, /komórek siatki/), r.findings.join('\n'));
  assert.ok(has(r.findings, /rozpiętość grafu/), r.findings.join('\n'));
});

test('walknet: puste tablice = błąd 0 węzłów i 0 krawędzi', () => {
  const r = checkWalkNet(encodeNet([], []), BBOX);
  assert.ok(has(r.findings, /0 węzłów/));
  assert.ok(has(r.findings, /0 krawędzi/));
});

test('walknet: węzły bez krawędzi = błąd 0 krawędzi', () => {
  const { nodes } = lattice(margin(BBOX, 0.001), 5);
  assert.ok(has(checkWalkNet(encodeNet(nodes, []), BBOX).findings, /0 krawędzi/));
});

test('walknet: współrzędne NaN i brak liczb w dLat = błąd NaN', () => {
  const raw = goodNet();
  raw.nodes.dLat[5] = 'x';
  const r = checkWalkNet(raw, BBOX);
  assert.ok(has(r.findings, /NaN/), r.findings.join('\n'));
});

test('walknet: węzły poza Polską = błąd', () => {
  const far = lattice([10.0, 21.0, 10.2, 21.3]);
  const r = checkWalkNet(encodeNet(far.nodes, far.edges), BBOX);
  assert.ok(has(r.findings, /poza Polską/), r.findings.join('\n'));
});

test('walknet: brak kluczy, różne długości tablic i zły typ = błąd bez wyjątku', () => {
  assert.ok(has(checkWalkNet({}, BBOX).findings, /brak tablic/));
  assert.ok(has(checkWalkNet(null, BBOX).findings, /brak tablic/));
  assert.ok(has(checkWalkNet({ nodes: { dLat: [1], dLon: [1] }, edges: { a: 1 } }, BBOX).findings, /brak tablic/));
  const raw = goodNet();
  raw.nodes.dLon.pop();
  assert.ok(has(checkWalkNet(raw, BBOX).findings, /różnej długości/));
  const raw2 = goodNet();
  raw2.edges.len.pop();
  assert.ok(has(checkWalkNet(raw2, BBOX).findings, /różnej długości/));
});

test('walknet: indeks krawędzi poza zakresem i ujemna długość = błąd', () => {
  const raw = goodNet();
  raw.edges.b[3] = 10_000_000;
  assert.ok(has(checkWalkNet(raw, BBOX).findings, /indeksem węzła poza zakresem/));
  const raw2 = goodNet();
  raw2.edges.len[0] = -5;
  assert.ok(has(checkWalkNet(raw2, BBOX).findings, /ujemną długością/));
});

test('walknet: węzeł izolowany (zapisany bez krawędzi) = błąd', () => {
  const { nodes, edges } = lattice(margin(BBOX, 0.001), 60);
  nodes.push([52.1, 21.15]); // dodatkowy węzeł, do którego nic nie prowadzi
  const r = checkWalkNet(encodeNet(nodes, edges), BBOX);
  assert.ok(has(r.findings, /1 węzłów izolowanych/), r.findings.join('\n'));
});

test('walknet: graf rozbity na dwie połowy = ostrzeżenie o spójnej składowej', () => {
  const a = lattice(margin(BBOX, 0.001), 60);
  const b = lattice(margin(BBOX, 0.0015), 60);
  const edges = [...a.edges, ...b.edges.map(([x, y, l]) => [x + 3600, y + 3600, l])];
  const r = checkWalkNet(encodeNet([...a.nodes, ...b.nodes], edges), BBOX);
  assert.ok(r.metrics.mainShare <= 0.5 + 1e-9);
  assert.ok(has(r.findings, /^OSTRZEŻENIE.*spójna składowa/), r.findings.join('\n'));
});

test('woda: poprawna = zero zgłoszeń', () => {
  const r = checkWater(goodWater(), BBOX);
  assert.deepEqual(r.findings, []);
  assert.equal(r.metrics.inBboxShare, 1);
});

test('woda: brak polys, puste polys, uszkodzony kształt = błąd', () => {
  assert.ok(has(checkWater({}, BBOX).findings, /brak tablicy polys/));
  assert.ok(has(checkWater(null, BBOX).findings, /brak tablicy polys/));
  assert.ok(has(checkWater({ polys: [], lines: [] }, BBOX).findings, /0 poligonów/));
  assert.ok(has(checkWater({ polys: [[1, 2, 3]], lines: [] }, BBOX).findings, /złym kształcie/));
  assert.ok(has(checkWater({ polys: [ring(52.1, 21.1)], lines: 'x' }, BBOX).findings, /lines nie jest tablicą/));
});

test('woda: wody brak w gridBbox (inne miejsce), NaN i punkty poza Polską = błąd', () => {
  const far = { polys: [ring(53.5, 21.1)], lines: [] };
  assert.ok(has(checkWater(far, BBOX).findings, /w gridBbox/));
  const nan = goodWater(); nan.polys[0][1][0] = null;
  assert.ok(has(checkWater(nan, BBOX).findings, /NaN/));
  const out = { polys: [ring(10, 21.1)], lines: [] };
  assert.ok(has(checkWater(out, BBOX).findings, /poza Polską/));
});

test('woda: poligon <4 punktów i linia <2 punkty = błąd; woda w bboxie tylko częściowo jest dozwolona', () => {
  assert.ok(has(checkWater({ polys: [ring(52.1, 21.1).slice(0, 3)], lines: [] }, BBOX).findings, /krótszych niż 4/));
  assert.ok(has(checkWater({ polys: [ring(52.1, 21.1)], lines: [[[q(52.1), q(21.1)]]] }, BBOX).findings, /krótszych niż 2/));
  // rzeka wystająca daleko poza bbox: ~30% punktów w środku (Zielona Góra: 31%) — bez zgłoszenia
  const wide = { polys: [ring(52.1, 21.1), ring(52.5, 22.0), ring(52.6, 22.1)], lines: [] };
  assert.ok(checkWater(wide, BBOX).metrics.inBboxShare < 0.5);
  assert.deepEqual(checkWater(wide, BBOX).findings, []);
});

test('mosty: poprawne = zero zgłoszeń; brak lines, puste lines, poza bboxem = błąd', () => {
  assert.deepEqual(checkBridges(goodBridges(), BBOX).findings, []);
  assert.ok(has(checkBridges({}, BBOX).findings, /brak tablicy lines/));
  assert.ok(has(checkBridges({ lines: [] }, BBOX).findings, /0 linii mostów/));
  const far = { lines: [[[q(53.5), q(21.1)], [q(53.5), q(21.101)]]] };
  assert.ok(has(checkBridges(far, BBOX).findings, /w gridBbox/));
  const one = { lines: [[[q(52.1), q(21.1)]]] };
  assert.ok(has(checkBridges(one, BBOX).findings, /krótszych niż 2/));
  const nan = goodBridges(); nan.lines[0][0][1] = 'a';
  assert.ok(has(checkBridges(nan, BBOX).findings, /NaN/));
});

test('readJson: brak pliku, pusty plik, uszkodzony JSON, poprawny', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-json-'));
  const f = (name, txt) => { const p = path.join(dir, name); fs.writeFileSync(p, txt); return p; };
  assert.equal(readJson(path.join(dir, 'nie-ma.json')).error, 'brak pliku');
  assert.equal(readJson(f('a.json', '  \n')).error, 'plik pusty');
  assert.match(readJson(f('b.json', '{"polys": [')).error, /uszkodzony JSON/);
  assert.deepEqual(readJson(f('c.json', '{"a":1}')).data, { a: 1 });
});

// --- run: cały kontroler na syntetycznym katalogu data/ ------------------------

function makeRoot(cities) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-run-'));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'cities.json'), JSON.stringify(Object.fromEntries(
    Object.keys(cities).map(k => [k, { name: k.toUpperCase(), bbox: BBOX, ...cities[k] }]))));
  for (const k of Object.keys(cities)) fs.mkdirSync(path.join(root, 'data', k));
  return root;
}
const put = (root, city, file, data) => fs.writeFileSync(path.join(root, 'data', city, `${file}.json`), typeof data === 'string' ? data : JSON.stringify(data));
const putGood = (root, city) => { put(root, city, 'walknet', goodNet()); put(root, city, 'water', goodWater()); put(root, city, 'bridges', goodBridges()); };

test('run: komplet poprawnych danych = kod 0, tabela wieku zawsze w raporcie', () => {
  const root = makeRoot({ a: {}, b: {} });
  putGood(root, 'a'); putGood(root, 'b');
  const r = run([], { root, today: TODAY });
  assert.equal(r.code, 0);
  assert.match(r.out, /Wszystkie 2 miast: dane OSM spójne/);
  assert.match(r.out, /Wiek danych/);
  assert.match(r.out, /\| a \| \d+ \| \d+ \| \d+ \|/);
});

test('run: stary plik NIE przewraca kontroli, ale wiek jest raportowany', () => {
  const root = makeRoot({ a: {} });
  putGood(root, 'a');
  const old = new Date('2025-01-01T00:00:00Z');
  for (const f of ['walknet', 'water', 'bridges']) fs.utimesSync(path.join(root, 'data', 'a', `${f}.json`), old, old);
  const r = run([], { root, today: TODAY });
  assert.equal(r.code, 0);
  assert.match(r.out, /\| a \| 688 \| 688 \| 688 \|/); // 2025-01-01 -> 2026-11-20
});

test('run: brakujący, pusty i uszkodzony plik = kod 1 z nazwą miasta i pliku; reszta miast czysta', () => {
  const root = makeRoot({ ok: {}, brak: {}, pusty: {}, zepsuty: {} });
  putGood(root, 'ok');
  putGood(root, 'brak'); fs.rmSync(path.join(root, 'data', 'brak', 'water.json'));
  putGood(root, 'pusty'); put(root, 'pusty', 'walknet', '');
  putGood(root, 'zepsuty'); put(root, 'zepsuty', 'bridges', '{"lines": [[');
  const r = run([], { root, today: TODAY });
  assert.equal(r.code, 1);
  assert.match(r.out, /Problemy w 3 z 4 miast/);
  assert.match(r.out, /\*\*BRAK\*\* \(`brak`\)\n {2}- BŁĄD: water\.json: brak pliku/);
  assert.match(r.out, /walknet\.json: plik pusty/);
  assert.match(r.out, /bridges\.json: uszkodzony JSON/);
  assert.doesNotMatch(r.out, /\*\*OK\*\*/);
  // brakujący plik ma w tabeli wieku myślnik
  assert.match(r.out, /\| brak \| \d+ \| — \| \d+ \|/);
});

test('run: gridBbox ma pierwszeństwo przed bbox; graf z bboxa, a nie z gridBbox = błąd', () => {
  const root = makeRoot({ a: { gridBbox: [53.0, 21.0, 53.2, 21.3] } }); // dane syntetyczne leżą w BBOX
  putGood(root, 'a');
  const r = run([], { root, today: TODAY });
  assert.equal(r.code, 1);
  assert.match(r.out, /walknet\.json: tylko 0% węzłów w gridBbox/);
});

test('run: miasto bez poprawnego bboxa w cities.json = błąd, nie wyjątek', () => {
  const root = makeRoot({ a: { bbox: null } });
  putGood(root, 'a');
  const r = run([], { root, today: TODAY });
  assert.equal(r.code, 1);
  assert.match(r.out, /brak poprawnego gridBbox\/bbox/);
});

test('run: argumenty wybierają miasta; nieznane miasto = kod 1', () => {
  const root = makeRoot({ a: {}, b: {} });
  putGood(root, 'a'); // b bez plików
  assert.equal(run(['a'], { root, today: TODAY }).code, 0);
  assert.equal(run(['b'], { root, today: TODAY }).code, 1);
  const bad = run(['x'], { root, today: TODAY });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /Nieznane miasto: x/);
});

test('run --stats: tabela rozkładów z najgorszym miastem', () => {
  const root = makeRoot({ a: {}, b: {} });
  putGood(root, 'a'); putGood(root, 'b');
  const r = run(['--stats'], { root, today: TODAY });
  assert.match(r.out, /Rozkłady zmierzonych wielkości/);
  assert.match(r.out, /\| pokrycie bboxa \(komórki 10x10\) \| 100% \| 100% \| 100% \|/);
  assert.match(statsTable([]), /\| — \| — \| — \| — \|/);
});

test('run --ignore-warnings: samo ostrzeżenie = kod 0 (nadal drukowane), błąd = kod 1', () => {
  const root = makeRoot({ a: {}, b: {} });
  // graf rozbity na dwie połowy: tylko ostrzeżenie o składowej
  const a = lattice(margin(BBOX, 0.001), 60);
  const b = lattice(margin(BBOX, 0.0015), 60);
  put(root, 'a', 'walknet', encodeNet([...a.nodes, ...b.nodes], [...a.edges, ...b.edges.map(([x, y, l]) => [x + 3600, y + 3600, l])]));
  put(root, 'a', 'water', goodWater()); put(root, 'a', 'bridges', goodBridges());
  putGood(root, 'b');
  const plain = run(['a'], { root, today: TODAY });
  assert.equal(plain.code, 1);
  const soft = run(['a', '--ignore-warnings'], { root, today: TODAY });
  assert.equal(soft.code, 0);
  assert.match(soft.out, /OSTRZEŻENIE.*spójna składowa/);
  // błąd nadal wywraca
  fs.rmSync(path.join(root, 'data', 'b', 'water.json'));
  const hard = run(['--ignore-warnings'], { root, today: TODAY });
  assert.equal(hard.code, 1);
  assert.match(hard.out, /water\.json: brak pliku/);
});

test('wiek danych: z pliku stanu (ostatnie powodzenie), nie z mtime; bez wpisu awaryjnie mtime z adnotacją', () => {
  const root = makeRoot({ a: {}, b: {} });
  putGood(root, 'a'); putGood(root, 'b');
  // mtime wszystkich plików to „teraz" (jak po actions/checkout), więc stary wiek może pochodzić tylko ze stanu
  fs.writeFileSync(path.join(root, 'data', 'osm-state.json'), JSON.stringify({
    version: 1, cities: { a: { lastAttempt: '2026-11-18', lastSuccess: '2026-08-12', result: 'ok' }, duch: { lastSuccess: '2000-01-01' } },
  }));
  const r = run([], { root, today: TODAY });
  assert.match(r.out, /\| a \| 100 \| 100 \| 100 \| stan \|/); // 2026-08-12 -> 2026-11-20 = 100 dni
  assert.match(r.out, /\| b \| \d+ \| \d+ \| \d+ \| mtime \|/);
  assert.match(r.out, /w CI to data pobrania repozytorium/);
});

test('wiek danych: nieudana próba bez powodzenia nie daje wieku ze stanu (mtime awaryjnie); brak pliku stanu jest tolerowany', () => {
  const root = makeRoot({ a: {} });
  putGood(root, 'a');
  fs.writeFileSync(path.join(root, 'data', 'osm-state.json'), JSON.stringify({ cities: { a: { lastAttempt: '2026-11-19', result: 'gate' } } }));
  assert.match(run([], { root, today: TODAY }).out, /\| a \| \d+ \| \d+ \| \d+ \| mtime \|/);
  fs.rmSync(path.join(root, 'data', 'osm-state.json'));
  assert.equal(run([], { root, today: TODAY }).code, 0);
});
