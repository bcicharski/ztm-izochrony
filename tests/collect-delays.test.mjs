import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGtfsRtObservations, classifyUrlResult, cityVerdict, exitCodeFor, renderSummary, collectCity,
} from '../tools/collect-delays.mjs';

const U = 'https://example.test/tu.pb';

test('sukces: obserwacje z tripUpdate.delay i z stopTimeUpdate', () => {
  const feed = { entity: [
    { id: 'a', tripUpdate: { trip: { tripId: 't1', routeId: 'r1' }, delay: 90 } },
    { id: 'b', tripUpdate: { trip: { tripId: 't2', routeId: 'r2' }, stopTimeUpdate: [{ arrival: { delay: 30 } }] } },
  ] };
  const { obs, stats } = extractGtfsRtObservations(feed, { r1: '10' }, U);
  assert.equal(obs.size, 2);
  assert.equal(obs.get(`${U}|t1`).route, '10'); // mapowanie routeNames
  assert.equal(obs.get(`${U}|t2`).route, 'r2'); // brak mapy = surowe id
  assert.equal(stats.withDelay, 2);
  const c = classifyUrlResult({ url: U, obsCount: obs.size, stats, http: { ok: true, status: 200 } });
  assert.equal(c.kind, 'ok');
});

test('sparsowany bez routeId: rozróżniony od braku delay', () => {
  const { obs, stats } = extractGtfsRtObservations(
    { entity: [{ id: 'a', tripUpdate: { trip: { tripId: 't' }, delay: 5 } }] }, {}, U);
  assert.equal(obs.size, 0);
  assert.equal(stats.withTripUpdate, 1);
  assert.equal(stats.withRouteId, 0);
  assert.equal(classifyUrlResult({ url: U, obsCount: 0, stats, http: { ok: true, status: 200 } }).kind, 'no-routeid');
});

test('sparsowany bez delay: diagnostyka z przykładowymi routeId', () => {
  const entity = ['r1', 'r2', 'r3', 'r4'].map((r, i) => ({ id: `e${i}`, tripUpdate: { trip: { tripId: `t${i}`, routeId: r } } }));
  const { obs, stats } = extractGtfsRtObservations({ entity }, {}, U);
  assert.equal(obs.size, 0);
  assert.deepEqual(stats.sampleRouteIds, ['r1', 'r2', 'r3']);
  const c = classifyUrlResult({ url: U, obsCount: 0, stats, http: { ok: true, status: 200 } });
  assert.equal(c.kind, 'no-delay');
  assert.match(c.detail, /encji 4, z tripUpdate 4, z routeId 4, z delay 0/);
});

test('inne puste kształty: brak encji i brak tripUpdate (np. tylko vehicle)', () => {
  const empty = extractGtfsRtObservations({}, {}, U);
  assert.equal(classifyUrlResult({ url: U, obsCount: 0, stats: empty.stats, http: { ok: true, status: 200 } }).kind, 'no-entities');
  const veh = extractGtfsRtObservations({ entity: [{ id: 'v', vehicle: {} }] }, {}, U);
  assert.equal(classifyUrlResult({ url: U, obsCount: 0, stats: veh.stats, http: { ok: true, status: 200 } }).kind, 'no-tripupdate');
});

test('błąd HTTP i wyjątek', () => {
  const h = classifyUrlResult({ url: U, http: { ok: false, status: 403 } });
  assert.deepEqual([h.kind, h.detail], ['http', 'HTTP 403']);
  const x = classifyUrlResult({ url: U, error: 'ENOTFOUND' });
  assert.deepEqual([x.kind, x.detail], ['exception', 'ENOTFOUND']);
});

test('odpowiedź niedekodowalna: kod, content-type, rozmiar i początek tekstu', () => {
  const c = classifyUrlResult({
    url: U, http: { ok: true, status: 200, contentType: 'text/html' },
    decodeError: 'invalid wire type', raw: { size: 1234, preview: '<html>\n<body>Błąd 404 ' + 'x'.repeat(200) },
  });
  assert.equal(c.kind, 'undecodable');
  assert.match(c.detail, /HTTP 200, content-type: text\/html, 1234 B/);
  assert.match(c.detail, /<html>/);
  assert.ok(c.detail.length < 300); // bez zrzucania całej odpowiedzi
});

test('kod wyjścia: miasto bez rt nie psuje, rt z zerem psuje, działające dają 0', () => {
  const rep = (cityKey, configured, n, kinds = []) => ({
    cityKey, verdict: cityVerdict(configured, n, kinds.map(kind => ({ kind }))), urlResults: kinds.map(kind => ({ url: U, kind, detail: 'd' })),
  });
  assert.equal(exitCodeFor([rep('a', true, 10), rep('b', false, 0)]), 0);
  assert.equal(exitCodeFor([rep('a', true, 10), rep('b', true, 0, ['http'])]), 1);
  assert.equal(exitCodeFor([rep('b', false, 0)]), 0);
  assert.equal(rep('b', true, 0, ['http', 'no-delay']).verdict.reason, 'http+no-delay');
});

test('tabela podsumowania pomija miasta bez rt i pokazuje przyczynę', () => {
  const md = renderSummary([
    { cityKey: 'gzm', verdict: cityVerdict(true, 0, [{ kind: 'http' }]), urlResults: [{ url: U, kind: 'http', detail: 'HTTP 403' }] },
    { cityKey: 'lodz', verdict: cityVerdict(false, 0), urlResults: [] },
    { cityKey: 'krakow', verdict: cityVerdict(true, 5, [{ kind: 'ok' }]), urlResults: [{ url: U, kind: 'ok', detail: '5' }] },
  ]);
  assert.match(md, /\| gzm \| BŁĄD \| http \| http: HTTP 403 \|/);
  assert.match(md, /\| krakow \| OK /);
  assert.doesNotMatch(md, /lodz/);
});

