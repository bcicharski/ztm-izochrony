// Z-019: linia z identyfikatora kursu (mapa tripId -> route_id) w kolektorze opóźnień.
// Bez sieci: pobieranie i dekoder GTFS-RT są atrapami, katalog roboczy — tymczasowy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  extractGtfsRtObservations, extractWithTripMap, collectCity, cityVerdict, exitCodeFor, renderSummary, runCollection,
} from '../tools/collect-delays.mjs';
import {
  readZipEntry, parseTripsText, tripMapDecision, signaturesDiffer, makeTripMapProvider, mapFeeds,
  CHECK_EVERY_MS, MAX_AGE_MS, FORCE_MIN_AGE_MS,
} from '../tools/trip-map.mjs';

const U = 'https://example.test/tu.pb';
const NAMES = { R1: '10', R2: '20' };
const TRIPS = { t1: 'R1', t2: 'R2', tX: 'R9' }; // R9 nie ma nazwy w meta.json
const noRoute = (id, delay) => ({ id, tripUpdate: { trip: { tripId: id }, delay } });

// --- minimalny ZIP z jednym plikiem (deflate) ---
function makeZip(name, content, method = 8) {
  const raw = Buffer.from(content, 'utf8');
  const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const centralAt = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12); eocd.writeUInt32LE(centralAt, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}
const TRIPS_TXT = '﻿route_id,service_id,trip_id,trip_headsign\nR1,s,t1,"Centrum, Dom"\nR2,s,t2,Port\n';

test('ZIP: odczyt pliku (deflate i stored), brak pliku = null, nie-ZIP = wyjątek', () => {
  assert.equal(readZipEntry(makeZip('trips.txt', TRIPS_TXT), 'trips.txt').toString('utf8'), TRIPS_TXT);
  assert.equal(readZipEntry(makeZip('trips.txt', 'abc', 0), 'trips.txt').toString(), 'abc');
  assert.equal(readZipEntry(makeZip('stops.txt', 'x'), 'trips.txt'), null);
  assert.throws(() => readZipEntry(Buffer.from('<html>błąd</html>'.repeat(5)), 'trips.txt'), /ZIP/);
});

test('trips.txt -> mapa: BOM, cudzysłowy z przecinkiem, brak kolumn = wyjątek', () => {
  assert.deepEqual(parseTripsText(TRIPS_TXT), { t1: 'R1', t2: 'R2' });
  assert.throws(() => parseTripsText('a,b\n1,2\n'), /trip_id/);
});

// --- ekstrakcja ---

test('encja bez linii, ale z kursem w mapie, daje obserwację z właściwą linią', () => {
  const { obs, stats } = extractGtfsRtObservations({ entity: [noRoute('t1', 90), noRoute('t2', 30)] }, NAMES, U, TRIPS);
  assert.equal(obs.get(`${U}|t1`).route, '10');
  assert.equal(obs.get(`${U}|t2`).route, '20');
  assert.deepEqual([stats.withoutRoute, stats.viaTripMap, stats.unmapped, stats.withRouteId], [2, 2, 0, 2]);
});

test('kurs spoza mapy jest pomijany, nie przypisywany; to samo dla route_id bez nazwy', () => {
  const feed = { entity: [noRoute('t1', 10), noRoute('nieznany', 999), noRoute('tX', 999), { id: 'b', tripUpdate: { delay: 5 } }] };
  const { obs, stats } = extractGtfsRtObservations(feed, NAMES, U, TRIPS);
  assert.deepEqual([...obs.keys()], [`${U}|t1`]);
  assert.equal(stats.unmapped, 3); // nieznany, tX (route bez nazwy) i encja bez tripId
});

test('linia z feedu ma pierwszeństwo przed mapą; bez mapy zachowanie jak dotąd', () => {
  const feed = { entity: [
    { id: 'a', tripUpdate: { trip: { tripId: 't1', routeId: 'R2' }, delay: 60 } },
    noRoute('t2', 5),
  ] };
  const withMap = extractGtfsRtObservations(feed, NAMES, U, TRIPS);
  assert.equal(withMap.obs.get(`${U}|t1`).route, '20'); // routeId z feedu, nie z mapy
  const without = extractGtfsRtObservations(feed, NAMES, U);
  assert.deepEqual([...without.obs.keys()], [`${U}|t1`]); // t2 bez linii i bez mapy: pominięty
  assert.equal(without.stats.unmapped, 0); // bez mapy nie liczymy „spoza mapy"
});

