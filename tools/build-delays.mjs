#!/usr/bin/env node
/**
 * Kompiluje surowe agregaty opóźnień (data/delays/<miasto>.json, zbierane przez
 * collect-delays.mjs na gałęzi "delays") w kompaktowe profile czytane przez
 * frontend: data/<miasto>/delays.json = { "linia|typDnia|godzina": opóźnienieSek }.
 *
 * Zapisujemy tylko klucze z co najmniej MIN_OBS obserwacjami i dodatnim
 * percentylem — reszta pozostaje w gestii heurystyki trybu ostrożnego, więc
 * realne dane wchodzą punktowo i przyrastają w miarę zbierania.
 *
 * Użycie: node tools/build-delays.mjs [<katalog-z-agregatami>]
 *   (domyślnie data/delays; w workflow podstawiany jest checkout gałęzi delays)
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const srcDir = process.argv[2] ?? path.join(root, 'data', 'delays');
const cities = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cities.json'), 'utf8'));

const MIN_OBS = 20;      // minimum obserwacji, by profil zastąpił heurystykę
const PERCENTILE = 0.8;  // „w 80% przypadków dojedziesz w tym czasie"

// wartości reprezentatywne kubełków histogramu (górne granice; ostatni ~15 min)
// zgodne z BUCKETS w collect-delays.mjs: [-60, 60, 180, 300, 600]
const BUCKET_REPS = [-60, 60, 180, 300, 600, 900];

/** Percentyl z histogramu [b0..b5]; zwraca sekundy (może być ujemny). */
function percentileFromHist(hist, n, p) {
  let cum = 0;
  const target = n * p;
  for (let i = 0; i < hist.length; i++) {
    cum += hist[i];
    if (cum >= target) return BUCKET_REPS[i];
  }
  return BUCKET_REPS[BUCKET_REPS.length - 1];
}

for (const cityKey of Object.keys(cities)) {
  const file = path.join(srcDir, `${cityKey}.json`);
  const outFile = path.join(root, 'data', cityKey, 'delays.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(outFile, '{}'); // brak danych → pusty profil (sama heurystyka)
    continue;
  }
  const agg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const profile = {};
  let kept = 0, total = 0;
  for (const [key, row] of Object.entries(agg)) {
    total++;
    const n = row[0];
    if (n < MIN_OBS) continue;
    const p80 = percentileFromHist(row.slice(2), n, PERCENTILE);
    if (p80 <= 0) continue; // brak istotnego opóźnienia — heurystyka zbędna
    profile[key] = p80;
    kept++;
  }
  fs.writeFileSync(outFile, JSON.stringify(profile));
  console.log(`${cityKey}: ${kept}/${total} kluczy z profilem (n≥${MIN_OBS}), ` +
    `plik ${(fs.statSync(outFile).size / 1024).toFixed(1)} kB`);
}
