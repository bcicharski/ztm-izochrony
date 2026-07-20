#!/usr/bin/env node
/**
 * Buduje sieć pieszą z OSM do routingu dojść (data/<miasto>/walknet.json).
 *
 * Po co: zasięg pieszy liczony po rastrze lądu (js/walkgrid.js) zna wyłącznie
 * wodę — każdy piksel nie-wodny jest przechodzalny z tą samą prędkością, więc
 * w głębi lądu izochrona degeneruje się do koła (zmierzone: średni współczynnik
 * nadłożenia drogi 1,05 przy braku wody w pobliżu). Graf dróg pieszych zastępuje
 * to routingiem po realnej sieci; raster zostaje jako maska wody i podkład do
 * rysowania.
 *
 * Użycie:
 *   node tools/build-walknet.mjs <miasto|all> [plik-overpass.json]
 *
 * Zakres: te same granice co siatka piesza (gridBbox albo bbox z cities.json).
 * Pomijane: drogi bez ruchu pieszego (motorway/trunk/…), `foot=no`,
 * `access=private|no` oraz podjazdy i alejki parkingowe (`service=driveway`,
 * `service=parking_aisle`) — 1,7 tys. km w samym Trójmieście, bez wartości dla
 * pieszego, a ok. 20% rozmiaru pliku.
 *
 * Graf jest skontrahowany: węzły to skrzyżowania i ślepe końce (stopień ≠ 2),
 * a ciąg wierzchołków stopnia 2 zwija się w jedną krawędź. Długość krawędzi
 * liczona z PEŁNEJ geometrii przed zwinięciem, więc czasy przejścia pozostają
 * dokładne mimo braku punktów pośrednich w zapisie. Ślepe odnogi krótsze niż
 * 25 m (podjazdy do pojedynczych budynków) są odrzucane.
 *
 * Drobne odpryski (2–3% węzłów: fragmenty ucięte granicą bboxa, ścieżki bez
 * połączenia z resztą, błędy danych) zostają w pliku — odfiltrowuje je dekoder
 * w js/walknet.js, wyznaczając największą spójną składową przy wczytaniu.
 *
 * Format (v1): współrzędne kwantyzowane 1e5 jak w pozostałych plikach danych,
 * węzły uporządkowane przestrzennie (kubełki 500 m) i zapisane różnicowo —
 * dzięki temu gzip serwera ściska plik ok. 3×.
 *   { version, quant, nodes: {dLat, dLon}, edges: {a, b, len} }
 *   a  — różnice indeksu początku względem poprzedniej krawędzi
 *   b  — indeks końca względem początku tej krawędzi
 *   len— długość krawędzi w metrach
 */

import fs from 'node:fs';
import path from 'node:path';
import { fetchOverpass, M_PER_DEG_LAT } from './geo.mjs';

const arg = process.argv[2];
const cities = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'cities.json'), 'utf8'));
const keys = arg === 'all' ? Object.keys(cities) : [arg];
if (!keys.every(k => cities[k])) {
  console.error(`Nieznane miasto. Dostępne: all, ${Object.keys(cities).join(', ')}`);
  process.exit(1);
}

/** Drogi, po których pieszy nie chodzi (albo nie wolno mu). */
const EXCLUDE_HIGHWAY = '^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|escape|corridor)$';
/** Warianty `service` bez wartości dla pieszego (podjazdy, alejki parkingowe). */
const SKIP_SERVICE = new Set(['driveway', 'parking_aisle']);
/** Ślepe odnogi krótsze niż tyle metrów są odrzucane. */
const MIN_SPUR_M = 25;
/** Kwantyzacja współrzędnych — jak w water.json / bridges.json / city.json. */
const QUANT = 1e5;
/** Bok kubełka porządkowania przestrzennego [m] — im mniejszy, tym lepsza delta. */
const ORDER_CELL_M = 500;

const distM = (a, b) => Math.hypot(
  (b[1] - a[1]) * M_PER_DEG_LAT * Math.cos(a[0] * Math.PI / 180),
  (b[0] - a[0]) * M_PER_DEG_LAT,
);

