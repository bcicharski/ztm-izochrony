#!/usr/bin/env node
/**
 * Kontrola spójności i wieku danych OSM: data/<miasto>/walknet.json, water.json
 * i bridges.json. Tylko czyta — niczego nie przelicza ani nie nadpisuje.
 *
 * Po co: tych trzech plików nie odświeża żaden workflow (build-walknet/-water/
 * -bridges są odpalane ręcznie, a tools/check-data.mjs ich nie dotyka), więc
 * uszkodzony, pusty albo niezgodny z `gridBbox` plik wyszedłby dopiero jako
 * błędna izochrona na produkcji. Kontroler mówi też, kiedy odświeżenie jest
 * potrzebne — sam wiek pliku NIE jest błędem, tylko jest raportowany.
 *
 * Sprawdza dla każdego miasta z data/cities.json:
 *  1. obecność i parsowalność trzech plików (każde miasto ma wszystkie trzy —
 *     cities.json nie ma flagi „bez wody", a build-water nie pomija żadnego miasta);
 *  2. dekodowanie: walknet.json przechodzi przez prawdziwy `decodeWalkNet`
 *     z js/walknet.js, czyli dokładnie to, co robi przeglądarka (water.json
 *     i bridges.json front dekoduje wprost w fetch() w js/data.js — brak funkcji
 *     do wywołania, więc tu odtworzony jest kształt `{polys, lines}` / `{lines}`);
 *  3. spójność z `gridBbox` (albo `bbox`): udział węzłów w bboxie, pokrycie
 *     bboxa siatką komórek, udział punktów wody i mostów w bboxie;
 *  4. sanity: brak NaN, współrzędne w Polsce, liczby > 0, indeksy krawędzi
 *     w zakresie, brak węzłów izolowanych, udział największej spójnej składowej;
 *  5. wiek plików (mtime) — zawsze w raporcie.
 *
 * Progi i asercje wyznaczone pomiarem na 18 miastach z data/ (2026-11-20),
 * rozkłady w komentarzach przy LIMITS. Tam, gdzie pomiar był identyczny
 * we wszystkich miastach, jest asercja (bez progu).
 *
 * Wynik w Markdown na stdout; kod wyjścia 1, gdy jest cokolwiek do zgłoszenia
 * (jak check-data.mjs), 0 gdy wszystko w porządku.
 *
 * Użycie: node tools/check-osm.mjs [miasto ...] [--stats] [--ignore-warnings]
 *   miasto  klucze z data/cities.json; bez nich — wszystkie miasta.
 *   --ignore-warnings  kod wyjścia liczy tylko BŁĘDY; ostrzeżenia nadal się drukują
 *           (krok w ci.yml: przeliczenie OSM nie może blokować CI ostrzeżeniem).
 *   --stats tabela rozkładów zmierzonych wielkości (min/mediana/max/najgorsze
 *           miasto) — do ponownej kalibracji progów.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeWalkNet } from '../js/walknet.js';

/**
 * Progi. Pomiar 2026-11-20, 18 miast (min / mediana / max, najgorsze miasto):
 *  - udział węzłów grafu w gridBbox: 98,9% / 99,7% / 99,8% (Opole) —
 *    sieć jest pobierana zapytaniem po tym bboxie, a Overpass zwraca też węzły
 *    tuż za krawędzią; poniżej 90% graf pochodzi z innego prostokąta;
 *  - pokrycie bboxa: siatka 10x10, udział zajętych komórek: 0,76 / 1,00 / 1,00
 *    (Trójmiasto — morze) — poniżej 0,5 graf pokrywa tylko fragment bboxa;
 *  - rozpiętość węzłów / rozpiętość bboxa, mniejsza z dwóch osi: 1,065 / 1,147 /
 *    1,300 (Warszawa); zawsze >1, bo węzły wystają za bbox — poniżej 0,9 brakuje
 *    całego brzegu;
 *  - udział największej spójnej składowej: 94,7% / 97,4% / 98,8% (Toruń);
 *    poniżej 85% graf jest rozbity (build zakłada 2–3% odprysków);
 *  - udział punktów mostów w gridBbox: 99,4% / 100% / 100% (Gorzów) — mosty
 *    pobiera zapytanie po tym samym bboxie; poniżej 95% to inny prostokąt;
 *  - udział punktów wody (poligony + linie) w gridBbox: 31,4% / 82,6% / 93,8%
 *    (Zielona Góra) — szeroki rozkład, bo rzeki i jeziora wystają daleko poza
 *    bbox; próg 10% (trzykrotny zapas) łapie tylko wodę z innego miejsca.
 * Asercje (identyczne we wszystkich 18 miastach): wszystkie trzy pliki obecne;
 * 0 NaN; 0 współrzędnych poza Polską; 0 krawędzi z indeksem poza zakresem;
 * 0 węzłów izolowanych; poligon wody >= 4 punkty, linia wody/mostu >= 2 punkty;
 * >= 1 poligon wody; >= 1 linia mostu.
 * Zerowa długość krawędzi i pętle (a == b) występują w KAŻDYM mieście (po kilka
 * do kilkuset) — to cecha kontrakcji grafu, nie błąd, więc ich nie sprawdzamy.
 */
