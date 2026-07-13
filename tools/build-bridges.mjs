#!/usr/bin/env node
/**
 * Pobiera z OSM mosty, kładki i mola przejezdne pieszo (data/<miasto>/bridges.json).
 * Siatka zasięgu pieszego traktuje wodę jako barierę — te linie są wpuszczane
 * z powrotem jako przejezdne korytarze, żeby mosty nie blokowały tras.
 *
 * Użycie: node tools/build-bridges.mjs <miasto|all> [plik-overpass.json]
 * Format: { lines: [ [ [lat*1e5, lon*1e5], ... ], ... ] }
 */

import fs from 'node:fs';
import path from 'node:path';
import { fetchOverpass, simplify, quantize } from './geo.mjs';

const arg = process.argv[2];
const cities = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'cities.json'), 'utf8'));
const keys = arg === 'all' ? Object.keys(cities) : [arg];
if (!keys.every(k => cities[k])) {
  console.error(`Nieznane miasto. Dostępne: all, ${Object.keys(cities).join(', ')}`);
  process.exit(1);
}

// drogi bez ruchu pieszego pomijamy
const NO_FOOT = /motorway|trunk|construction|proposed|raceway/;

for (const cityKey of keys) {
  const cfg = cities[cityKey];
  const [s, w, n, e] = cfg.bbox;
  const query = `[out:json][timeout:240];(
  way["bridge"]["highway"](${s},${w},${n},${e});
  way["man_made"="pier"](${s},${w},${n},${e});
);out geom;`;

  let raw;
  if (process.argv[3] && keys.length === 1) {
    raw = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  } else {
    console.log(`Pobieram mosty i mola dla „${cfg.name}"…`);
    raw = await fetchOverpass(query);
  }

  const lines = [];
  let nPts = 0;
  for (const el of raw.elements ?? []) {
    if (el.type !== 'way' || !el.geometry?.length) continue;
    if (el.tags?.highway && NO_FOOT.test(el.tags.highway)) continue;
    const line = simplify(el.geometry, 8);
    if (line.length < 2) continue;
    nPts += line.length;
    lines.push(quantize(line));
  }

  const outFile = path.join(import.meta.dirname, '..', 'data', cityKey, 'bridges.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ lines }));
  console.log(`${cityKey}: ${lines.length} linii (${nPts} pkt), ` +
    `${(fs.statSync(outFile).size / 1024).toFixed(0)} kB`);
}