// --- przebieg miasta na atrapie pobierania (bez sieci) ---

const okRes = body => ({ ok: true, status: 200, headers: { get: () => 'application/x-protobuf' }, arrayBuffer: async () => new Uint8Array(body).buffer });
const feedDecoder = feed => ({ FeedMessage: { decode: () => ({}), toObject: () => feed } });
const goodFeed = { entity: [{ id: 'a', tripUpdate: { trip: { tripId: 't1', routeId: 'r1' }, delay: 60 } }] };

/** Werdykt tak, jak liczy go main(): miasto z rt -> cityVerdict, bez rt -> skip. */
async function verdictFor(cfg, deps) {
  if (!cfg.rt) return { verdict: cityVerdict(false, 0), urlResults: [] };
  const { obs, urlResults } = await collectCity(cfg, deps);
  return { verdict: cityVerdict(true, obs.size, urlResults), urlResults };
}

test('miasto bez rt nie jest awarią', async () => {
  const r = await verdictFor({}, {});
  assert.equal(r.verdict.status, 'skip');
  assert.equal(exitCodeFor([{ cityKey: 'x', ...r }]), 0);
});

test('miasto z rt i obserwacjami przechodzi', async () => {
  const cfg = { rt: { type: 'gtfsrt', urls: [U] } };
  const r = await verdictFor(cfg, { fetchImpl: async () => okRes([1]), decoder: feedDecoder(goodFeed), names: { r1: '10' } });
  assert.equal(r.verdict.status, 'ok');
  assert.equal(exitCodeFor([{ cityKey: 'x', ...r }]), 0);
});

test('miasto z rt i zerem obserwacji jest awarią (kod 1)', async () => {
  const cfg = { rt: { type: 'gtfsrt', urls: [U] } };
  const r = await verdictFor(cfg, { fetchImpl: async () => okRes([1]), decoder: feedDecoder({ entity: [] }) });
  assert.equal(r.verdict.status, 'fail');
  assert.equal(r.urlResults[0].kind, 'no-entities');
  assert.equal(exitCodeFor([{ cityKey: 'x', ...r }]), 1);
});

test('błąd HTTP i wyjątek pobierania są awarią i trafiają do podsumowania z adresem i przyczyną', async () => {
  const cfg = { rt: { type: 'gtfsrt', urls: [U] } };
  const http = await verdictFor(cfg, { fetchImpl: async () => ({ ok: false, status: 503, headers: { get: () => '' } }), decoder: feedDecoder({}) });
  assert.equal(http.verdict.status, 'fail');
  const boom = await verdictFor(cfg, { fetchImpl: async () => { throw new Error('ECONNRESET'); }, decoder: feedDecoder({}) });
  assert.equal(boom.verdict.status, 'fail');
  const md = renderSummary([
    { cityKey: 'gzm', ...http }, { cityKey: 'szczecin', ...boom },
  ]);
  assert.match(md, /\| gzm \| BŁĄD \| http \| http: HTTP 503 \|/);
  assert.match(md, /\| szczecin \| BŁĄD \| exception \| exception: ECONNRESET \|/);
});

test('błąd dekodera i nieznany typ rt też są awarią, a collectCity nie rzuca', async () => {
  const cfg = { rt: { type: 'gtfsrt', urls: [U] } };
  const bad = { FeedMessage: { decode: () => { throw new Error('invalid wire type'); } } };
  const r = await verdictFor(cfg, { fetchImpl: async () => okRes([60, 104]), decoder: bad });
  assert.equal(r.verdict.status, 'fail');
  assert.equal(r.urlResults[0].kind, 'undecodable');
  const u = await verdictFor({ rt: { type: 'nieznany' } }, {});
  assert.equal(u.verdict.status, 'fail');
  assert.match(u.urlResults[0].detail, /nieznany typ rt/);
});

test('awaria jednego miasta nie odbiera obserwacji pozostałym', async () => {
  const good = await collectCity({ rt: { type: 'gtfsrt', urls: [U] } }, { fetchImpl: async () => okRes([1]), decoder: feedDecoder(goodFeed) });
  const bad = await collectCity({ rt: { type: 'gtfsrt', urls: [U] } }, { fetchImpl: async () => { throw new Error('x'); }, decoder: feedDecoder({}) });
  assert.equal(good.obs.size, 1);
  assert.equal(bad.obs.size, 0);
});

test('Gdańsk: błąd HTTP i JSON bez REALTIME to awaria', async () => {
  const cfg = { rt: { type: 'gdansk-departures', url: 'https://example.test/d' } };
  const h = await verdictFor(cfg, { fetchImpl: async () => ({ ok: false, status: 500, headers: { get: () => '' } }) });
  assert.equal(h.verdict.status, 'fail');
  const j = await verdictFor(cfg, { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => '' }, json: async () => ({ 1: { departures: [{ status: 'SCHEDULED', routeId: 1 }] } }) }) });
  assert.equal(j.verdict.status, 'fail');
  const g = await verdictFor(cfg, { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => '' }, json: async () => ({ 1: { departures: [{ status: 'REALTIME', delayInSeconds: 30, trip: 7, routeShortName: '5' }] } }) }) });
  assert.equal(g.verdict.status, 'ok');
});
