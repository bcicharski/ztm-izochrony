#!/usr/bin/env node
/**
 * Kolektor opóźnień komunikacji miejskiej. Odpytuje źródła czasu rzeczywistego
 * zdefiniowane w data/cities.json (pole "rt") i dolicza obserwacje do
 * kompaktowych agregatów w data/delays/<miasto>.json.
 *
 * Agregat: klucz "linia|typDnia|godzina" (typ dnia: 0=roboczy, 1=sobota,
 * 2=niedziela; godzina lokalna Europe/Warsaw) -> [n, sumaSekund, b0..b5],
 * gdzie b0..b5 to histogram: <-1min, -1..1, 1..3, 3..5, 5..10, >10 min.
 * Z histogramu można później policzyć medianę i percentyle per linia/godzina.
 *
 * Uruchamiany co ~15 min przez GitHub Actions (collect-delays.yml);
 * jedna obserwacja = jeden kurs (pojazd) na jedno odpytanie.
 *
 * Diagnostyka: wynik każdego URL jest klasyfikowany (sukces / HTTP / wyjątek /
 * nie do zdekodowania / sparsowany bez użytecznych pól), a na końcu drukowana
 * jest tabela miast z werdyktem (także do $GITHUB_STEP_SUMMARY). Kod wyjścia 1,
 * gdy miasto ze skonfigurowanym `rt` nie dało ANI JEDNEJ obserwacji — ale
 * dopiero po przetworzeniu wszystkich miast i zapisaniu działających agregatów.
 *
 * Wymaga pakietu gtfs-realtime-bindings (instalowany w workflow, bez zapisu
 * do package.json).
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const UA = { 'User-Agent': 'ztm-izochrony-delays/1.0' };
const BUCKETS = [-60, 60, 180, 300, 600]; // granice histogramu [s]

// lokalny typ dnia i godzina (Actions działa w UTC)
function localSlot(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw', hour: 'numeric', hour12: false, weekday: 'short',
  }).formatToParts(date);
  const wd = parts.find(p => p.type === 'weekday').value;
  const hour = +parts.find(p => p.type === 'hour').value % 24;
  const dayType = wd === 'Sun' ? 2 : wd === 'Sat' ? 1 : 0;
  return { dayType, hour };
}

/** Data lokalna yyyy-mm-dd (Europe/Warsaw) — klucz dziennej pamięci deduplikacji. */
function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(date);
}

function bucketIndex(delaySec) {
  for (let i = 0; i < BUCKETS.length; i++) if (delaySec < BUCKETS[i]) return i;
  return BUCKETS.length;
}

/**
 * Mapa route_id -> nazwa linii z data/<miasto>/meta.json (zapisuje build-data.mjs).
 * Feedy GTFS-RT podają route_id (Kraków tramwaje: "route_5"), a silnik szuka
 * profilu po nazwie linii ("40") — bez tej mapy profile nigdy nie trafiały
 * w linię. Brak mapy (stary meta.json) = zostaje surowe route_id.
 */
function routeNameMap(root, cityKey) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'data', cityKey, 'meta.json'), 'utf8'));
    return meta.routeNames ?? {};
  } catch {
    return {};
  }
}

/**
 * Czysta funkcja: wyciąga obserwacje ze zdekodowanego feedu GTFS-RT
 * (obiekt po FeedMessage.toObject) i liczy statystyki do diagnostyki.
 * Zwraca { obs: Map, stats }, gdzie stats: entities / withTripUpdate /
 * withRouteId / withDelay / sampleRouteIds (maks. 3, same identyfikatory).
 */
export function extractGtfsRtObservations(feed, names, url = '') {
  const obs = new Map();
  const stats = { entities: 0, withTripUpdate: 0, withRouteId: 0, withDelay: 0, sampleRouteIds: [] };
  for (const e of feed?.entity ?? []) {
    stats.entities++;
    const tu = e.tripUpdate;
    if (!tu) continue;
    stats.withTripUpdate++;
    if (!tu.trip?.routeId) continue; // bez linii obserwacja jest bezużyteczna
    stats.withRouteId++;
    const routeId = String(tu.trip.routeId);
    if (stats.sampleRouteIds.length < 3 && !stats.sampleRouteIds.includes(routeId)) {
      stats.sampleRouteIds.push(routeId);
    }
    let delay = tu.delay;
    if (delay === undefined || delay === null) {
      delay = undefined;
      for (const stu of tu.stopTimeUpdate ?? []) {
        const d = stu.arrival?.delay ?? stu.departure?.delay;
        if (d !== undefined && d !== null) { delay = d; break; }
      }
    }
    if (delay === undefined) continue;
    stats.withDelay++;
    obs.set(`${url}|${tu.trip.tripId ?? e.id}`, { route: names[routeId] ?? routeId, delaySec: delay });
  }
  return { obs, stats };
}

