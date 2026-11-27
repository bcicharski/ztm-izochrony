/**
 * Mapa „identyfikator kursu -> route_id" dla kolektora opóźnień (Z-019).
 *
 * Część feedów GTFS-RT (Szczecin) nie podaje routeId w tripUpdate, ale tripId
 * jest tym samym, co w publikowanym GTFS (trips.txt). Mapę budujemy z trips.txt
 * raz na wersję rozkładu i trzymamy na gałęzi "delays" (data/delays-cache/),
 * a nie pobieramy GTFS przy każdym przebiegu (kolektor chodzi co 15 minut).
 *
 * Odświeżanie (czysta decyzja: tripMapDecision):
 *  - brak mapy                      -> budowa,
 *  - starsza niż MAX_AGE            -> budowa (siatka bezpieczeństwa),
 *  - co CHECK_EVERY zapytanie HEAD o ETag/Last-Modified/Content-Length pliku;
 *    zmiana sygnatury               -> budowa,
 *  - wymuszenie (kolektor widzi, że dużo kursów nie ma w mapie) -> budowa,
 *    ale nie częściej niż FORCE_MIN_AGE.
 * Nieaktualna mapa nigdy nie przypisuje opóźnień „na oko": kurs spoza mapy
 * jest pomijany (patrz extractGtfsRtObservations).
 *
 * Bez zależności: własny, minimalny czytnik ZIP na node:zlib.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { splitCsv } from './build-lib.mjs';

export const MAX_AGE_MS = 7 * 24 * 3600e3;
export const CHECK_EVERY_MS = 6 * 3600e3;
export const FORCE_MIN_AGE_MS = 2 * 3600e3;
const UA = { 'User-Agent': 'ztm-izochrony-delays/1.0' };

/** Zawartość jednego pliku z archiwum ZIP (Buffer) albo null, gdy go nie ma. */
export function readZipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('to nie jest archiwum ZIP (brak katalogu centralnego)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('uszkodzony katalog centralny ZIP');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      if (csize === 0xffffffff || local === 0xffffffff) throw new Error('ZIP64 nieobsługiwany');
      const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(dataAt, dataAt + csize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`nieobsługiwana metoda kompresji ZIP: ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** trips.txt (tekst) -> { trip_id: route_id }. Brak kolumn = wyjątek. */
export function parseTripsText(text) {
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const lines = body.split(/\r?\n/);
  const header = splitCsv(lines[0]).map(h => h.trim());
  const iTrip = header.indexOf('trip_id'), iRoute = header.indexOf('route_id');
  if (iTrip < 0 || iRoute < 0) throw new Error('trips.txt bez kolumn trip_id/route_id');
  const trips = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsv(lines[i]);
    if (c[iTrip] !== undefined && c[iRoute]) trips[c[iTrip]] = c[iRoute];
  }
  return trips;
}

/** Sygnatura wersji pliku z nagłówków odpowiedzi (HEAD/GET); null, gdy brak. */
export function signatureFromHeaders(headers) {
  const g = k => headers?.get?.(k) ?? null;
  const sig = { etag: g('etag'), lastModified: g('last-modified'), length: g('content-length') };
  return sig.etag || sig.lastModified || sig.length ? sig : null;
}

/** Czy dwie sygnatury opisują inną wersję pliku (porównuje pola obecne w obu). */
export function signaturesDiffer(a, b) {
  if (!a || !b) return false; // brak danych = nie wiadomo, nie budujemy
  return ['etag', 'lastModified', 'length'].some(k => a[k] && b[k] && a[k] !== b[k]);
}

/**
 * Czysta decyzja o odświeżeniu. map: zapisana mapa albo null; headSig: tablica
 * sygnatur z HEAD (undefined = jeszcze nie pytano). Wynik: 'keep' | 'build' |
 * 'check'. 'check' = czas na HEAD (wołający pyta serwer i woła ponownie
 * z headSig).
 */
export function tripMapDecision(map, { now = Date.now(), headSig, force = false } = {}) {
  if (!map?.trips || !map.builtAt) return 'build';
  const age = now - Date.parse(map.builtAt);
  if (!(age >= 0) || age > MAX_AGE_MS) return 'build';
  if (force) return age >= FORCE_MIN_AGE_MS ? 'build' : 'keep';
  const sinceCheck = now - Date.parse(map.checkedAt ?? map.builtAt);
  if (!(sinceCheck >= CHECK_EVERY_MS)) return 'keep';
  if (headSig === undefined) return 'check';
  const changed = (map.sigs ?? []).some((s, i) => signaturesDiffer(s, headSig[i]));
  return changed ? 'build' : 'keep';
}

/** Źródła GTFS, z których da się zbudować mapę: bezpośredni URL, format gtfs. */
export function mapFeeds(cfg) {
  const feeds = cfg.feeds ?? [];
  if (!feeds.length) return null;
  const ok = feeds.every(f => f.url && !f.resolve && (f.format ?? 'gtfs') === 'gtfs');
  return ok ? feeds : null;
}

export function readTripMap(file) {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    return m && typeof m === 'object' && m.trips && typeof m.trips === 'object' ? m : null;
  } catch {
    return null; // brak albo uszkodzona = jak brak (to stan normalny)
  }
}

function writeTripMap(file, map) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(map));
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const feedHeaders = f => ({ ...UA, ...(f.accept ? { Accept: f.accept } : {}) });

async function headSignatures(feeds, fetchImpl) {
  try {
    return await Promise.all(feeds.map(async f => {
      const res = await fetchImpl(f.url, { method: 'HEAD', headers: feedHeaders(f), signal: AbortSignal.timeout(20000) });
      return res.ok ? signatureFromHeaders(res.headers) : null;
    }));
  } catch {
    return feeds.map(() => null);
  }
}

async function buildMap(feeds, fetchImpl, now) {
  const trips = {};
  const sigs = [];
  for (const f of feeds) {
    const res = await fetchImpl(f.url, { headers: feedHeaders(f), redirect: 'follow', signal: AbortSignal.timeout(90000) });
    if (!res.ok) throw new Error(`${f.name ?? f.url}: HTTP ${res.status}`);
    const entry = readZipEntry(Buffer.from(await res.arrayBuffer()), 'trips.txt');
    if (!entry) throw new Error(`${f.name ?? f.url}: brak trips.txt w archiwum`);
    Object.assign(trips, parseTripsText(entry.toString('utf8')));
    sigs.push(signatureFromHeaders(res.headers));
  }
  const iso = new Date(now).toISOString();
  return { v: 1, builtAt: iso, checkedAt: iso, sigs, trips };
}

/**
 * Dostawca mapy kursów jednego miasta (memoizowany na czas przebiegu).
 * Wołany leniwie, tylko gdy feed ma kursy bez routeId. Nigdy nie rzuca.
 * provider({ force }) -> { state, trips?, builtAt?, detail? }, gdzie state:
 *   'ok'          — mapa z cache (świeża albo potwierdzona HEAD-em),
 *   'rebuilt'     — zbudowana w tym przebiegu (pobrano GTFS),
 *   'limited'     — wymuszenie odrzucone (mapa młodsza niż FORCE_MIN_AGE),
 *   'unsupported' — miasto nie ma bezpośredniego feedu GTFS (nie da się),
 *   'unavailable' — budowa nieudana i brak użytecznej mapy.
 */
export function makeTripMapProvider(cityKey, cfg, { root, fetchImpl = fetch, now = Date.now() } = {}) {
  const file = path.join(root, 'data', 'delays-cache', `${cityKey}.trips.json`);
  const feeds = mapFeeds(cfg);
  let current;
  let rebuilt = false;
  let loaded = false;

  async function resolve({ force = false } = {}) {
    if (!feeds) return { state: 'unsupported', detail: 'feed GTFS bez bezpośredniego adresu (resolve) lub w obcym formacie' };
    if (!loaded) { current = readTripMap(file); loaded = true; }
    let action = tripMapDecision(current, { now, force });
    if (action === 'check') {
      const sigs = await headSignatures(feeds, fetchImpl);
      action = tripMapDecision(current, { now, headSig: sigs });
      if (action === 'keep') {
        current.checkedAt = new Date(now).toISOString();
        try { writeTripMap(file, current); } catch { /* znacznik sprawdzenia to dodatek */ }
      }
    }
    if (action === 'build' && rebuilt) action = 'keep'; // raz na przebieg
    if (action === 'build') {
      try {
        current = await buildMap(feeds, fetchImpl, now);
        rebuilt = true;
        try { writeTripMap(file, current); } catch (err) { console.warn(`${cityKey}: zapis mapy kursów nieudany — ${err.message}`); }
        console.log(`${cityKey}: zbudowano mapę kursów (${Object.keys(current.trips).length} kursów)`);
      } catch (err) {
        if (!current?.trips) return { state: 'unavailable', detail: err.message };
        console.warn(`${cityKey}: odświeżenie mapy kursów nieudane (${err.message}) — używam poprzedniej`);
      }
    }
    if (!current?.trips) return { state: 'unavailable', detail: 'brak mapy kursów' };
    const state = rebuilt ? 'rebuilt' : force && action === 'keep' ? 'limited' : 'ok';
    return { state, trips: current.trips, builtAt: current.builtAt };
  }

  let memo = null;
  return async opts => {
    if (opts?.force) return resolve(opts);
    memo ??= resolve({});
    return memo;
  };
}
