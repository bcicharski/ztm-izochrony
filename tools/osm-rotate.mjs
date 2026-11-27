#!/usr/bin/env node
/**
 * Rotacja odświeżania danych OSM (Z-023): wybiera, które miasta przeliczyć
 * w tym przebiegu. Najwyżej `limit` (domyślnie 3) miast, tych, których ostatnia
 * PRÓBA jest starsza niż `minAgeDays` (domyślnie 150).
 *
 * Kolejność:
 *   1. miasta bez wpisu w stanie (nowo dodane do cities.json) — najpierw;
 *   2. dalej rosnąco po dacie ostatniej próby (najstarsza pierwsza).
 *
 * Dlaczego to nie zagłodzi pozostałych: każda PRÓBA (także nieudana) przesuwa
 * `lastAttempt` na dziś, więc miasto stale nieudane wędruje na koniec kolejki,
 * a nie blokuje jej. Ponawia się je dopiero po `retryDays` (domyślnie 14) i
 * zawsze za miastami starszymi. Miasto POMINIĘTE (przebieg przerwany awarią,
 * limit) nie jest zapisywane w stanie, więc zachowuje starą datę i następnym
 * razem wraca na początek.
 *
 * Ograniczenie na rozmiar: najwyżej JEDNO duże miasto w przebiegu (publiczny
 * Overpass: ok. 1 GB pobrania na dobę; pomiar 2026-11-27 surowej odpowiedzi:
 * Gorzów 15,4 MB, Warszawa 247,6 MB). Duże = zbudowany walknet.json >= BIG_WALKNET_BYTES
 * (stosunek surowa odpowiedź / plik: 43x Gorzów, 41x Warszawa). Gdy czekają same
 * duże, przebieg bierze to jedno — duże miasta nie głodują. Jawna lista
 * (--cities) omija ograniczenie, a --max-big N je zmienia.
 *
 * Użycie:
 *   node tools/osm-rotate.mjs [--limit N] [--min-age DNI] [--retry-days DNI]
 *     [--cities a,b,c] [--format lines|csv|json] [--state plik] [--today RRRR-MM-DD]
 *   --cities pomija rotację (jawna lista; nieznane miasto = błąd).
 * Wyjście (stdout): `lines` (domyślnie) — jedno miasto na linię; `csv` — po
 * przecinku; `json` — tablica. Brak miast = puste wyjście / []. Uzasadnienie
 * wyboru idzie na stderr.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readState, ageDays, STATE_FILE } from './osm-state.mjs';

/**
 * Próg „dużego miasta" wg rozmiaru data/<miasto>/walknet.json [B]. Pomiar 2026-11-27 (18 miast):
 * małe 0,36–1,3 MB (Gorzów, Opole … Szczecin), środek 2,27–2,52 MB (Łódź, Wrocław,
 * Poznań, Kraków), duże 3,11 MB (Trójmiasto), 6,09 MB (Warszawa), 6,93 MB (GZM).
 * 3 MB leży w luce między Krakowem a Trójmiastem.
 */
export const BIG_WALKNET_BYTES = 3_000_000;
export const DEFAULTS = { limit: 3, minAgeDays: 150, retryDays: 14, maxBig: 1 };

/**
 * Czysty wybór miast.
 * @param {string[]} cityKeys klucze z cities.json (kolejność rozstrzyga remisy)
 * @param {{cities: object}} state znormalizowany stan
 * @param {{today?: Date, limit?: number, minAgeDays?: number, retryDays?: number,
 *   sizes?: Object<string, number>, bigBytes?: number, maxBig?: number}} [opts] `sizes`: rozmiar walknet.json miasta [B]; brak = małe
 * @returns {Array<{key: string, reason: 'nowe'|'wiek'|'ponowienie', ageDays: number|null}>}
 */