// --- decyzja o odświeżeniu ---

const T0 = Date.parse('2026-11-27T10:00:00Z');
const fresh = (over = {}) => ({ trips: { a: 'b' }, builtAt: new Date(T0).toISOString(), checkedAt: new Date(T0).toISOString(), sigs: [{ etag: 'e1', length: '10' }], ...over });

test('decyzja: brak mapy = budowa; świeża = keep; po CHECK_EVERY = check, potem wg HEAD', () => {
  assert.equal(tripMapDecision(null, { now: T0 }), 'build');
  assert.equal(tripMapDecision({ trips: {} }, { now: T0 }), 'build'); // bez builtAt
  assert.equal(tripMapDecision(fresh(), { now: T0 + 3600e3 }), 'keep');
  const later = T0 + CHECK_EVERY_MS + 1;
  assert.equal(tripMapDecision(fresh(), { now: later }), 'check');
  assert.equal(tripMapDecision(fresh(), { now: later, headSig: [{ etag: 'e1', length: '10' }] }), 'keep');
  assert.equal(tripMapDecision(fresh(), { now: later, headSig: [{ etag: 'e2', length: '10' }] }), 'build');
  assert.equal(tripMapDecision(fresh(), { now: later, headSig: [null] }), 'keep'); // HEAD nie działa: nie wiadomo
});

test('decyzja: wiek ponad MAX_AGE = budowa; wymuszenie respektuje FORCE_MIN_AGE', () => {
  assert.equal(tripMapDecision(fresh(), { now: T0 + MAX_AGE_MS + 1 }), 'build');
  assert.equal(tripMapDecision(fresh(), { now: T0 + FORCE_MIN_AGE_MS - 1, force: true }), 'keep');
  assert.equal(tripMapDecision(fresh(), { now: T0 + FORCE_MIN_AGE_MS, force: true }), 'build');
  assert.equal(tripMapDecision(fresh({ builtAt: 'śmieci' }), { now: T0 }), 'build');
  assert.equal(signaturesDiffer({ etag: 'a' }, { etag: 'a', length: '1' }), false);
  assert.equal(signaturesDiffer({ lastModified: 'x' }, { lastModified: 'y' }), true);
});

test('mapFeeds: tylko bezpośrednie feedy GTFS', () => {
  assert.equal(mapFeeds({ feeds: [{ url: 'u' }] }).length, 1);
  assert.equal(mapFeeds({ feeds: [{ url: 'u', resolve: 'ckan-latest' }] }), null);
  assert.equal(mapFeeds({ feeds: [{ url: 'u', format: 'transxchange' }] }), null);
  assert.equal(mapFeeds({}), null);
});

// --- dostawca mapy (cache na dysku, HEAD, awarie) ---

const mkRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ztm-trips-'));
const CFG = { feeds: [{ name: 'f', url: 'https://example.test/gtfs.zip' }] };
const cacheFile = root => path.join(root, 'data', 'delays-cache', 'x.trips.json');
const quiet = async fn => {
  const w = console.warn, l = console.log;
  console.warn = console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.log = l; }
};
/** Atrapa serwera GTFS: liczy GET-y i HEAD-y; wersja pliku w `state.etag`. */
function fakeServer(state = { etag: 'v1', status: 200, tripsTxt: TRIPS_TXT }) {
  const calls = { get: 0, head: 0 };
  const fetchImpl = async (url, opts = {}) => {
    const head = opts.method === 'HEAD';
    calls[head ? 'head' : 'get']++;
    const headers = { get: k => ({ etag: state.etag, 'content-length': '123' })[k] ?? null };
    if (state.status !== 200) return { ok: false, status: state.status, headers };
    const body = head ? Buffer.alloc(0) : makeZip('trips.txt', state.tripsTxt);
    return { ok: true, status: 200, headers, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
  return { fetchImpl, calls, state };
}

test('dostawca: pierwszy przebieg buduje mapę raz i zapisuje; kolejny przebieg nie pobiera GTFS', async () => {
  const root = mkRoot(), srv = fakeServer();
  const p1 = makeTripMapProvider('x', CFG, { root, fetchImpl: srv.fetchImpl, now: T0 });
  const r1 = await quiet(() => p1());
  assert.equal(r1.state, 'rebuilt');
  assert.deepEqual(r1.trips, { t1: 'R1', t2: 'R2' });
  await p1(); // memoizacja w obrębie przebiegu
  assert.equal(srv.calls.get, 1);
  assert.ok(fs.existsSync(cacheFile(root)));
  // 15 minut później: nowy przebieg (nowy provider), mapa z dysku, zero ruchu do serwera
  const r2 = await makeTripMapProvider('x', CFG, { root, fetchImpl: srv.fetchImpl, now: T0 + 15 * 60e3 })();
  assert.equal(r2.state, 'ok');
  assert.deepEqual([srv.calls.get, srv.calls.head], [1, 0]);
});

test('dostawca: po CHECK_EVERY tylko HEAD, gdy plik bez zmian; GET dopiero po zmianie wersji', async () => {
  const root = mkRoot(), srv = fakeServer();
  await quiet(() => makeTripMapProvider('x', CFG, { root, fetchImpl: srv.fetchImpl, now: T0 })());
  const later = T0 + CHECK_EVERY_MS + 1000;
  const same = await makeTripMapProvider('x', CFG, { root, fetchImpl: srv.fetchImpl, now: later })();
  assert.equal(same.state, 'ok');
  assert.deepEqual([srv.calls.get, srv.calls.head], [1, 1]);
  // znacznik sprawdzenia zapisany: przebieg chwilę później nie pyta ponownie
  await makeTripMapProvider('x', CFG, { root, fetchImpl: srv.fetchImpl, now: later + 15 * 60e3 })();
  assert.equal(srv.calls.head, 1);
  // przewoźnik publikuje nową wersję
  srv.state.etag = 'v2';
  srv.state.tripsTxt = 'route_id,trip_id\nR2,nowy\n';
  const next = await quiet(() => makeTripMapProvider('x', CFG, { root, fetchImpl: srv.fetchImpl, now: later + CHECK_EVERY_MS + 2000 })());
  assert.equal(next.state, 'rebuilt');
  assert.deepEqual(next.trips, { nowy: 'R2' }); // stare kursy zniknęły z mapy
  assert.equal(srv.calls.get, 2);
});

test('dostawca: brak mapy i nieudane pobranie = unavailable, bez wyjątku; uszkodzony plik = jak brak', async () => {
  const root = mkRoot(), srv = fakeServer({ etag: 'v1', status: 503 });
  const r = await quiet(() => makeTripMapProvider('x', CFG, { root, fetchImpl: srv.fetchImpl, now: T0 })());
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /503/);
  fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
  fs.writeFileSync(cacheFile(root), '{"trips": {"a"');
  const ok = fakeServer();
  const r2 = await quiet(() => makeTripMapProvider('x', CFG, { root, fetchImpl: ok.fetchImpl, now: T0 })());
  assert.equal(r2.state, 'rebuilt');
  const boom = await quiet(() => makeTripMapProvider('y', CFG, { root: mkRoot(), fetchImpl: async () => { throw new Error('ECONNRESET'); }, now: T0 })());
  assert.equal(boom.state, 'unavailable');
});

test('dostawca: nieudane odświeżenie zostawia poprzednią mapę (bez wyjątku)', async () => {
  const root = mkRoot(), srv = fakeServer();
  await quiet(() => makeTripMapProvider('x', CFG, { root, fetchImpl: srv.fetchImpl, now: T0 })());
  srv.state.status = 500;
  const r = await quiet(() => makeTripMapProvider('x', CFG, { root, fetchImpl: srv.fetchImpl, now: T0 + MAX_AGE_MS + 1 })());
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.trips, { t1: 'R1', t2: 'R2' });
});

test('dostawca: feed z resolve (GZM) = unsupported, bez żadnego pobierania', async () => {
  const srv = fakeServer();
  const r = await makeTripMapProvider('gzm', { feeds: [{ url: 'u', resolve: 'ckan-latest' }] }, { root: mkRoot(), fetchImpl: srv.fetchImpl, now: T0 })();
  assert.equal(r.state, 'unsupported');
  assert.deepEqual([srv.calls.get, srv.calls.head], [0, 0]);
});