/**
 * Czysta funkcja: klasyfikuje wynik odpytania jednego URL.
 * Wejście: { url, obsCount, http, error, decodeError, stats, raw }.
 * Wyjście: { url, kind, detail } — kind jedno z:
 *   ok            — doszły obserwacje
 *   http          — odpowiedź z kodem HTTP != 2xx
 *   exception     — wyjątek sieciowy (fetch rzucił)
 *   undecodable   — HTTP 2xx, ale treść nie jest feedem (np. HTML ze stroną błędu)
 *   no-entities   — sparsowane, ale feed bez encji
 *   no-tripupdate — encje są, żadna nie ma tripUpdate (inny kształt feedu)
 *   no-routeid    — są tripUpdate, żaden nie ma trip.routeId
 *   no-delay      — są routeId, żaden kurs nie ma delay
 */
export function classifyUrlResult(r) {
  const { url } = r;
  if (r.error) return { url, kind: 'exception', detail: r.error };
  if (r.http && !r.http.ok) return { url, kind: 'http', detail: `HTTP ${r.http.status}` };
  if (r.decodeError) {
    const h = r.http ?? {};
    const preview = String(r.raw?.preview ?? '').replace(/[^\x20-\x7e]/g, '.').slice(0, 80);
    return {
      url, kind: 'undecodable',
      detail: `HTTP ${h.status}, content-type: ${h.contentType || '?'}, ${r.raw?.size ?? '?'} B, `
        + `dekodowanie: ${r.decodeError}, początek: "${preview}"`,
    };
  }
  if ((r.obsCount ?? 0) > 0) return { url, kind: 'ok', detail: `${r.obsCount} obserwacji` };
  const s = r.stats ?? {};
  const diag = `encji ${s.entities ?? 0}, z tripUpdate ${s.withTripUpdate ?? 0}, `
    + `z routeId ${s.withRouteId ?? 0}, z delay ${s.withDelay ?? 0}, `
    + `przykładowe routeId: [${(s.sampleRouteIds ?? []).join(', ')}]`;
  const kind = !s.entities ? 'no-entities'
    : !s.withTripUpdate ? 'no-tripupdate'
      : !s.withRouteId ? 'no-routeid'
        : 'no-delay';
  return { url, kind, detail: diag };
}

/**
 * Werdykt miasta z wyników URL-i. `configured` = miasto ma pole rt.
 * ok (>0 obserwacji) | fail (rt, zero obserwacji) | skip (brak rt).
 */
export function cityVerdict(configured, obsCount, urlResults = []) {
  if (!configured) return { status: 'skip', reason: 'brak rt' };
  if (obsCount > 0) return { status: 'ok', reason: `${obsCount} obserwacji` };
  const kinds = [...new Set(urlResults.map(u => u.kind))];
  return { status: 'fail', reason: kinds.length ? kinds.join('+') : 'brak URL-i' };
}

/** Kod wyjścia: 1, gdy którekolwiek miasto z rt ma werdykt fail. */
export function exitCodeFor(reports) {
  return reports.some(r => r.verdict.status === 'fail') ? 1 : 0;
}

/** Tabela markdown (log + $GITHUB_STEP_SUMMARY). */
export function renderSummary(reports) {
  const icon = { ok: 'OK', fail: 'BŁĄD', skip: 'pominięte' };
  const rows = reports.filter(r => r.verdict.status !== 'skip').map(r => {
    const details = r.urlResults.filter(u => u.kind !== 'ok').map(u => `${u.kind}: ${u.detail}`).join(' ; ');
    return `| ${r.cityKey} | ${icon[r.verdict.status]} | ${r.verdict.reason} | ${details.replace(/\|/g, '\\|')} |`;
  });
  return ['| Miasto | Werdykt | Wynik | Szczegóły (URL-e bez obserwacji) |', '|---|---|---|---|', ...rows].join('\n');
}

/** Odpytuje jeden URL GTFS-RT; zwraca surowy wynik dla classifyUrlResult. */
async function fetchGtfsRtUrl(url, names, transit_realtime, fetchImpl = fetch) {
  const r = { url, obs: new Map(), obsCount: 0 };
  try {
    const res = await fetchImpl(url, { headers: UA });
    r.http = { ok: res.ok, status: res.status, contentType: res.headers?.get?.('content-type') ?? '' };
    if (!res.ok) return r;
    const bytes = new Uint8Array(await res.arrayBuffer());
    try {
      const decoded = transit_realtime.FeedMessage.decode(bytes);
      // toObject bez defaults: pola nieobecne w feedzie są undefined
      // (surowa instancja materializuje protobufowe zera, co fałszuje dane)
      const feed = transit_realtime.FeedMessage.toObject(decoded, { defaults: false });
      const { obs, stats } = extractGtfsRtObservations(feed, names, url);
      r.obs = obs; r.obsCount = obs.size; r.stats = stats;
    } catch (err) {
      r.decodeError = err.message;
      r.raw = { size: bytes.length, preview: new TextDecoder().decode(bytes.slice(0, 80)) };
    }
  } catch (err) {
    r.error = err.message;
  }
  return r;
}