export function selectCities(cityKeys, state, { today = new Date(), limit = DEFAULTS.limit, minAgeDays = DEFAULTS.minAgeDays, retryDays = DEFAULTS.retryDays, sizes = {}, bigBytes = BIG_WALKNET_BYTES, maxBig = DEFAULTS.maxBig } = {}) {
  const due = [];
  cityKeys.forEach((key, order) => { // klucze spoza cities.json, które są w stanie, nigdy tu nie trafią
    const e = state?.cities?.[key];
    const age = ageDays(e?.lastAttempt, today);
    if (age == null) { due.push({ key, order, reason: 'nowe', ageDays: null, rank: -Infinity }); return; }
    const failed = e.result === 'gate' || e.result === 'error';
    if (age > (failed ? retryDays : minAgeDays)) due.push({ key, order, reason: failed ? 'ponowienie' : 'wiek', ageDays: age, rank: -age });
  });
  due.sort((a, b) => (a.rank - b.rank) || (a.order - b.order));
  // najwyżej maxBig dużych; reszta z mniejszych w dotychczasowej kolejności (duże, które nie weszły, czekają)
  const picked = [];
  let big = 0;
  for (const d of due) {
    if (picked.length >= Math.max(0, limit)) break;
    if ((sizes[d.key] ?? 0) >= bigBytes) { if (big >= maxBig) continue; big++; }
    picked.push(d);
  }
  return picked.map(({ key, reason, ageDays: a }) => ({ key, reason, ageDays: a }));
}

/** Jawna lista miast (pomija rotację); zwraca { keys, unknown }. */
export function explicitCities(list, cityKeys) {
  const keys = [...new Set(list)];
  return { keys: keys.filter(k => cityKeys.includes(k)), unknown: keys.filter(k => !cityKeys.includes(k)) };
}

/** Rozmiary data/<miasto>/walknet.json [B]; brak pliku = pominięte. */
export function walknetSizes(root, cityKeys) {
  const out = {};
  for (const k of cityKeys) { try { out[k] = fs.statSync(path.join(root, 'data', k, 'walknet.json')).size; } catch { /* brak pliku */ } }
  return out;
}

export function formatSelection(keys, format = 'lines') {
  if (format === 'json') return JSON.stringify(keys) + '\n';
  if (format === 'csv') return keys.join(',') + (keys.length ? '\n' : '');
  return keys.map(k => k + '\n').join('');
}

/** CLI bez efektów ubocznych poza odczytem; zwraca { code, out, err }. */
export function run(argv, { root = path.join(import.meta.dirname, '..'), stateFile, today } = {}) {
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const num = (name, dflt) => (opt(name) === undefined ? dflt : Number(opt(name)));
  const limit = num('--limit', DEFAULTS.limit), minAgeDays = num('--min-age', DEFAULTS.minAgeDays), retryDays = num('--retry-days', DEFAULTS.retryDays);
  if (![limit, minAgeDays, retryDays, num('--max-big', 1)].every(Number.isFinite)) return { code: 1, out: '', err: 'Opcje liczbowe wymagają liczby.\n' };
  const format = opt('--format') ?? 'lines';
  if (!['lines', 'csv', 'json'].includes(format)) return { code: 1, out: '', err: `Nieznany format «${format}» (lines|csv|json).\n` };
  const now = opt('--today') ? new Date(`${opt('--today')}T12:00:00Z`) : (today ?? new Date());
  const cities = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cities.json'), 'utf8'));
  const cityKeys = Object.keys(cities);
  if (opt('--cities') !== undefined) {
    const { keys, unknown } = explicitCities(opt('--cities').split(',').map(s => s.trim()).filter(Boolean), cityKeys);
    if (unknown.length) return { code: 1, out: '', err: `Nieznane miasto: ${unknown.join(', ')}. Dostępne: ${cityKeys.join(', ')}\n` };
    return { code: 0, out: formatSelection(keys, format), err: `Jawna lista (bez rotacji): ${keys.join(', ') || '—'}\n` };
  }
  const state = readState(opt('--state') ?? stateFile ?? path.join(root, 'data', 'osm-state.json'));
  const maxBig = num('--max-big', DEFAULTS.maxBig);
  const picked = selectCities(cityKeys, state, { today: now, limit, minAgeDays, retryDays, maxBig, sizes: walknetSizes(root, cityKeys) });
  const why = picked.map(p => `${p.key}: ${p.reason}${p.ageDays == null ? '' : `, ostatnia próba ${p.ageDays} dni temu`}`).join('\n');
  return { code: 0, out: formatSelection(picked.map(p => p.key), format), err: (why || 'Nic do odświeżenia.') + '\n' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const { code, out, err } = run(process.argv.slice(2), { stateFile: STATE_FILE });
  process.stderr.write(err);
  process.stdout.write(out);
  process.exit(code);
}
