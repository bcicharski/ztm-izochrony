#!/usr/bin/env node
/**
 * Buduje granice administracyjne Trójmiasta (Gdańsk + Sopot + Gdynia)
 * do pliku data/city.json — do liczenia odsetka powierzchni objętej strefami.
 * Źródło: OpenStreetMap przez Overpass API (relacje admin_level=8).
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

const SIMPLIFY_M = 40; // granice mogą być zgrubne — służą tylko statystyce
const outFile = path.join(import.meta.dirname, '..', 'data', 'city.json');

const query = `[out:json][timeout:120];(
relation["boundary"="administrative"]["admin_level"="8"]["name"="Gdańsk"](54.2,18.3,54.7,19.1);
relation["boundary"="administrative"]["admin_level"="8"]["name"="Sopot"](54.2,18.3,54.7,19.1);
relation["boundary"="administrative"]["admin_level"="8"]["name"="Gdynia"](54.2,18.3,54.7,19.1);
);out geom;`;

let raw;
if (process.argv[2]) {
  raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
} else {
  console.log('Pobieram granice Gdańska, Sopotu i Gdyni z Overpass API…');
  raw = await fetchOverpass(query);
}

const rels = raw.elements.filter(e => e.type === 'relation');
if (rels.length < 3) console.warn(`Uwaga: znaleziono tylko ${rels.length}/3 relacji granic.`);

const polys = [];
let total = 0;
for (const rel of rels) {
  const name = rel.tags?.name ?? '?';
  let area = 0;
  for (const role of ['outer', 'inner']) {
    const lines = rel.members.filter(m => m.role === role && m.geometry).map(m => m.geometry);
    for (const chain of stitch(lines)) {
      if (!isClosed(chain)) {
        console.warn(`Pominięto niedomknięty fragment (${name}, ${role}, ${chain.length} pkt)`);
        continue;
      }
      const ring = simplify(chain.slice(0, -1), SIMPLIFY_M);
      if (ring.length < 4) continue;
      if (role === 'outer') area += areaKm2(ring);
      polys.push(quantize(orient(ring, role === 'outer')));
    }
  }
  total += area;
  console.log(`${name}: ~${area.toFixed(0)} km²`);
}

fs.writeFileSync(outFile, JSON.stringify({ polys }));
console.log(`Zapisano ${polys.length} pierścieni, pole łącznie ~${total.toFixed(0)} km², ` +
  `plik ${(fs.statSync(outFile).size / 1024).toFixed(0)} kB -> ${outFile}`);