export const LIMITS = {
  nodesInBboxMin: 0.90,
  occupancyGrid: 10,
  occupancyMin: 0.5,
  spanRatioMin: 0.9,
  mainShareMin: 0.85,
  bridgesInBboxMin: 0.95,
  waterInBboxMin: 0.10,
};

/** Prostokąt Polski z zapasem (kraj: ok. 49,0–54,84 N, 14,12–24,15 E). */
export const POLAND = { latMin: 48.9, latMax: 55.0, lonMin: 14.0, lonMax: 24.2 };

const FILES = ['walknet', 'water', 'bridges'];
const DAY_MS = 86400e3;

const inPoland = (lat, lon) =>
  lat >= POLAND.latMin && lat <= POLAND.latMax && lon >= POLAND.lonMin && lon <= POLAND.lonMax;
const pct = x => `${Math.round(x * 1000) / 10}%`;
const err = text => `BŁĄD: ${text}`;
const warn = text => `OSTRZEŻENIE: ${text}`;
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Czyta i parsuje JSON; zwraca { data } albo { error } (brak pliku / zły JSON). */
export function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { error: 'brak pliku' }; }
  if (!text.trim()) return { error: 'plik pusty' };
  try { return { data: JSON.parse(text) }; } catch (e) { return { error: `uszkodzony JSON (${e.message})` }; }
}

/**
 * Sieć piesza: dekoduje prawdziwym `decodeWalkNet` i liczy metryki.
 * @param {object} raw   zawartość walknet.json
 * @param {number[]} bbox [s, w, n, e]
 * @returns {{findings: string[], metrics: object}}
 */
