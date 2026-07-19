#!/usr/bin/env node
/**
 * Buduje maskę wody (data/<miasto>/water.json) do wycinania stref na mapie.
 * Źródło: OpenStreetMap przez Overpass API — linia brzegowa (natural=coastline),
 * akweny śródlądowe (natural=water; rzeki jako poligony) oraz linie rzek/kanałów
 * (waterway=river/canal) uzupełniające dziury w poligonach.
 *
 * Użycie:
 *   node tools/build-water.mjs <miasto> [ścieżka-do-zapisanej-odpowiedzi-overpass.json]
 *   (miasto = klucz z data/cities.json; bez drugiego argumentu pobiera z overpass-api.de)
 *
 * Format wyjścia:
 *   {
 *     polys: [ [ [lat*1e5, lon*1e5], ... ], ... ],  // pierścienie zamknięte
 *     lines: [ [ [lat*1e5, lon*1e5], ... ], ... ],  // otwarte linie rzek (renderowane
 *                                                     jako stroke szerokości ~100 m)
 *   }
 * Pierścienie wody mają obieg zgodny z ruchem wskazówek zegara (matematycznie,
 * x=lon, y=lat), wyspy przeciwny — wypełnianie canvas regułą "nonzero" daje
 * wtedy poprawne dziury na wyspach i odporność na nakładające się akweny.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fetchOverpass, stitch, isClosed, orient, simplify, areaKm2, signedArea, quantize } from './geo.mjs';

const cityKey = process.argv[2];
const cities = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'cities.json'), 'utf8'));
if (!cities[cityKey]) {
  console.error(`Nieznane miasto "${cityKey}". Dostępne: ${Object.keys(cities).join(', ')}`);
  process.exit(1);
}
const cfg = cities[cityKey];
// maska musi pokrywać CAŁĄ siatkę pieszą, więc bierze `gridBbox` (bbox poszerzony
// o przystanki tuż za granicą sieci); brak pola = stary bbox
const gb = cfg.gridBbox ?? cfg.bbox;
const BBOX = { s: gb[0], w: gb[1], n: gb[2], e: gb[3] };
const SEA = cfg.seaClose ?? null; // domknięcie morza — tylko miasta nadmorskie
const MIN_AREA_KM2 = 0.02;   // pomijaj oczka mniejsze niż ~2 ha
const SIMPLIFY_M = 15;       // tolerancja upraszczania Douglas-Peucker

const outFile = path.join(import.meta.dirname, '..', 'data', cityKey, 'water.json');

// --- pobranie danych --------------------------------------------------------

const query = `[out:json][timeout:120];(
  way["natural"="coastline"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  way["natural"="water"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  relation["natural"="water"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  way["waterway"~"^(river|canal)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
);out geom;`;

let raw;
if (process.argv[3]) {
  raw = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
} else {
  console.log(`Pobieram geometrię wody dla „${cfg.name}" z Overpass API…`);
  raw = await fetchOverpass(query);
}

// --- 1. linia brzegowa ---------------------------------------------------------

const coastWays = raw.elements.filter(e => e.type === 'way' && e.tags?.natural === 'coastline');
const chains = stitch(coastWays.map(w => w.geometry));
const rings = []; // {ring, water:boolean}

for (const chain of chains) {
  if (isClosed(chain)) {
    const ring = chain.slice(0, -1);
    if (areaKm2(ring) < MIN_AREA_KM2) continue;
    // woda po prawej stronie kierunku ⇒ obieg CW = woda w środku, CCW = wyspa
    rings.push({ ring, water: signedArea(ring) < 0 });
  } else if (chain.length > 100 && SEA) {
    // główny łańcuch wybrzeża — domknięcie od strony morza
    const end = chain[chain.length - 1];
    const start = chain[0];
    const ring = chain.concat([
      { lat: SEA.n, lon: end.lon },
      { lat: SEA.n, lon: SEA.e },
      { lat: start.lat, lon: SEA.e },
    ]);
    rings.push({ ring: orient(ring, true), water: true });
  }
}

// --- 2. akweny śródlądowe (natural=water) ---------------------------------------

for (const el of raw.elements) {
  if (el.tags?.natural !== 'water') continue;
  if (el.type === 'way' && el.geometry && isClosed(el.geometry)) {
    const ring = el.geometry.slice(0, -1);
    if (areaKm2(ring) >= MIN_AREA_KM2) rings.push({ ring: orient(ring, true), water: true });
  } else if (el.type === 'relation' && el.members) {
    for (const role of ['outer', 'inner']) {
      const lines = el.members.filter(m => m.role === role && m.geometry).map(m => m.geometry);
      for (const chain of stitch(lines)) {
        if (!isClosed(chain)) continue; // niedomknięty fragment relacji — pomiń
        const ring = chain.slice(0, -1);
        if (areaKm2(ring) < MIN_AREA_KM2) continue;
        rings.push({ ring: orient(ring, role === 'outer'), water: role === 'outer' });
      }
    }
  }
}

// --- 3. linie rzek/kanałów (waterway=river/canal) uzupełniają dziury poligonów ---

const waterwayLines = raw.elements
  .filter(e => e.type === 'way' && e.geometry && /^(river|canal)$/.test(e.tags?.waterway))
  .map(e => e.geometry);
const stitchedLines = stitch(waterwayLines);

// --- 4. upraszczanie i zapis ------------------------------------------------------

let nPts = 0;
const polys = [];
for (const { ring, water } of rings) {
  const simple = simplify(ring, SIMPLIFY_M);
  if (simple.length < 4) continue;
  // upraszczanie nie może odwrócić obiegu, ale sprawdź dla pewności
  const fixed = orient(simple, water);
  nPts += fixed.length;
  polys.push(quantize(fixed));
}

let nLinePts = 0;
const lines = [];
for (const chain of stitchedLines) {
  const simple = simplify(chain, SIMPLIFY_M);
  if (simple.length < 2) continue;
  nLinePts += simple.length;
  lines.push(quantize(simple));
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ polys, lines }));
console.log(`Zapisano ${polys.length} pierścieni (${nPts} punktów) + ${lines.length} linii (${nLinePts} punktów), ` +
  `plik ${(fs.statSync(outFile).size / 1024).toFixed(0)} kB -> ${outFile}`);
