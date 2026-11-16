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
 * Dodatkowo dopisuje do data/<miasto>/meta.json pole `delays` (pokrycie
 * profilami: ile linii z ilu), z którego front pokazuje, czy tryb ostrożny
 * opiera się na pomiarach, czy na heurystyce.
 *
 * Użycie: node tools/build-delays.mjs [<katalog-z-agregatami>]
 *   (domyślnie data/delays; w workflow podstawiany jest checkout gałęzi delays)
 */

import fs from 'node:fs';
import path from 'node:path';

const defaultRoot = path.join(import.meta.dirname, '..');

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

/**
 * Nazwy linii znane silnikowi (routes[].n z workday.json) — klucz profilu,
 * który w nie nie trafia (np. surowe route_id z okresu przed mapowaniem nazw
 * w kolektorze), jest martwy i tylko puchnie w pliku. `null` = brak danych
 * dnia roboczego, filtr wyłączony.
 */
function knownRouteNames(root, cityKey) {
  const file = path.join(root, 'data', cityKey, 'workday.json');
  if (!fs.existsSync(file)) return null;
  try {
    return new Set(JSON.parse(fs.readFileSync(file, 'utf8')).routes.map(r => r.n));
  } catch {
    return null;
  }
}

/**
 * Podsumowanie pokrycia profilami do meta.json: ile linii ma co najmniej jeden
 * profil (unikalne `klucz.split('|')[0]`), ile kluczy, ile linii w rozkładzie.
 * @param {Record<string, number>} profile  { "linia|typDnia|godzina": sekundy }
 * @param {number|null} routesTotal  linie w rozkładzie dnia roboczego (null = nieznane)
 */
export function profileSummary(profile, routesTotal = null) {
  const keys = Object.keys(profile);
  const routes = new Set(keys.map(k => k.split('|')[0]));
  return { routes: routes.size, routesTotal, keys: keys.length };
}

/** Dopisuje `delays` do data/<miasto>/meta.json, zachowując resztę pól i ich kolejność. */
function writeMetaDelays(root, cityKey, summary, source, updated) {
  const metaFile = path.join(root, 'data', cityKey, 'meta.json');
  if (!fs.existsSync(metaFile)) return false;
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  meta.delays = { ...summary, updated, source };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  return true;
}

/**
 * Kompiluje profile wszystkich miast z data/cities.json.
 * @param {{root?: string, srcDir?: string, today?: Date}} [opts]
 */
export function run({ root = defaultRoot, srcDir = path.join(root, 'data', 'delays'), today = new Date() } = {}) {
  const cities = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cities.json'), 'utf8'));
  const updated = today.toISOString().slice(0, 10).replaceAll('-', '');
  for (const cityKey of Object.keys(cities)) {
    const file = path.join(srcDir, `${cityKey}.json`);
    const outFile = path.join(root, 'data', cityKey, 'delays.json');
    const known = knownRouteNames(root, cityKey);
    const profile = {};
    let kept = 0, total = 0, unknown = 0;
    if (fs.existsSync(file)) {
      const agg = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [key, row] of Object.entries(agg)) {
        if (key.startsWith('_')) continue; // metadane kolektora (_seen), nie agregat
        total++;
        const n = row[0];
        if (n < MIN_OBS) continue;
        if (known && !known.has(key.split('|')[0])) { unknown++; continue; }
        const p80 = percentileFromHist(row.slice(2), n, PERCENTILE);
        if (p80 <= 0) continue; // brak istotnego opóźnienia — heurystyka zbędna
        profile[key] = p80;
        kept++;
      }
    }
    // brak danych → pusty profil (sama heurystyka)
    fs.writeFileSync(outFile, JSON.stringify(profile));
    const summary = profileSummary(profile, known ? known.size : null);
    writeMetaDelays(root, cityKey, summary, cities[cityKey].rt?.type ?? null, updated);
    console.log(`${cityKey}: ${kept}/${total} kluczy z profilem (n≥${MIN_OBS})` +
      (unknown ? `, ${unknown} pominiętych (linia nieznana silnikowi)` : '') +
      `, linii z profilem ${summary.routes}/${summary.routesTotal ?? '?'}` +
      `, plik ${(fs.statSync(outFile).size / 1024).toFixed(1)} kB`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  run(process.argv[2] ? { srcDir: path.resolve(process.argv[2]) } : {});
}
