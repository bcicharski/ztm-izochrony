#!/usr/bin/env node
/**
 * Buduje maskę wody (data/water.json) do wycinania stref czasowych na mapie.
 * Źródło: OpenStreetMap przez Overpass API — linia brzegowa (natural=coastline)
 * oraz większe akweny śródlądowe (natural=water).
 *
 * Użycie:
 *   node tools/build-water.mjs [ścieżka-do-zapisanej-odpowiedzi-overpass.json]
 *   (bez argumentu pobiera dane z overpass-api.de)
 *
 * Format wyjścia: { polys: [ [ [lat*1e5, lon*1e5], ... ], ... ] }
 * Pierścienie wody mają obieg zgodny z ruchem wskazówek zegara (matematycznie,
 * x=lon, y=lat), wyspy przeciwny — wypełnianie canvas regułą "nonzero" daje
 * wtedy poprawne dziury na wyspach i odporność na nakładające się akweny.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fetchOverpass } from './geo.mjs';

const BBOX = { s: 54.28, w: 18.30, n: 54.62, e: 19.10 }; // Trójmiasto z okolicą
const SEA_N = 54.80, SEA_E = 19.25;                       // domknięcie morza za bboxem
const MIN_AREA_KM2 = 0.02;   // pomijaj oczka mniejsze niż ~2 ha
const SIMPLIFY_M = 15;       // tolerancja upraszczania Douglas-Peucker

const M_PER_DEG_LAT = 111320;
const outFile = path.join(import.meta.dirname, '..', 'data', 'water.json');

// --- pobranie danych --------------------------------------------------------

const query = `[out:json][timeout:90];(
  way["natural"="coastline"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  way["natural"="water"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  relation["natural"="water"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
);out geom;`;

let raw;
if (process.argv[2]) {
  raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
} else {
  console.log('Pobieram geometrię wody z Overpass API…');
  raw = await fetchOverpass(query);
}

// --- pomocnicze --------------------------------------------------------------

const key = p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6);

/** Pole ze znakiem (shoelace, x=lon, y=lat); ujemne = obieg zgodny z zegarem. */
function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.lon * q.lat - q.lon * p.lat;
  }
  return a / 2;
}

function areaKm2(ring) {
  const latRef = ring[0].lat * Math.PI / 180;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(latRef);
  return Math.abs(signedArea(ring)) * M_PER_DEG_LAT * mPerDegLon / 1e6;
}

/** Douglas-Peucker w metrach. */
function simplify(ring, tolM) {
  if (ring.length < 8) return ring;
  const latRef = ring[0].lat * Math.PI / 180;
  const kx = M_PER_DEG_LAT * Math.cos(latRef), ky = M_PER_DEG_LAT;
  const pts = ring.map(p => ({ x: p.lon * kx, y: p.lat * ky, p }));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dx * (pts[a].y - pts[i].y) - dy * (pts[a].x - pts[i].x)) / len;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tolM) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/** Skleja otwarte łańcuchy po pasujących końcach. */
function stitch(lines) {
  const chains = lines.map(l => l.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < chains.length; i++) {
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        if (key(chains[i][chains[i].length - 1]) === key(chains[j][0])) {
          chains[i] = chains[i].concat(chains[j].slice(1));
          chains.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return chains;
}

const isClosed = c => c.length > 3 && key(c[0]) === key(c[c.length - 1]);

/** Normalizuje obieg: woda = zgodnie z zegarem (pole ujemne), wyspa odwrotnie. */
function orient(ring, water) {
  const cw = signedArea(ring) < 0;
  return cw === water ? ring : ring.slice().reverse();
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
  } else if (chain.length > 100) {
    // główny łańcuch wybrzeża — domknięcie od strony morza (NE)
    const end = chain[chain.length - 1];
    const start = chain[0];
    const ring = chain.concat([
      { lat: SEA_N, lon: end.lon },
      { lat: SEA_N, lon: SEA_E },
      { lat: start.lat, lon: SEA_E },
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

// --- 3. upraszczanie i zapis ------------------------------------------------------

let nPts = 0;
const polys = [];
for (const { ring, water } of rings) {
  const simple = simplify(ring, SIMPLIFY_M);
  if (simple.length < 4) continue;
  // upraszczanie nie może odwrócić obiegu, ale sprawdź dla pewności
  const fixed = orient(simple, water);
  nPts += fixed.length;
  polys.push(fixed.map(p => [Math.round(p.lat * 1e5), Math.round(p.lon * 1e5)]));
}

fs.writeFileSync(outFile, JSON.stringify({ polys }));
console.log(`Zapisano ${polys.length} pierścieni (${nPts} punktów), ` +
  `plik ${(fs.statSync(outFile).size / 1024).toFixed(0)} kB -> ${outFile}`);
