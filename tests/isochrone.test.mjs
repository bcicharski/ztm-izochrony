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

test('buildZones (Z-007): capPerStop obcina promień tylko wskazanych przystanków, także poniżej MIN_RADIUS_M; bez opcji wynik bez zmian', () => {
  const minutes = Float64Array.from([5, 25, 40]);
  const radii = zs => zs.map(z => ({ limit: z.limit, c: z.circles.map(c => c.join(',')) }));
  const base = buildZones(net, minutes, { walk: true, origin: null, egressMps: 1.2 });
  assert.deepEqual(radii(buildZones(net, minutes, { walk: true, origin: null, egressMps: 1.2, capPerStop: undefined })), radii(base));
  assert.deepEqual(radii(buildZones(net, minutes, { walk: true, origin: null, egressMps: 1.2, capPerStop: [Infinity, Infinity, Infinity] })), radii(base), 'cap nieskończony = bez capa');
  const capped = buildZones(net, minutes, { walk: true, origin: null, egressMps: 1.2, capPerStop: [Infinity, 30, Infinity] });
  const of = (zs, lat) => zs.flatMap(z => z.circles.filter(c => c[0] === lat).map(c => c[2]));
  assert.ok(of(capped, 50.01).length > 0 && of(capped, 50.01).every(r => r === 30), 'przystanek 1: 30 m (poniżej MIN_RADIUS_M = 60)');
  assert.deepEqual(of(capped, 50), of(base, 50), 'pozostałe przystanki bez zmian');
  assert.deepEqual(of(capped, 50.02), of(base, 50.02));
  // cap większy od promienia nie powiększa koła
  const loose = buildZones(net, minutes, { walk: true, origin: null, egressMps: 1.2, capPerStop: [1e6, 1e6, 1e6] });
  assert.deepEqual(radii(loose), radii(base));
  // cap 0 = brak koła
  const none = buildZones(net, minutes, { walk: true, origin: null, capPerStop: [Infinity, 0, Infinity] });
  assert.equal(of(none, 50.01).length, 0);
});

test('buildZones (Z-007): bez spaceru capPerStop też obcina koło 200 m; dalekie przystanki zostają przy NO_WALK_RADIUS_M', () => {
  const minutes = Float64Array.from([5, 5, 5]);
  const z = buildZones(net, minutes, { walk: false, capPerStop: [90, Infinity, NO_WALK_RADIUS_M + 500] });
  const r = lat => z.flatMap(b => b.circles.filter(c => c[0] === lat).map(c => c[2]));
  assert.deepEqual(r(50), [90]);
  assert.deepEqual(r(50.01), [NO_WALK_RADIUS_M]);
  assert.deepEqual(r(50.02), [NO_WALK_RADIUS_M], 'cap większy od 200 m nie zmienia koła');
  assert.deepEqual(buildZones(net, minutes, { walk: false, capPerStop: [0, 0, 0] }).flatMap(b => b.circles), [], 'cap 0 = brak koła');
});