export function checkWalkNet(raw, bbox) {
  const findings = [];
  const metrics = {};
  const nodes = raw?.nodes, edges = raw?.edges;
  if (!nodes || !edges || ![nodes.dLat, nodes.dLon, edges.a, edges.b, edges.len].every(Array.isArray)) {
    findings.push(err('walknet.json: brak tablic nodes.dLat/dLon albo edges.a/b/len'));
    return { findings, metrics };
  }
  const n = nodes.dLat.length, m = edges.a.length;
  metrics.nodes = n; metrics.edges = m;
  if (nodes.dLon.length !== n) findings.push(err(`walknet.json: nodes.dLat (${n}) i nodes.dLon (${nodes.dLon.length}) różnej długości`));
  if (edges.b.length !== m || edges.len.length !== m) findings.push(err(`walknet.json: edges.a/b/len różnej długości (${m}/${edges.b.length}/${edges.len.length})`));
  if (n === 0) findings.push(err('walknet.json: 0 węzłów'));
  if (m === 0) findings.push(err('walknet.json: 0 krawędzi'));
  if (findings.length) return { findings, metrics };

  let net;
  try { net = decodeWalkNet(raw); } catch (e) {
    findings.push(err(`walknet.json: decodeWalkNet odrzucił plik (${e.message})`));
    return { findings, metrics };
  }

  const [s, w, bn, e] = bbox;
  let nan = 0, outPoland = 0, inBbox = 0, main = 0, isolated = 0;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const G = LIMITS.occupancyGrid;
  const cells = new Set();
  for (let i = 0; i < n; i++) {
    const la = net.lat[i], lo = net.lon[i];
    if (!Number.isFinite(la) || !Number.isFinite(lo)) { nan++; continue; }
    if (!inPoland(la, lo)) outPoland++;
    if (la >= s && la <= bn && lo >= w && lo <= e) inBbox++;
    if (net.main[i]) main++;
    if (net.off[i + 1] === net.off[i]) isolated++;
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
    const cx = Math.min(G - 1, Math.max(0, Math.floor((lo - w) / (e - w) * G)));
    const cy = Math.min(G - 1, Math.max(0, Math.floor((la - s) / (bn - s) * G)));
    cells.add(cy * G + cx);
  }
  let badEdges = 0, badLen = 0;
  for (let i = 0; i < m; i++) {
    const a = net.edgeFrom[i], b = net.edgeTo[i];
    if (!(a >= 0 && a < n && b >= 0 && b < n)) badEdges++;
    if (!isNum(raw.edges.len[i]) || raw.edges.len[i] < 0) badLen++;
  }

  if (nan) findings.push(err(`walknet.json: ${nan} węzłów ze współrzędną NaN`));
  if (outPoland) findings.push(err(`walknet.json: ${outPoland} węzłów poza Polską`));
  if (badEdges) findings.push(err(`walknet.json: ${badEdges} krawędzi z indeksem węzła poza zakresem`));
  if (badLen) findings.push(err(`walknet.json: ${badLen} krawędzi z nieliczbową lub ujemną długością`));
  if (isolated) findings.push(err(`walknet.json: ${isolated} węzłów izolowanych (build zapisuje tylko węzły z krawędzią)`));

  const valid = n - nan;
  if (valid > 0) {
    metrics.inBboxShare = inBbox / valid;
    metrics.mainShare = main / valid;
    metrics.occupancy = cells.size / (G * G);
    metrics.spanRatio = Math.min((maxLat - minLat) / (bn - s), (maxLon - minLon) / (e - w));
    if (metrics.inBboxShare < LIMITS.nodesInBboxMin) findings.push(err(`walknet.json: tylko ${pct(metrics.inBboxShare)} węzłów w gridBbox (min ${pct(LIMITS.nodesInBboxMin)}) — graf z innego prostokąta niż w cities.json`));
    if (metrics.occupancy < LIMITS.occupancyMin) findings.push(err(`walknet.json: graf zajmuje ${pct(metrics.occupancy)} komórek siatki ${G}x${G} bboxa (min ${pct(LIMITS.occupancyMin)}) — pokrywa tylko fragment`));
    if (metrics.spanRatio < LIMITS.spanRatioMin) findings.push(err(`walknet.json: rozpiętość grafu to ${pct(metrics.spanRatio)} rozpiętości bboxa (min ${pct(LIMITS.spanRatioMin)})`));
    if (metrics.mainShare < LIMITS.mainShareMin) findings.push(warn(`walknet.json: największa spójna składowa to ${pct(metrics.mainShare)} węzłów (min ${pct(LIMITS.mainShareMin)}) — graf mocno rozbity`));
  }
  return { findings, metrics };
}

/** Wspólna kontrola listy linii/pierścieni `[[lat*1e5, lon*1e5], ...]`. */
function scanRings(list, minPoints, bbox, label, findings) {
  const [s, w, n, e] = bbox;
  let pts = 0, inBbox = 0, nan = 0, outPoland = 0, short = 0, malformed = 0;
  for (const ring of list) {
    if (!Array.isArray(ring)) { malformed++; continue; }
    if (ring.length < minPoints) short++;
    for (const p of ring) {
      if (!Array.isArray(p) || p.length !== 2) { malformed++; continue; }
      pts++;
      const la = p[0] / 1e5, lo = p[1] / 1e5;
      if (!isNum(p[0]) || !isNum(p[1])) { nan++; continue; }
      if (!inPoland(la, lo)) outPoland++;
      if (la >= s && la <= n && lo >= w && lo <= e) inBbox++;
    }
  }
  if (malformed) findings.push(err(`${label}: ${malformed} elementów o złym kształcie (oczekiwano [lat, lon])`));
  if (nan) findings.push(err(`${label}: ${nan} punktów ze współrzędną NaN lub nieliczbową`));
  if (outPoland) findings.push(err(`${label}: ${outPoland} punktów poza Polską`));
  if (short) findings.push(err(`${label}: ${short} elementów krótszych niż ${minPoints} punkty`));
  return { pts, inBbox, valid: pts - nan };
}

