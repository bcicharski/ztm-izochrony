import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZones, BANDS, NO_WALK_RADIUS_M } from '../js/isochrone.js';
import { WALK_MPS } from '../js/data.js';

const net = { nStops: 3, lat: Float64Array.from([50, 50.01, 50.02]), lon: Float64Array.from([20, 20, 20]) };

test('buildZones: pasma rosnące, koła spacerowe malejące z czasem, cap promienia', () => {
  const minutes = Float64Array.from([5, 25, 95]);
  const zones = buildZones(net, minutes, { walk: true, origin: { lat: 50, lon: 20 } });
  assert.equal(zones.length, BANDS.length);
  assert.equal(zones[0].limit, 90, 'najchłodniejsza pierwsza');
  const band10 = zones.find(z => z.limit === 10);
  assert.equal(band10.circles.length, 2, 'origin + przystanek 5 min');
  assert.ok(Math.abs(band10.circles[1][2] - 5 * 60 * WALK_MPS) < 1e-9);
  assert.ok(!zones.some(z => z.circles.some(c => c[0] === 50.02)), 'przystanek > 90 min pominięty');
  const capped = buildZones(net, minutes, { walk: true, origin: null, maxRadiusM: 1000 });
  assert.ok(capped.every(z => z.circles.every(c => c[2] <= 1000)));
});

test('buildZones bez spaceru: stałe koła w paśmie przyjazdu', () => {
  const zones = buildZones(net, Float64Array.from([5, 25, 95]), { walk: false });
  assert.equal(zones.find(z => z.limit === 10).circles.length, 1);
  assert.equal(zones.find(z => z.limit === 30).circles[0][2], NO_WALK_RADIUS_M);
  assert.equal(zones.find(z => z.limit === 20).circles.length, 0);
});
