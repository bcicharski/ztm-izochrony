import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeReachability, scaleTransfers } from '../js/router.js';
import { WALK_PACES_KMH, DEFAULT_PACE_KMH, normalizePace, MIN_TRANSFER_S } from '../js/data.js';
import { parseUrlState, buildQuery, limitHints, accessSectionSummary, paceHint } from '../js/uilogic.js';
import { makeNet, everyN } from './helpers.mjs';

// --- lista tempa i adres (Z-013) ----------------------------------------------------

test('normalizePace: biała lista; wszystko spoza niej = domyślne 4,5', () => {
  assert.deepEqual(WALK_PACES_KMH, [2.5, 3.5, 4.5, 5.5]);
  for (const v of WALK_PACES_KMH) assert.equal(normalizePace(v), v);
  for (const v of ['2.5', '5.5']) assert.equal(normalizePace(v), Number(v));
  for (const v of [undefined, null, '', 0, 4, 4.4, 6, 100, -2.5, 'abc', NaN, '2,5']) assert.equal(normalizePace(v), DEFAULT_PACE_KMH, String(v));
});

const CITIES = { trojmiasto: {} };
const baseState = () => ({
  city: 'trojmiasto', point: { lat: 54.352, lng: 18.6466 }, point2: { lat: 54.4, lng: 18.5 },
  compare: false, direction: 'from', walk: true, access: 'foot',
  mode: 'time', timeMin: 8 * 60 + 5, day: 'workday', stats: false, safe: false, veh: { tram: true, bus: true },
});

test('adres: parametr pace tylko dla tempa różnego od 4,5; stan domyślny bez zmian', () => {
  const noPace = buildQuery(baseState());
  assert.equal(new URLSearchParams(noPace).has('pace'), false);
  assert.equal(buildQuery({ ...baseState(), pace: 4.5 }), noPace, 'pace=4,5 daje ten sam adres co brak pola');
  assert.equal(new URLSearchParams(buildQuery({ ...baseState(), pace: 2.5 })).get('pace'), '2.5');
  assert.equal(new URLSearchParams(buildQuery({ ...baseState(), pace: 5.5 })).get('pace'), '5.5');
  assert.equal(new URLSearchParams(buildQuery({ ...baseState(), pace: 7 })).has('pace'), false, 'wartość spoza listy nie trafia do adresu');
});

test('adres: parseUrlState czyta pace białą listą i wraca do tego, co zapisał buildQuery', () => {
  const p = s => parseUrlState(s, CITIES);
  assert.equal(p('?pace=3.5').pace, 3.5);
  assert.equal(p('?pace=2.5&city=trojmiasto').pace, 2.5);
  for (const bad of ['?pace=4.5', '?pace=', '?pace=9', '?pace=abc', '?pace=4.4', '?pace=2,5', '?']) {
    assert.equal('pace' in p(bad), false, bad);
  }
  for (const pace of [2.5, 3.5, 5.5]) {
    assert.equal(p(buildQuery({ ...baseState(), pace })).pace, pace);
  }
});

// --- teksty ---------------------------------------------------------------------------

test('podpowiedź limitu odcinka: dystans zależy od tempa (2,5 km/h ≈ 420 m na 10 min)', () => {
  const hint = pace => limitHints({ maxWalkMin: 10, walk: true, walkOnly: false, mode: 'time', access: 'foot', pace }).walk;
  assert.match(hint(undefined), /ok\. 750 m/, 'domyślnie jak dotąd');
  assert.match(hint(4.5), /ok\. 750 m/);
  assert.match(hint(2.5), /ok\. 400 m/);
  assert.match(hint(5.5), /ok\. 900 m/);
});

test('nagłówek sekcji: tempo inne niż domyślne zapala znacznik zmiany i pokazuje liczbę', () => {
  const groups = [{ key: 'bus', label: '🚌 Autobus', types: [3] }];
  const sum = extra => accessSectionSummary({ walk: true, access: 'foot', groups, veh: { bus: true }, ...extra });
  assert.deepEqual(sum({}), sum({ pace: 4.5 }), 'domyślne tempo nie zmienia nagłówka');
  assert.equal(sum({}).changed, false);
  const s = sum({ pace: 2.5 });
  assert.equal(s.changed, true);
  assert.match(s.text, /2,5 km\/h/);
  // także bez spaceru (tempo skaluje wtedy przejścia w węźle)
  assert.equal(accessSectionSummary({ walk: false, access: 'foot', groups, veh: { bus: true }, pace: 3.5 }).changed, true);
  // tryb „tylko pieszo" (wszystkie środki wyłączone) też niesie tempo
  const two = [...groups, { key: 'tram', label: '🚋 Tramwaj', types: [0] }];
  assert.equal(accessSectionSummary({ walk: true, access: 'foot', groups: two, veh: { bus: false, tram: false } }).text, 'tylko pieszo');
  assert.equal(accessSectionSummary({ walk: true, access: 'foot', groups: two, veh: { bus: false, tram: false }, pace: 2.5 }).text, 'tylko pieszo · 2,5 km/h');
});

// --- przejścia piesze w routerze -------------------------------------------------------