/** Obserwacje z feedów GTFS-RT TripUpdates: { obs, urlResults }. */
async function fromGtfsRt(urls, names, fetchImpl = fetch, decoder = null) {
  const transit_realtime = decoder ?? (await import('gtfs-realtime-bindings')).default.transit_realtime;
  const obs = new Map();
  const urlResults = [];
  for (const url of urls) {
    const r = await fetchGtfsRtUrl(url, names, transit_realtime, fetchImpl);
    for (const [k, v] of r.obs) obs.set(k, v);
    urlResults.push(classifyUrlResult(r));
  }
  return { obs, urlResults };
}

/** Obserwacje z API estymacji ZTM Gdańsk: jedna na kurs (pole trip). */
async function fromGdanskDepartures(url, fetchImpl = fetch) {
  const obs = new Map();
  const r = { url, obsCount: 0, stats: { entities: 0, withTripUpdate: 0, withRouteId: 0, withDelay: 0, sampleRouteIds: [] } };
  try {
    const res = await fetchImpl(url, { headers: UA });
    r.http = { ok: res.ok, status: res.status, contentType: res.headers?.get?.('content-type') ?? '' };
    if (res.ok) {
      const data = await res.json();
      for (const stop of Object.values(data)) {
        for (const dep of stop.departures ?? []) {
          r.stats.entities++;
          r.stats.withTripUpdate++;
          r.stats.withRouteId++;
          if (dep.status !== 'REALTIME' || dep.delayInSeconds == null) continue;
          r.stats.withDelay++;
          const key = String(dep.trip ?? `${dep.routeId}|${dep.vehicleId}`);
          if (!obs.has(key)) {
            obs.set(key, { route: String(dep.routeShortName ?? dep.routeId), delaySec: dep.delayInSeconds });
          }
        }
      }
      r.obsCount = obs.size;
    }
  } catch (err) {
    r.error = err.message;
  }
  return { obs, urlResults: [classifyUrlResult(r)] };
}

/**
 * Odpytuje źródło rt jednego miasta. Nigdy nie rzuca: wyjątek i nieznany typ
 * źródła stają się wpisem urlResults (kind 'exception'), więc awaria jednego
 * miasta trafia do podsumowania, a pozostałe miasta są dalej zbierane.
 * deps: { names, fetchImpl, decoder } — wstrzykiwane w testach (bez sieci).
 */
export async function collectCity(cfg, { names = {}, fetchImpl = fetch, decoder = null } = {}) {
  try {
    if (cfg.rt.type === 'gtfsrt') return await fromGtfsRt(cfg.rt.urls, names, fetchImpl, decoder);
    if (cfg.rt.type === 'gdansk-departures') return await fromGdanskDepartures(cfg.rt.url, fetchImpl);
    return { obs: new Map(), urlResults: [{ url: '-', kind: 'exception', detail: `nieznany typ rt: ${cfg.rt.type}` }] };
  } catch (err) {
    return { obs: new Map(), urlResults: [{ url: '-', kind: 'exception', detail: err.message }] };
  }
}

/**
 * Wczytuje agregat miasta. Brak pliku = pierwszy przebieg ({}), to nie awaria.
 * Plik nieczytelny albo nie będący obiektem JSON rzuca — wołający zgłasza to
 * jako awarię miasta i NIE nadpisuje pliku (historia zbiera się tygodniami).
 */
function readAggregate(file) {
  if (!fs.existsSync(file)) return {};
  const agg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (agg === null || typeof agg !== 'object' || Array.isArray(agg)) throw new Error('agregat nie jest obiektem JSON');
  return agg;
}

/**
 * Zapis atomowy (konwencja jak w transxchange-to-gtfs: plik tymczasowy, na
 * końcu rename). Plik tymczasowy leży w tym samym katalogu co docelowy, więc
 * rename jest atomowy; po błędzie jest sprzątany, a plik docelowy nietknięty.
 */
export function writeAggregate(file, agg) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(agg));
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Dolicza obserwacje do agregatu `agg` (mutuje go) z deduplikacją kursów.
 * Zwraca { added, dup }.
 */
