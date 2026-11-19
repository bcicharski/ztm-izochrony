import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, meetingWindow, meetingCandidates, rankMeetingPlaces, compareFair, compareSum, MEET_LIMIT } from '../js/stats.js';
import { WALK_MPS, M_PER_DEG_LAT } from '../js/data.js';

// jeden przystanek 2 km na północ od punktu, dojazd 10 min
const net = { nStops: 1, lat: [50 + 2000 / M_PER_DEG_LAT], lon: [20] };
const origin = { lat: 50, lon: 20 };
const base = { walk: true, origin };
const km = rows => rows.map(r => r.maxKm);

test('computeStats: bez maxEgressSec wynik jak dotąd (spacer od przystanku = reszta pasma)', () => {
  const a = computeStats(net, Float64Array.of(10), base);
  const b = computeStats(net, Float64Array.of(10), { ...base, maxEgressSec: Infinity });
  assert.deepEqual(km(b), km(a));
  // pasmo 20 min: 2 km + 10 min × tempo marszu
  const row20 = a.find(r => r.limit === 20);
  assert.ok(Math.abs(row20.maxKm - (2000 + 600 * WALK_MPS) / 1000) < 0.01);
});

test('computeStats: maxEgressSec ogranicza zasięg od przystanku, nie zawyża statystyk', () => {
  const free = computeStats(net, Float64Array.of(10), base);
  const lim = computeStats(net, Float64Array.of(10), { ...base, maxEgressSec: 120 });
  const row = (rows, l) => rows.find(r => r.limit === l);
  assert.ok(Math.abs(row(lim, 20).maxKm - (2000 + 120 * WALK_MPS) / 1000) < 0.01);
  for (const r of free) assert.ok(lim.find(x => x.limit === r.limit).maxKm <= r.maxKm + 1e-9);
  assert.ok(row(lim, 20).maxKm < row(free, 20).maxKm);
});

test('computeStats: wiersz „sam spacer z punktu" (brak pojazdu) nietknięty przez limit', () => {
  const none = Float64Array.of(Infinity);
  const a = computeStats(net, none, base);
  const b = computeStats(net, none, { ...base, maxEgressSec: 60 });
  assert.deepEqual(km(b), km(a));
  assert.ok(Math.abs(a.find(r => r.limit === 10).maxKm - 600 * WALK_MPS / 1000) < 1e-9);
});

/* ---------- Miejsce spotkania (Z-004) ---------- */

/** Sieć z przystankami rozsuniętymi o ~1 km na południku; `groups` domyślnie = indeks. */
function meetNet(n, { groups, names, gapM = 1000 } = {}) {
  return {
    nStops: n,
    lat: Array.from({ length: n }, (_, i) => 50 + i * gapM / M_PER_DEG_LAT),
    lon: new Array(n).fill(20),
    group: Int32Array.from(groups ?? Array.from({ length: n }, (_, i) => i)),
    stopName: names ?? Array.from({ length: n }, (_, i) => `P${i}`),
  };
}
const pairs = ps => [Float64Array.from(ps.map(p => p[0])), Float64Array.from(ps.map(p => p[1]))];
const rank = (ps, opts, netOpts) => rankMeetingPlaces(meetNet(ps.length, netOpts), ...pairs(ps), opts);

test('meetingWindow: mniejsza z dwóch wartości luzu', () => {
  assert.equal(meetingWindow(4), 6);
  assert.equal(meetingWindow(10), 15);
  assert.equal(meetingWindow(15), 23);
  assert.equal(meetingWindow(62), 72);
});

test('meet: pułapka — (85,85) odpada, wygrywa (12,15)', () => {
  const r = rank([[85, 85], [12, 15]]);
  assert.equal(r.bestMaxMin, 15);
  assert.equal(r.windowMin, 23);
  assert.deepEqual(r.fair.map(c => [c.aMin, c.bMin]), [[12, 15]]);
  assert.equal(r.sum[0].aMin, 12);
  assert.equal(r.fastest.meetMin, 15);
});