// --- nieaktualna mapa: wymuszone odświeżenie i alarm ---

const bigFeed = ids => ({ entity: ids.map(id => noRoute(id, 60)) });
const ids = n => Array.from({ length: n }, (_, i) => `k${i}`);
const provider = (map, { rebuilt = null } = {}) => async opts => {
  if (opts?.force) return rebuilt ?? { state: 'limited', trips: map, builtAt: 'b' };
  return { state: 'ok', trips: map, builtAt: 'b' };
};

test('dużo kursów spoza mapy wymusza odświeżenie i liczy ponownie na nowej mapie', async () => {
  const oldMap = { k0: 'R1' }; // z 30 kursów zna jeden
  const newMap = Object.fromEntries(ids(30).map(i => [i, 'R2']));
  const r = await extractWithTripMap(bigFeed(ids(30)), NAMES, U,
    provider(oldMap, { rebuilt: { state: 'rebuilt', trips: newMap, builtAt: 'nowa' } }));
  assert.equal(r.obs.size, 30);
  assert.equal(r.tripMap.state, 'rebuilt');
  assert.equal(r.tripMap.stale, false);
});

test('odświeżenie niedozwolone (limited): obserwacje tylko dla znanych kursów, alarm stale', async () => {
  const r = await extractWithTripMap(bigFeed(ids(30)), NAMES, U, provider({ k0: 'R1', k1: 'R1' }));
  assert.equal(r.obs.size, 2); // pozostałych 28 pominięto, nie przypisano na oko
  assert.equal(r.tripMap.stale, true);
  assert.equal(r.tripMap.unmapped, 28);
});

test('mała próbka nie wywołuje alarmu ani pobierania; miasto z routeId nie woła dostawcy', async () => {
  let calls = 0;
  const spy = async () => { calls++; return { state: 'ok', trips: {}, builtAt: 'b' }; };
  const small = await extractWithTripMap(bigFeed(['a', 'b', 'c']), NAMES, U, spy);
  assert.equal(small.tripMap.stale, false);
  const direct = { entity: [{ id: 'a', tripUpdate: { trip: { tripId: 't1', routeId: 'R1' }, delay: 5 } }] };
  calls = 0;
  const r = await extractWithTripMap(direct, NAMES, U, spy);
  assert.equal(calls, 0);
  assert.equal(r.tripMap, null);
  assert.equal(r.obs.get(`${U}|t1`).route, '10');
});

// --- całość: collectCity -> werdykt ---

const okRes = { ok: true, status: 200, headers: { get: () => '' }, arrayBuffer: async () => new Uint8Array([1]).buffer };
const decoderOf = feed => ({ FeedMessage: { decode: () => ({}), toObject: () => feed } });
const RT = { rt: { type: 'gtfsrt', urls: [U] } };
const run = (feed, tripMapProvider) => collectCity(RT, { fetchImpl: async () => okRes, decoder: decoderOf(feed), names: NAMES, tripMapProvider });
const verdictOf = async (feed, tmp) => {
  const { obs, urlResults } = await run(feed, tmp);
  return { obs, urlResults, verdict: cityVerdict(true, obs.size, urlResults) };
};

test('Szczecin: feed bez linii + mapa = obserwacje i werdykt ok z liczbami w szczegółach', async () => {
  const r = await verdictOf({ entity: [noRoute('t1', 60), noRoute('t2', 30), noRoute('stary', 10)] }, provider(TRIPS));
  assert.equal(r.obs.size, 2);
  assert.equal(r.verdict.status, 'ok');
  assert.match(r.urlResults[0].detail, /linia z mapy kursów: 2, pominięte.*: 1/);
});

test('ten sam feed bez dostawcy mapy: zero obserwacji (stan sprzed naprawy)', async () => {
  const r = await verdictOf({ entity: [noRoute('t1', 60)] }, null);
  assert.equal(r.obs.size, 0);
  assert.equal(r.urlResults[0].kind, 'no-routeid');
  assert.equal(r.verdict.status, 'fail');
});