for (const cityKey of keys) {
  const cfg = cities[cityKey];
  const [s, w, n, e] = cfg.gridBbox ?? cfg.bbox;
  const query = `[out:json][timeout:900];
way["highway"]["highway"!~"${EXCLUDE_HIGHWAY}"]["foot"!="no"]["access"!~"^(private|no)$"](${s},${w},${n},${e});
out body;
>;
out skel qt;`;

  let raw;
  if (process.argv[3] && keys.length === 1) {
    raw = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  } else {
    console.log(`Pobieram sieć pieszą dla „${cfg.name}"…`);
    // zapytania są duże (dziesiątki–setki MB), więc Overpass łatwo zwraca 429;
    // więcej prób niż domyślne, bo budowa wszystkich miast to jeden długi ciąg
    raw = await fetchOverpass(query, 8);
  }

  // --- 1. surowe węzły i odcinki -----------------------------------------
  const nodePos = new Map();
  const wayList = [];
  for (const el of raw.elements ?? []) {
    if (el.type === 'node') nodePos.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.nodes?.length > 1) wayList.push(el);
  }

  // sąsiedztwo budowane po odcinkach ze WSZYSTKICH dróg — dzięki temu stopień
  // węzła jest topologiczny, a nie „ile razy trafił się koniec way"
  const nbr = new Map();
  const link = (a, b) => { let set = nbr.get(a); if (!set) nbr.set(a, set = new Set()); set.add(b); };
  for (const way of wayList) {
    if (SKIP_SERVICE.has(way.tags?.service)) continue;
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1], b = way.nodes[i];
      if (a === b || !nodePos.has(a) || !nodePos.has(b)) continue;
      link(a, b); link(b, a);
    }
  }

  // --- 2. kontrakcja wierzchołków stopnia 2 -------------------------------
  const isJunction = id => (nbr.get(id)?.size ?? 0) !== 2;
  const junctionIds = [...nbr.keys()].filter(isJunction);
  const junctionIdx = new Map(junctionIds.map((id, i) => [id, i]));
  const edges = []; // [aIdx, bIdx, lenM]
  const walked = new Set();
  const segKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const start of junctionIds) {
    for (const first of nbr.get(start)) {
      if (walked.has(segKey(start, first))) continue;
      walked.add(segKey(start, first));
      let prev = start, cur = first;
      let len = distM(nodePos.get(start), nodePos.get(first));
      // idź łańcuchem wierzchołków stopnia 2 aż do następnego węzła
      while (!isJunction(cur)) {
        const next = [...nbr.get(cur)].find(x => x !== prev);
        if (next === undefined || walked.has(segKey(cur, next))) break;
        walked.add(segKey(cur, next));
        len += distM(nodePos.get(cur), nodePos.get(next));
        prev = cur; cur = next;
      }
      const bIdx = junctionIdx.get(cur);
      if (bIdx === undefined || len <= 0) continue; // pętla bez węzła — pomijamy
      edges.push([junctionIdx.get(start), bIdx, Math.round(len)]);
    }
  }

  // --- 3. odrzucenie krótkich ślepych odnóg ------------------------------
  const degree = new Int32Array(junctionIds.length);
  for (const [a, b] of edges) { degree[a]++; degree[b]++; }
  const keptEdges = edges.filter(([a, b, len]) =>
    !(len < MIN_SPUR_M && (degree[a] === 1 || degree[b] === 1)));

  // --- 4. porządek przestrzenny i zapis różnicowy ------------------------
  const usedNodes = new Set();
  for (const [a, b] of keptEdges) { usedNodes.add(a); usedNodes.add(b); }
  const order = [...usedNodes];
  const pos = i => nodePos.get(junctionIds[i]);
  let latMin = 90;
  for (const i of order) latMin = Math.min(latMin, pos(i)[0]);
  const cellDeg = ORDER_CELL_M / M_PER_DEG_LAT;
  order.sort((i, j) => {
    const ri = Math.floor((pos(i)[0] - latMin) / cellDeg);
    const rj = Math.floor((pos(j)[0] - latMin) / cellDeg);
    return ri !== rj ? ri - rj : pos(i)[1] - pos(j)[1];
  });
  const remap = new Map(order.map((old, neu) => [old, neu]));

  const qLat = order.map(i => Math.round(pos(i)[0] * QUANT));
  const qLon = order.map(i => Math.round(pos(i)[1] * QUANT));
  const dLat = qLat.map((v, i) => (i ? v - qLat[i - 1] : v));
  const dLon = qLon.map((v, i) => (i ? v - qLon[i - 1] : v));

  const remapped = keptEdges
    .map(([a, b, len]) => [remap.get(a), remap.get(b), len])
    .sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
  const eA = remapped.map((edge, i) => (i ? edge[0] - remapped[i - 1][0] : edge[0]));
  const eB = remapped.map(edge => edge[1] - edge[0]);
  const eLen = remapped.map(edge => edge[2]);

  const outFile = path.join(import.meta.dirname, '..', 'data', cityKey, 'walknet.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({
    version: 1,
    quant: QUANT,
    nodes: { dLat, dLon },
    edges: { a: eA, b: eB, len: eLen },
  }));
  const totalKm = eLen.reduce((sum, v) => sum + v, 0) / 1000;
  console.log(`${cityKey}: węzły ${order.length}, krawędzie ${remapped.length}, ` +
    `sieć ${totalKm.toFixed(0)} km, plik ${(fs.statSync(outFile).size / 1e6).toFixed(2)} MB`);
}
