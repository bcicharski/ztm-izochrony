import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeWalkNet, chordM } from '../js/walknet.js';
import { encodeWalkNet, graphFromNet, netDifference } from '../tools/walknet-codec.mjs';
import { reencodeFile } from '../tools/reencode-walknet.mjs';
import { compareNets, samplePoints, GATE } from '../tools/walknet-ab.mjs';
import { makeWalkRaw, rng } from './helpers.mjs';
import { M_PER_DEG_LAT } from '../js/data.js';

const Q = 1e5;
const mPerLon = M_PER_DEG_LAT * Math.cos(50 * Math.PI / 180);
/** Węzeł w odległości (x, y) metrów od punktu (50, 20). */
const at = (x, y) => [50 + y / M_PER_DEG_LAT, 20 + x / mPerLon];

/** Cięciwa [m] między węzłami podanymi jako [lat, lon] — tak jak widzi ją koder. */
const chordOf = (p, r) => chordM(Math.round(p[0] * Q), Math.round(p[1] * Q), Math.round(r[0] * Q), Math.round(r[1] * Q), Q);

test('v1: plik w dzisiejszym formacie dekoduje się dosłownie jak dotąd', () => {
  // ręcznie spisany plik v1: trójkąt 0-1-2 + pętla przy węźle 2 + krawędź zerowej długości
  const raw = {
    version: 1, quant: 1e5,
    nodes: { dLat: [5000000, 0, 90], dLon: [2000000, 900, -450] },
    edges: { a: [0, 0, 1, 0], b: [1, 2, 1, 0], len: [64, 101, 70, 0] },
  };
  const net = decodeWalkNet(raw);
  assert.equal(net.n, 3);
  assert.deepEqual([...net.lat], [50, 50, 50.0009]);
  assert.deepEqual([...net.lon], [20, 20.009, 20.0045]);
  assert.deepEqual([...net.edgeFrom], [0, 0, 1, 1]);
  assert.deepEqual([...net.edgeTo], [1, 2, 2, 1]);
  // długości to dokładnie tablica z pliku — bez kopiowania i bez przeliczeń
  assert.equal(net.edgeLen, raw.edges.len);
  assert.deepEqual([...net.adjLen], [64, 101, 64, 70, 0, 0, 101, 70]);
});

test('v1 -> v2: ten sam graf (węzły, krawędzie, długości, sąsiedztwo)', () => {
  const rand = rng(7);
  const nodes = Array.from({ length: 60 }, () => at(rand() * 3000, rand() * 3000));
  const edges = [];
  for (let i = 0; i < 150; i++) {
    const a = Math.floor(rand() * 60), b = Math.floor(rand() * 60);
    const chord = a === b ? 0 : chordOf(nodes[a], nodes[b]);
    edges.push([a, b, Math.round(chord * (1 + rand() * 0.6))]);
  }
  const v1 = makeWalkRaw(nodes, edges);
  const net1 = decodeWalkNet(v1);
  const v2 = encodeWalkNet(graphFromNet(net1, Q));
  assert.equal(v2.version, 2);
  assert.ok(v2.edges.res && !v2.edges.len);
  // przez tekst JSON, jak w przeglądarce
  const net2 = decodeWalkNet(JSON.parse(JSON.stringify(v2)));
  assert.equal(netDifference(net1, net2), null);
  // enkoder w trybie v1 odtwarza dokładnie to, co robił budowniczy
  assert.deepEqual(encodeWalkNet(graphFromNet(net1, Q), { version: 1 }), v1);
});

test('v2: krawędź prosta (reszta 0), kręta (duża reszta), zerowa, pętla i krótsza od cięciwy', () => {
  const nodes = [at(0, 0), at(300, 0), at(300, 400), at(0, 400), at(900, 0)];
  const straight = Math.round(chordOf(nodes[0], nodes[1]));
  const edges = [
    [0, 1, straight],  // dokładnie cięciwa
    [1, 2, 1000],      // kręta: cięciwa 400 m
    [2, 3, 0],         // zerowa długość
    [3, 3, 250],       // pętla z węzła do siebie
    [0, 3, 399],       // o 1 m krótsza od cięciwy (zaokrąglenia przy kwantyzacji)
    [1, 4, 2000],
  ];
  const v1 = makeWalkRaw(nodes, edges);
  const net1 = decodeWalkNet(v1);
  const v2 = encodeWalkNet(graphFromNet(net1, Q));
  const res = new Map(v2.edges.res.map((r, i) => [net1.edgeFrom[i] + ',' + net1.edgeTo[i], r]));
  assert.equal(res.get('0,1'), 0);
  assert.ok(res.get('1,2') > 500);
  assert.equal(res.get('2,3'), -300);
  assert.equal(res.get('3,3'), 250);
  assert.ok(res.get('0,3') <= 0);
  const net2 = decodeWalkNet(JSON.parse(JSON.stringify(v2)));
  assert.equal(netDifference(net1, net2), null);
  assert.deepEqual([...net2.edgeLen], [...net1.edgeLen]);
});

