#!/usr/bin/env node
/**
 * Buduje granice administracyjne miasta (data/<miasto>/city.json) —
 * do liczenia odsetka powierzchni objętej strefami.
 * Źródło: OpenStreetMap przez Overpass API (relacje admin_level=8).
 *
 * Użycie:
 *   node tools/build-city.mjs <miasto> [ścieżka-do-zapisanej-odpowiedzi-overpass.json]
 *   (miasto = klucz z data/cities.json; granice wg pola "boundaries")
 *
 * Format wyjścia: { polys: [ [ [lat*1e5, lon*1e5], ... ], ... ] }
 * (obszar = obieg CW, enklawy/dziury = CCW; wypełnianie regułą nonzero)
 */

import fs from 'node:fs';
import path from 'node:path';
import { stitch, isClosed, orient, simplify, areaKm2, fetchOverpass, quantize } from './geo.mjs';

const cityKey = process.argv[2];
const cities = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'cities.json'), 'utf8'));
if (!cities[cityKey]) {
  console.error(`Nieznane miasto "${cityKey}". Dostępne: ${Object.keys(cities).join(', ')}`);
  process.exit(1);
}
const cfg = cities[cityKey];
const PAD = 0.15; // zapas bboxa na granice wychodzące poza obszar sieci
const bbox = `${cfg.bbox[0] - PAD},${cfg.bbox[1] - PAD},${cfg.bbox[2] + PAD},${cfg.bbox[3] + PAD}`;

const SIMPLIFY_M = 40; // granice mogą być zgrubne — służą tylko statystyce
const outFile = path.join(import.meta.dirname, '..', 'data', cityKey, 'city.json');

const adminLevel = cfg.adminLevel ?? 8; // gminy; np. GZM to jedna relacja poziomu 5
const query = `[out:json][timeout:120];(
${cfg.boundaries.map(n => `relation["boundary"="administrative"]["admin_level"="${adminLevel}"]["name"="${n}"](${bbox});`).join('\n')}
);out geom;`;

let raw;
if (process.argv[3]) {
  raw = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
} else {
  console.log(`Pobieram granice (${cfg.boundaries.join(', ')}) z Overpass API…`);
  raw = await fetchOverpass(query);
}

const rels = raw.elements.filter(e => e.type === 'relation');
if (rels.length < cfg.boundaries.length) {
  console.warn(`Uwaga: znaleziono tylko ${rels.length}/${cfg.boundaries.length} relacji granic.`);
}

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

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ polys }));
console.log(`Zapisano ${polys.length} pierścieni, pole łącznie ~${total.toFixed(0)} km², ` +
  `plik ${(fs.statSync(outFile).size / 1024).toFixed(0)} kB -> ${outFile}`);
