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

test('buildZones (Z-076): bez opcji egressMps wynik jak dla WALK_MPS; z opcją promienie skalują się tempem, cap zostaje górną granicą', () => {
  const minutes = Float64Array.from([5, 25, 95]);
  const origin = { lat: 50, lon: 20 };
  const radii = zs => zs.map(z => ({ limit: z.limit, r: z.circles.map(c => c[2]) }));
  const def = buildZones(net, minutes, { walk: true, origin });
  assert.deepEqual(radii(buildZones(net, minutes, { walk: true, origin, egressMps: WALK_MPS })), radii(def), 'jawne tempo piesze = domyślne');
  const v = 3;
  const fast = buildZones(net, minutes, { walk: true, origin, egressMps: v });
  const z90 = fast.find(z => z.limit === 90);
  assert.equal(z90.circles[0][2], 90 * 60 * v, 'origin: domyślnie to samo tempo co wyjście');
  assert.equal(z90.circles[1][2], (90 - 5) * 60 * v);
  const split = buildZones(net, minutes, { walk: true, origin, egressMps: v, originMps: 2 });
  assert.equal(split.find(z => z.limit === 90).circles[0][2], 90 * 60 * 2, 'originMps niezależne od egressMps');
  const capped = buildZones(net, minutes, { walk: true, origin, egressMps: v, maxRadiusM: 1000 });
  assert.ok(capped.every(z => z.circles.every(c => c[2] <= 1000)), 'cap nadal obowiązuje');
});