export function mergeObservations(agg, obs, { dayType, hour, today }) {
  // Deduplikacja: ten sam kurs widziany w kolejnych odpytaniach liczył się
  // wielokrotnie (co 10 min = kilka próbek jednego pojazdu), więc próg MIN_OBS
  // osiągał jeden autobus w jedno popołudnie. Każdy kurs wchodzi do agregatu
  // raz na godzinę w danym dniu (pierwsza obserwacja); pamięć w polu `_seen`,
  // zerowana przy zmianie daty. build-delays.mjs pomija klucze zaczynające
  // się od `_`.
  const seen = agg._seen?.date === today ? agg._seen : { date: today, keys: {} };
  let added = 0, dup = 0;
  for (const [tripKey, { route, delaySec }] of obs) {
    const seenKey = `${tripKey}|${hour}`;
    if (seen.keys[seenKey]) { dup++; continue; }
    seen.keys[seenKey] = 1;
    const key = `${route}|${dayType}|${hour}`;
    const row = agg[key] ?? [0, 0, 0, 0, 0, 0, 0, 0];
    row[0] += 1;
    row[1] += delaySec;
    row[2 + bucketIndex(delaySec)] += 1;
    agg[key] = row;
    added++;
  }
  agg._seen = seen;
  return { added, dup };
}

/**
 * Przetwarza wszystkie miasta. Awaria jednego (uszkodzony agregat, błąd zapisu,
 * brak uprawnień) staje się werdyktem fail tego miasta i nie przerywa pętli.
 * Zwraca { reports, totalObs }. deps: collect, now — wstrzykiwane w testach.
 */
export async function runCollection(cities, { root, collect = collectCity, now = new Date() } = {}) {
  const outDir = path.join(root, 'data', 'delays');
  const { dayType, hour } = localSlot(now);
  const today = localDate(now);
  let totalObs = 0;
  const reports = [];

  for (const [cityKey, cfg] of Object.entries(cities)) {
    if (!cfg.rt) { reports.push({ cityKey, verdict: cityVerdict(false, 0), urlResults: [] }); continue; }
    const { obs, urlResults } = await collect(cfg, { names: routeNameMap(root, cityKey) });
    for (const u of urlResults) if (u.kind !== 'ok') console.warn(`${cityKey}: ${u.kind} — ${u.url} — ${u.detail}`);
    const verdict = cityVerdict(true, obs.size, urlResults);
    const report = { cityKey, verdict, urlResults };
    reports.push(report);
    if (obs.size === 0) { console.warn(`${cityKey}: brak obserwacji`); continue; }

    const file = path.join(outDir, `${cityKey}.json`);
    let agg;
    try {
      agg = readAggregate(file);
    } catch (err) {
      // Nieczytelny agregat: nie zapisujemy nic (plik zostaje nietknięty do
      // ręcznej naprawy), miasto dostaje werdykt fail, reszta jedzie dalej.
      report.verdict = { status: 'fail', reason: 'agregat nieczytelny' };
      report.urlResults = [...urlResults, { url: file, kind: 'aggregate-unreadable', detail: err.message }];
      console.warn(`${cityKey}: agregat nieczytelny, pomijam zapis (plik nietknięty) — ${err.message}`);
      continue;
    }
    const { added, dup } = mergeObservations(agg, obs, { dayType, hour, today });
    try {
      writeAggregate(file, agg);
    } catch (err) {
      report.verdict = { status: 'fail', reason: 'zapis agregatu nieudany' };
      report.urlResults = [...urlResults, { url: file, kind: 'aggregate-write-failed', detail: err.message }];
      console.warn(`${cityKey}: zapis agregatu nieudany — ${err.message}`);
      continue;
    }
    totalObs += added;
    console.log(`${cityKey}: ${obs.size} obserwacji, nowych ${added}, powtórzonych ${dup} (slot ${dayType}/${hour}), kluczy: ${Object.keys(agg).length - 1}`);
  }
  return { reports, totalObs };
}

async function main() {
  const root = path.join(import.meta.dirname, '..');
  const cities = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cities.json'), 'utf8'));
  const { reports, totalObs } = await runCollection(cities, { root });

  console.log(`Razem: ${totalObs} obserwacji.`);
  const summary = renderSummary(reports);
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Kolektor opóźnień\n\n${summary}\n`); } catch { /* podsumowanie jest dodatkiem */ }
  }
  const failed = reports.filter(r => r.verdict.status === 'fail').map(r => r.cityKey);
  if (failed.length) console.error(`BŁĄD: miasta z rt bez zapisanych obserwacji: ${failed.join(', ')}`);
  process.exitCode = exitCodeFor(reports);
}

// uruchamiaj tylko jako skrypt (import w testach nie odpytuje sieci)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
