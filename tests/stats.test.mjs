import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../js/stats.js';
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