/**
 * Woda: `{ polys, lines }` jak w loadWater (js/data.js).
 * @returns {{findings: string[], metrics: object}}
 */
export function checkWater(raw, bbox) {
  const findings = [];
  const metrics = {};
  if (!raw || !Array.isArray(raw.polys) || (raw.lines != null && !Array.isArray(raw.lines))) {
    findings.push(err('water.json: brak tablicy polys (albo lines nie jest tablicą)'));
    return { findings, metrics };
  }
  const lines = raw.lines ?? [];
  metrics.polys = raw.polys.length; metrics.lines = lines.length;
  if (!raw.polys.length) findings.push(err('water.json: 0 poligonów wody'));
  const a = scanRings(raw.polys, 4, bbox, 'water.json (poligony)', findings);
  const b = scanRings(lines, 2, bbox, 'water.json (linie)', findings);
  const valid = a.valid + b.valid;
  if (valid > 0) {
    metrics.inBboxShare = (a.inBbox + b.inBbox) / valid;
    if (metrics.inBboxShare < LIMITS.waterInBboxMin) findings.push(err(`water.json: tylko ${pct(metrics.inBboxShare)} punktów w gridBbox (min ${pct(LIMITS.waterInBboxMin)}) — woda z innego miejsca niż w cities.json`));
  }
  return { findings, metrics };
}

/**
 * Mosty: `{ lines }` jak w loadBridges (js/data.js).
 * @returns {{findings: string[], metrics: object}}
 */
export function checkBridges(raw, bbox) {
  const findings = [];
  const metrics = {};
  if (!raw || !Array.isArray(raw.lines)) {
    findings.push(err('bridges.json: brak tablicy lines (front rzuciłby wyjątek przy raw.lines.map)'));
    return { findings, metrics };
  }
  metrics.lines = raw.lines.length;
  if (!raw.lines.length) findings.push(err('bridges.json: 0 linii mostów'));
  const r = scanRings(raw.lines, 2, bbox, 'bridges.json', findings);
  if (r.valid > 0) {
    metrics.inBboxShare = r.inBbox / r.valid;
    if (metrics.inBboxShare < LIMITS.bridgesInBboxMin) findings.push(err(`bridges.json: tylko ${pct(metrics.inBboxShare)} punktów w gridBbox (min ${pct(LIMITS.bridgesInBboxMin)}) — mosty z innego prostokąta niż w cities.json`));
  }
  return { findings, metrics };
}

const CHECKERS = { walknet: checkWalkNet, water: checkWater, bridges: checkBridges };

/**
 * Kontrola jednego miasta.
 * @returns {{findings: string[], metrics: object, ages: object}}
 *   ages: { <plik>: wiek w dniach | null }, metrics: { walknet, water, bridges }
 */
