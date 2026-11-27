/**
 * Stan odświeżania danych OSM (Z-023): kiedy ostatnio próbowano przeliczyć
 * walknet/wodę/mosty dla każdego miasta i jak to się skończyło.
 *
 * Plik `data/osm-state.json` jest JEDEN dla repozytorium, a nie leży w
 * `data/<miasto>/` — to celowe. Wpis per miasto zostałby cofnięty razem z
 * danymi miasta, gdy nowa wersja nie zaliczy bramki, i rotacja wpadłaby w
 * pętlę (to samo miasto wybierane w kółko). Front tego pliku nie pobiera.
 *
 * Kształt:
 *   { "version": 1, "cities": { "<miasto>": {
 *       "lastAttempt": "2026-11-27",   // ostatnia PRÓBA (także nieudana)
 *       "lastSuccess": "2026-11-27",   // ostatnie powodzenie (po bramce)
 *       "result": "ok" | "gate" | "error",
 *       "note": "tekst" } } }
 *
 * Wszystkie narzędzia muszą tolerować brak pliku (pusty stan) i nieznane klucze.
 */

import fs from 'node:fs';
import path from 'node:path';

export const STATE_FILE = path.join(import.meta.dirname, '..', 'data', 'osm-state.json');
export const RESULTS = ['ok', 'gate', 'error'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const validDay = v => typeof v === 'string' && ISO_DAY.test(v) && !Number.isNaN(Date.parse(v));

/** Pojedynczy wpis bez nieznanych kluczy i ze złymi wartościami odrzuconymi; null, gdy nic nie zostało. */
function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const e = {};
  if (validDay(raw.lastAttempt)) e.lastAttempt = raw.lastAttempt;
  if (validDay(raw.lastSuccess)) e.lastSuccess = raw.lastSuccess;
  if (RESULTS.includes(raw.result)) e.result = raw.result;
  if (typeof raw.note === 'string' && raw.note) e.note = raw.note;
  return e.lastAttempt || e.lastSuccess ? e : null;
}

/** Normalizuje surowy obiekt: ignoruje nieznane klucze najwyższego poziomu i wpisów. */
export function normalizeState(raw) {
  const cities = {};
  const src = raw && typeof raw === 'object' && raw.cities && typeof raw.cities === 'object' ? raw.cities : {};
  for (const [key, entry] of Object.entries(src)) {
    const e = cleanEntry(entry);
    if (e) cities[key] = e;
  }
  return { version: 1, cities };
}

/** Czyta stan; brak pliku albo uszkodzony JSON = pusty stan (nigdy wyjątek). */
export function readState(file = STATE_FILE) {
  try { return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return normalizeState(null); }
}

/** Zapis atomowy (plik tymczasowy + rename), klucze posortowane — diff w gicie jest czytelny. */
export function writeState(state, file = STATE_FILE) {
  const clean = normalizeState(state);
  const sorted = { version: 1, cities: Object.fromEntries(Object.keys(clean.cities).sort().map(k => [k, clean.cities[k]])) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/**
 * Czysto: stan po próbie odświeżenia miasta. `ok` przesuwa też `lastSuccess`;
 * `gate`/`error` zostawiają go bez zmian. Zwraca NOWY obiekt.
 * @param {{cities: object}} state
 * @param {string} key
 * @param {{date: string, result: 'ok'|'gate'|'error', note?: string}} attempt
 */
export function recordAttempt(state, key, { date, result, note = '' }) {
  if (!RESULTS.includes(result)) throw new Error(`osm-state: nieznany wynik «${result}»`);
  if (!validDay(date)) throw new Error(`osm-state: zła data «${date}» (oczekiwano RRRR-MM-DD)`);
  const prev = state.cities?.[key] ?? {};
  const entry = { ...prev, lastAttempt: date, result };
  if (result === 'ok') entry.lastSuccess = date;
  if (note) entry.note = note; else delete entry.note;
  return normalizeState({ cities: { ...state.cities, [key]: entry } });
}

/** Wiek w pełnych dniach od daty ISO do `today` (Date, liczone w UTC); null przy braku/złej dacie. */
export function ageDays(day, today = new Date()) {
  if (!validDay(day)) return null;
  const ms = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - Date.parse(day);
  return Math.max(0, Math.round(ms / 86400000));
}