test('GZM: feed bez routeId i bez możliwości mapy = feed-limit, werdykt limit, kod wyjścia 0, widoczny w tabeli', async () => {
  const unsupported = makeTripMapProvider('gzm', { feeds: [{ url: 'u', resolve: 'ckan-latest' }] }, { root: mkRoot() });
  const r = await verdictOf({ entity: [noRoute('7000001', 60)] }, unsupported);
  assert.equal(r.urlResults[0].kind, 'feed-limit');
  assert.equal(r.verdict.status, 'limit');
  assert.equal(exitCodeFor([{ cityKey: 'gzm', ...r }]), 0);
  assert.match(renderSummary([{ cityKey: 'gzm', ...r }]), /\| gzm \| OGRANICZENIE FEEDU \|/);
});

test('GZM: gdy przewoźnik doda routeId, miasto wraca do ok (ograniczenie nie jest wyciszeniem)', async () => {
  const unsupported = makeTripMapProvider('gzm', { feeds: [{ url: 'u', resolve: 'ckan-latest' }] }, { root: mkRoot() });
  const feed = { entity: [{ id: 'a', tripUpdate: { trip: { tripId: '7000001', routeId: 'R1' }, delay: 60 } }] };
  const r = await verdictOf(feed, unsupported);
  assert.equal(r.verdict.status, 'ok');
});

test('świeża mapa, a żaden kurs z feedu w niej nie występuje (feed z innej przestrzeni id) = feed-limit', async () => {
  const fresh0 = async () => ({ state: 'rebuilt', trips: TRIPS, builtAt: 'b' });
  const r = await verdictOf({ entity: [noRoute('obcy1', 1), noRoute('obcy2', 2)] }, fresh0);
  assert.equal(r.urlResults[0].kind, 'feed-limit');
  assert.equal(r.verdict.status, 'limit');
});

test('stara mapa, żaden kurs nie pasuje, odświeżenie niedozwolone = awaria trip-map-stale (nie limit)', async () => {
  const r = await verdictOf({ entity: [noRoute('obcy1', 1)] }, provider(TRIPS));
  assert.equal(r.urlResults[0].kind, 'trip-map-stale');
  assert.equal(r.verdict.status, 'fail');
  assert.equal(exitCodeFor([{ cityKey: 'szczecin', ...r }]), 1);
});

test('mapa niedostępna (pierwsze uruchomienie, serwer nie odpowiada) = awaria miasta, ale bez wyjątku', async () => {
  const srv = fakeServer({ etag: 'v1', status: 503 });
  const tmp = makeTripMapProvider('x', CFG, { root: mkRoot(), fetchImpl: srv.fetchImpl, now: T0 });
  const r = await quiet(() => verdictOf({ entity: [noRoute('t1', 1)] }, tmp));
  assert.equal(r.urlResults[0].kind, 'trip-map-unavailable');
  assert.equal(r.verdict.status, 'fail');
});

test('runCollection: brak mapy na dysku nie wywraca przebiegu, mapa powstaje i obserwacje trafiają do agregatu', async () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, 'data', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'x', 'meta.json'), JSON.stringify({ routeNames: NAMES }));
  const srv = fakeServer();
  const cities = { x: { ...CFG, ...RT } };
  const collect = (cfg, deps) => collectCity(cfg, { ...deps, fetchImpl: async () => okRes, decoder: decoderOf({ entity: [noRoute('t1', 90)] }) });
  const { reports, totalObs } = await quiet(() => runCollection(cities, { root, collect, fetchImpl: srv.fetchImpl, now: new Date('2026-11-24T10:00:00Z') }));
  assert.equal(reports[0].verdict.status, 'ok');
  assert.equal(totalObs, 1);
  assert.ok(fs.existsSync(cacheFile(root)));
  assert.ok(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'data', 'delays', 'x.json'), 'utf8'))).includes('10|0|11'));
});

test('cityVerdict: limit tylko, gdy wszystkie powody to feed-limit', () => {
  assert.equal(cityVerdict(true, 0, [{ kind: 'feed-limit' }, { kind: 'feed-limit' }]).status, 'limit');
  assert.equal(cityVerdict(true, 0, [{ kind: 'feed-limit' }, { kind: 'http' }]).status, 'fail');
  assert.equal(cityVerdict(true, 0, []).status, 'fail');
});
