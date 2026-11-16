import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGtfsRtObservations, classifyUrlResult, cityVerdict, exitCodeFor, renderSummary,
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