const H8 = 8 * 3600;
const opts = (extra = {}) => ({ lat: 50, lon: 20, direction: 'from', walk: true, mode: 'time', timeMin: 480, types: null, cautious: false, delays: null, dayType: 0, ...extra });
/** S0→S1→S2 (10 min), przejście piesze S2→S3 `walkSec`, linia S3→S4 (5 min) co minutę. */
const transferNet = walkSec => makeNet({
  stops: [0, 1, 2, 3, 4].map(i => ({ name: `S${i}`, lat: 50 + i * 0.0045, lon: 20 })),
  routes: [{ n: '1', t: 3 }, { n: '2', t: 3 }],
  patterns: [
    { r: 0, s: [0, 1, 2], p: [[300, 300]], t: [[H8, 0]] },
    { r: 1, s: [3, 4], p: [[300]], t: everyN(H8, H8 + 7200, 60) },
  ],
  transfers: [[2, 3, walkSec]],
});

test('scaleTransfers: mnożnik 1 zwraca TĘ SAMĄ referencję, inny — nową listę bez ruszania źródła', () => {
  const net = transferNet(300);
  assert.equal(scaleTransfers(net.transferAdj, 1), net.transferAdj);
  assert.equal(scaleTransfers(net.sameGroupAdj, 1), net.sameGroupAdj);
  const before = JSON.stringify(net.transferAdj);
  const slow = scaleTransfers(net.transferAdj, 2);
  assert.notEqual(slow, net.transferAdj);
  assert.equal(JSON.stringify(net.transferAdj), before, 'cache miasta nietknięty');
  assert.deepEqual(slow[2], [3, 600]);
  assert.deepEqual(slow[3], [2, 600]);
  assert.equal(scaleTransfers(net.transferAdj, 2), slow, 'kolejne przeliczenie bierze gotową tablicę');
  assert.deepEqual(scaleTransfers(net.transferAdj, 0.5)[2], [3, 150]);
});

test('scaleTransfers: podłoga minimalnego czasu przesiadki po skalowaniu', () => {
  const net = transferNet(100);
  assert.deepEqual(scaleTransfers(net.transferAdj, 0.4)[2], [3, MIN_TRANSFER_S], '100 s × 0,4 = 40 s → podłoga 60 s');
  assert.deepEqual(scaleTransfers(net.transferAdj, 0.9)[2], [3, 90]);
});

test('router: transferScale skaluje przejście piesze; 1 i brak opcji dają identyczny wynik', () => {
  const net = transferNet(300);
  const at = extra => computeReachability(net, opts(extra)).minutes[3];
  assert.equal(at({}), (600 + 300) / 60);
  assert.equal(at({ transferScale: 1 }), at({}));
  assert.equal(at({ transferScale: 2 }), (600 + 600) / 60);
  assert.equal(at({ transferScale: 0.5 }), (600 + 150) / 60);
  assert.equal(at({ transferScale: 'x' }), at({}), 'nieprawidłowy mnożnik = 1');
  // tryb ogólny (Dijkstra) też skaluje
  const gen = extra => { const m = computeReachability(net, opts({ mode: 'general', ...extra })).minutes; return m[3] - m[2]; };
  assert.equal(gen({}), 300 / 60);
  assert.equal(gen({ transferScale: 2 }), 600 / 60);
});

test('router: limit odcinka pieszo porównuje czas po przeskalowaniu', () => {
  const net = transferNet(300);
  const reach = extra => Number.isFinite(computeReachability(net, opts({ maxWalkSec: 400, ...extra })).minutes[3]);
  assert.equal(reach({}), true, '300 s ≤ 400 s');
  assert.equal(reach({ transferScale: 2 }), false, '600 s > 400 s');
  assert.equal(reach({ transferScale: 0.5 }), true);
});

test('router: tryb ostrożny nakłada swoją podłogę po skalowaniu', () => {
  const net = transferNet(300);
  const at = s => computeReachability(net, opts({ cautious: true, transferScale: s })).minutes[3];
  // 300 s × 0,5 = 150 s < 240 s → liczone 240 s; 300 × 2 = 600 s
  assert.ok(at(2) > at(0.5));
  assert.equal(at(0.5), at(0.7), 'oba poniżej podłogi ostrożnego trybu (240 s)');
});

test('interfejs: lista tempa w index.html zgadza się z białą listą i ma domyślne 4,5', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sel = html.match(/<select id="paceSelect"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(sel, 'jest lista tempa');
  const values = [...sel[1].matchAll(/<option value="([\d.]+)"( selected)?/g)];
  assert.deepEqual(values.map(m => Number(m[1])), WALK_PACES_KMH);
  assert.equal(values.find(m => m[2])[1], '4.5');
  assert.match(html, /<select id="paceSelect"[^>]*aria-label="Tempo marszu"/);
  assert.match(html, /<p class="hint" id="paceHint"><\/p>/, 'przy tempie domyślnym podpowiedź jest pusta (nie zajmuje miejsca)');
  assert.equal(paceHint(4.5), '');
  assert.equal(paceHint(undefined), '');
  for (const v of [2.5, 3.5, 5.5]) assert.match(paceHint(v), /2,5 km\/h/, 'podpowiedź tłumaczy dolną granicę');
  assert.doesNotMatch(sel[0], /disabled/);
});