export function checkCity(key, cfg, { root, today = new Date() }) {
  const bbox = cfg.gridBbox ?? cfg.bbox;
  const res = { findings: [], metrics: {}, ages: {} };
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(isNum)) {
    res.findings.push(err('cities.json: brak poprawnego gridBbox/bbox [s, w, n, e]'));
    return res;
  }
  for (const f of FILES) {
    const file = path.join(root, 'data', key, `${f}.json`);
    try { res.ages[f] = Math.max(0, Math.floor((today.getTime() - fs.statSync(file).mtimeMs) / DAY_MS)); } catch { res.ages[f] = null; }
    const { data, error } = readJson(file);
    if (error) { res.findings.push(err(`${f}.json: ${error}`)); continue; }
    const { findings, metrics } = CHECKERS[f](data, bbox);
    res.findings.push(...findings);
    res.metrics[f] = metrics;
  }
  return res;
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/** Tabela rozkładów (min / mediana / max / najgorsze miasto) — do kalibracji progów. */
export function statsTable(results) {
  const rows = [
    ['węzły grafu', r => r.metrics.walknet?.nodes, false],
    ['krawędzie grafu', r => r.metrics.walknet?.edges, false],
    ['węzły w gridBbox', r => r.metrics.walknet?.inBboxShare, true],
    ['pokrycie bboxa (komórki 10x10)', r => r.metrics.walknet?.occupancy, true],
    ['rozpiętość grafu / bbox (min osi)', r => r.metrics.walknet?.spanRatio, true],
    ['największa składowa', r => r.metrics.walknet?.mainShare, true],
    ['woda: punkty w gridBbox', r => r.metrics.water?.inBboxShare, true],
    ['mosty: punkty w gridBbox', r => r.metrics.bridges?.inBboxShare, true],
    ['wiek walknet.json [dni]', r => r.ages.walknet, false],
    ['wiek water.json [dni]', r => r.ages.water, false],
    ['wiek bridges.json [dni]', r => r.ages.bridges, false],
  ];
  const lines = ['| Wielkość | min | mediana | max | najgorsze miasto |', '|---|---|---|---|---|'];
  for (const [label, get, isShare] of rows) {
    const vals = results.map(r => ({ key: r.key, v: get(r) })).filter(x => isNum(x.v));
    if (!vals.length) { lines.push(`| ${label} | — | — | — | — |`); continue; }
    const f = v => (isShare ? (label.startsWith('rozpiętość') ? v.toFixed(3) : pct(v)) : String(Math.round(v * 10) / 10));
    const worst = label.startsWith('wiek') ? vals.reduce((a, b) => (b.v > a.v ? b : a)) : vals.reduce((a, b) => (b.v < a.v ? b : a));
    lines.push(`| ${label} | ${f(Math.min(...vals.map(x => x.v)))} | ${f(median(vals.map(x => x.v)))} | ${f(Math.max(...vals.map(x => x.v)))} | ${worst.key} |`);
  }
  return lines.join('\n');
}

/** Cała kontrola; zwraca { code, out } zamiast kończyć proces (testy). */
export function run(argv, { root = path.join(import.meta.dirname, '..'), today = new Date() } = {}) {
  const cities = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cities.json'), 'utf8'));
  const wantStats = argv.includes('--stats');
  const ignoreWarnings = argv.includes('--ignore-warnings');
  const wanted = argv.filter(a => !a.startsWith('--'));
  const unknown = wanted.filter(k => !cities[k]);
  if (unknown.length) {
    return { code: 1, out: `Nieznane miasto: ${unknown.join(', ')}. Dostępne: ${Object.keys(cities).join(', ')}\n` };
  }
  const keys = wanted.length ? wanted : Object.keys(cities);

  const results = keys.map(key => ({ key, name: cities[key].name, ...checkCity(key, cities[key], { root, today }) }));
  const bad = results.filter(r => r.findings.length);
  const todayIso = today.toISOString().slice(0, 10);
  const lines = [];
  if (!bad.length) {
    lines.push(`Wszystkie ${results.length} miast: dane OSM spójne (walknet, woda, mosty).`);
  } else {
    lines.push(`## Stan danych OSM — ${todayIso}\n`);
    lines.push(`Problemy w ${bad.length} z ${results.length} miast:\n`);
    for (const r of bad) {
      lines.push(`- **${r.name}** (\`${r.key}\`)`);
      for (const f of r.findings) lines.push(`  - ${f}`);
    }
  }
  lines.push('\n### Wiek plików (data modyfikacji, dni)\n');
  lines.push('| Miasto | walknet | water | bridges |', '|---|---|---|---|');
  for (const r of results) {
    const a = f => (r.ages[f] == null ? '—' : String(r.ages[f]));
    lines.push(`| ${r.key} | ${a('walknet')} | ${a('water')} | ${a('bridges')} |`);
  }
  lines.push('\nWiek nie jest błędem — informuje, kiedy warto przeliczyć dane (`tools/build-walknet.mjs`, `build-water.mjs`, `build-bridges.mjs`).');
  if (wantStats) lines.push('\n### Rozkłady zmierzonych wielkości\n', statsTable(results));
  const failing = ignoreWarnings ? results.filter(r => r.findings.some(f => f.startsWith('BŁĄD'))) : bad;
  return { code: failing.length ? 1 : 0, out: lines.join('\n') + '\n' };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
if (isMain) {
  const { code, out } = run(process.argv.slice(2));
  process.stdout.write(out);
  process.exit(code);
}