test('meet: przy małym bestMax okno jest ciasne — (12,12) odpada, wygrywa (4,6)', () => {
  const r = rank([[12, 12], [4, 6]]);
  assert.equal(r.windowMin, 9);
  assert.deepEqual(r.fair.map(c => [c.aMin, c.bMin]), [[4, 6]]);
});

test('meet: sprawiedliwość działa — (10,4) i (13,12) w oknie 15, wygrywa (13,12)', () => {
  const r = rank([[10, 4], [13, 12]]);
  assert.equal(r.windowMin, 15);
  assert.deepEqual(r.fair.map(c => [c.aMin, c.bMin]), [[13, 12], [10, 4]]);
});

test('meet: drugi klucz — przy równej różnicy wygrywa krótsza jazda', () => {
  const r = rank([[18, 18], [14, 14]]);
  assert.deepEqual(r.fair.map(c => c.meetMin), [14, 18]);
});

test('compareSum: (20,21) pokonuje (3,40); kryterium sumy nie ma okna', () => {
  const r = rank([[3, 40], [20, 21]]);
  assert.deepEqual(r.sum.map(c => c.sumMin), [41, 43]);
  assert.deepEqual(r.fair.map(c => c.sumMin), [41]); // (3,40) poza oknem 21+10
  assert.ok(compareSum(r.sum[0], r.sum[1]) < 0);
  assert.ok(compareFair({ diffMin: 1, meetMin: 5, group: 0 }, { diffMin: 2, meetMin: 3, group: 1 }) < 0);
});

test('meet: słupki jednego zespołu dają jeden wpis, z reprezentantem o najmniejszym max', () => {
  const net = meetNet(5, { groups: [7, 7, 7, 7, 7], names: Array(5).fill('Dworzec Główny'), gapM: 50 });
  const [a, b] = pairs([[20, 20], [15, 18], [16, 16], [30, 30], [17, 17]]);
  const { list, bothCount } = meetingCandidates(net, a, b);
  assert.equal(list.length, 1);
  assert.equal(bothCount, 1);
  assert.equal(list[0].stop, 2); // max 16
  assert.equal(list[0].meetMin, 16);
});

test('meet: ta sama nazwa w dwóch zespołach 11 km od siebie to dwa wpisy', () => {
  const r = rank([[10, 12], [11, 11]], {}, { names: ['Dworzec', 'Dworzec'], gapM: 11000 });
  assert.equal(r.fair.length, 2);
  assert.equal(r.bothCount, 2);
});

test('meet: Infinity, NaN i ponad 90 min nie wchodzą; pusty zbiór daje null', () => {
  const r = rank([[Infinity, 5], [5, NaN], [91, 5], [5, 5]]);
  assert.equal(r.bothCount, 1);
  const e = rank([[Infinity, 5], [91, 91]]);
  assert.equal(e.bothCount, 0);
  assert.equal(e.bestMaxMin, null);
  assert.equal(e.windowMin, null);
  assert.deepEqual(e.fair, []);
  assert.deepEqual(e.sum, []);
  assert.equal(rank([[90, 90]]).bothCount, 1); // granica włącznie
});

test('meet: pozycje listy odsunięte o co najmniej 300 m', () => {
  const r = rank([[10, 10], [10, 10], [10, 10]], {}, { gapM: 160 });
  assert.equal(r.bothCount, 3);
  assert.equal(r.fair.length, 2); // 0 m i 320 m; środkowy (160 m) odpada
  assert.deepEqual(r.fair.map(c => c.group), [0, 2]);
});

test('meet: pełny remis rozstrzyga numer zespołu, limit respektowany', () => {
  const ps = Array.from({ length: 9 }, () => [10, 10]);
  const r = rank(ps);
  assert.deepEqual(r.fair.map(c => c.group), [0, 1, 2, 3, 4]);
  assert.equal(r.sum.length, MEET_LIMIT);
  const r2 = rank(ps, { limit: 2 });
  assert.equal(r2.fair.length, 2);
  assert.equal(r2.sum.length, 2);
});