test('decodeWalkNet: brak i długości, i reszty to błąd, nie cicha pustka', () => {
  const raw = makeWalkRaw([at(0, 0), at(100, 0)], [[0, 1, 100]]);
  delete raw.edges.len;
  assert.throws(() => decodeWalkNet(raw), /brak długości krawędzi/);
});

test('netDifference: wykrywa różnicę o 1 m', () => {
  const raw = makeWalkRaw([at(0, 0), at(100, 0)], [[0, 1, 100]]);
  const other = makeWalkRaw([at(0, 0), at(100, 0)], [[0, 1, 101]]);
  assert.equal(netDifference(decodeWalkNet(raw), decodeWalkNet(raw)), null);
  assert.match(netDifference(decodeWalkNet(raw), decodeWalkNet(other)), /edgeLen/);
});

/** Siatka 6×6 co 120 m; przystanki to część węzłów. */
function gridCase() {
  const nodes = [], edges = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) nodes.push(at(x * 120, y * 120));
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    const i = y * 6 + x;
    if (x < 5) edges.push([i, i + 1, 120]);
    if (y < 5) edges.push([i, i + 6, 120]);
  }
  const stops = { lat: nodes.filter((_, i) => i % 5 === 0).map(n => n[0]), lon: nodes.filter((_, i) => i % 5 === 0).map(n => n[1]) };
  return { nodes, edges, stops };
}

test('brama A/B: identyczny graf daje różnicę zero i przechodzi; popsuta długość nie przechodzi', () => {
  const { nodes, edges, stops } = gridCase();
  const old = decodeWalkNet(makeWalkRaw(nodes, edges));
  const same = decodeWalkNet(JSON.parse(JSON.stringify(encodeWalkNet(graphFromNet(old, Q)))));
  const ok = compareNets(old, same, stops, { points: 12 });
  assert.equal(ok.pass, true);
  assert.equal(ok.medianS, 0); assert.equal(ok.p95S, 0); assert.equal(ok.maxS, 0);
  assert.ok(ok.stopPairs > 0);
  assert.deepEqual(ok.bandChange, [0, 0, 0, 0, 0]);
  assert.equal(ok.graphDifference, null);

  // co druga krawędź o 30% dłuższa: różnice czasu i metrów muszą przekroczyć progi
  const worse = decodeWalkNet(makeWalkRaw(nodes, edges.map((e, i) => [e[0], e[1], i % 2 ? 156 : 120])));
  const bad = compareNets(old, worse, stops, { points: 12 });
  assert.equal(bad.pass, false);
  assert.ok(bad.p95S > GATE.p95S || bad.bandChange.some(c => c > GATE.bandChange));
});

test('brama A/B: próba jest deterministyczna', () => {
  const { stops } = gridCase();
  assert.deepEqual(samplePoints(stops, 10), samplePoints(stops, 10));
});

test('reencodeFile: na sucho nie zmienia pliku; --write podmienia atomowo i nie zostawia śmieci', () => {
  const { nodes, edges } = gridCase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walknet-'));
  try {
    const file = path.join(dir, 'walknet.json');
    fs.writeFileSync(file, JSON.stringify(makeWalkRaw(nodes, edges)));
    const before = fs.readFileSync(file);

    const dry = reencodeFile(file);
    assert.equal(dry.written, false);
    assert.deepEqual(fs.readFileSync(file), before, 'próba na sucho nie rusza pliku');

    const done = reencodeFile(file, { write: true });
    assert.equal(done.written, true);
    assert.deepEqual(fs.readdirSync(dir), ['walknet.json'], 'brak pliku tymczasowego');
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after.version, 2);
    assert.equal(netDifference(decodeWalkNet(makeWalkRaw(nodes, edges)), decodeWalkNet(after)), null);

    const again = reencodeFile(file, { write: true });
    assert.equal(again.skipped, true);
    assert.equal(again.written, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
