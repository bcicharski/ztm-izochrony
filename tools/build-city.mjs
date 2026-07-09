#!/usr/bin/env node
/**
 * Buduje granicę administracyjną Gdańska (data/city.json) — do liczenia
 * odsetka powierzchni miasta objętej strefami czasowymi.
 * Źródło: OpenStreetMap przez Overpass API (relacja admin_level=8).
 *
 * Użycie:
 *   node tools/build-city.mjs [ścieżka-do-zapisanej-odpowiedzi-overpass.json]
 *
 * Format wyjścia: { polys: [ [ [lat*1e5, lon*1e5], ... ], ... ] }
 * (obszar = obieg CW, enklawy/dziury = CCW; wypełnianie regułą nonzero)
 */

import fs from 'node:fs';
import path from 'node:path';
import { stitch, isClosed, orient, simplify, areaKm2, fetchOverpass, quantize } from './geo.mjs';

const SIMPLIFY_M = 40; // granica miasta może być zgrubna — służy tylko statystyce
const outFile = path.join(import.meta.dirname, '..', 'data', 'city.json');

const query = `[out:json][timeout:90];
relation["boundary"="administrative"]["admin_level"="8"]["name"="Gdańsk"](54.2,18.3,54.6,19.1);
out geom;`;

let raw;
if (process.argv[2]) {
  raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
} else {
  console.log('Pobieram granicę Gdańska z Overpass API…');
  raw = await fetchOverpass(query);
}

const rel = raw.elements.find(e => e.type === 'relation');
if (!rel) throw new Error('Nie znaleziono relacji granicy Gdańska.');

const polys = [];
let total = 0;
for (const role of ['outer', 'inner']) {
  const lines = rel.members.filter(m => m.role === role && m.geometry).map(m => m.geometry);
  for (const chain of stitch(lines)) {
    if (!isClosed(chain)) {
      console.warn(`Pominięto niedomknięty fragment (${role}, ${chain.length} pkt)`);
      continue;
    }
    const ring = simplify(chain.slice(0, -1), SIMPLIFY_M);
    if (ring.length < 4) continue;
    if (role === 'outer') total += areaKm2(ring);
    polys.push(quantize(orient(ring, role === 'outer')));
  }
}

fs.writeFileSync(outFile, JSON.stringify({ polys }));
console.log(`Zapisano ${polys.length} pierścieni, pole ~${total.toFixed(0)} km², ` +
  `plik ${(fs.statSync(outFile).size / 1024).toFixed(0)} kB -> ${outFile}`);
