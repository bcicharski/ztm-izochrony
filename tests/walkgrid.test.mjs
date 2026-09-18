import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTimeGrid, computeNoWalkGrid, maxTimeGrid, areaPercents, maxBandDistances, pixelIndex, UNREACH } from '../js/walkgrid.js';
import { WALK_MPS } from '../js/data.js';

/** Siatka W×H, res m/px; woda w kolumnach [x0,x1] z opcjonalnym mostem w wierszu y. */
function grid({ W = 40, H = 20, res = 25, water = null, bridgeY = -1 } = {}) {
  const land = new Uint8Array(W * H).fill(1);
  if (water) for (let y = 0; y < H; y++) for (let x = water[0]; x <= water[1]; x++) if (y !== bridgeY) land[y * W + x] = 0;
  return { W, H, res, land, time: new Uint16Array(W * H), cityMask: null, cityLandPx: 0,
    toX: lon => lon, toY: lat => lat }; // testy adresują pikselami
}
const idx = (g, x, y) => y * g.W + x;
const ORTH = Math.round(25 / WALK_MPS);

test('computeTimeGrid: woda blokuje, most przepuszcza, czas rośnie z odległością', () => {
  const g = grid({ water: [20, 21], bridgeY: 10 });
  computeTimeGrid(g, [[idx(g, 5, 10), 0]]);
  assert.equal(g.time[idx(g, 5, 10)], 0);
  assert.equal(g.time[idx(g, 15, 10)], 10 * ORTH);
  assert.equal(g.time[idx(g, 35, 10)], 30 * ORTH, 'przez most po prostej');
  assert.equal(g.time[idx(g, 20, 5)], UNREACH, 'piksel wody');
  assert.ok(g.time[idx(g, 35, 2)] > 30 * ORTH && g.time[idx(g, 35, 2)] < UNREACH, 'za wodą przez most, dłużej');
  const blocked = grid({ water: [20, 21] });
  computeTimeGrid(blocked, [[idx(blocked, 5, 10), 0]]);
  assert.equal(blocked.time[idx(blocked, 35, 10)], UNREACH, 'bez mostu drugi brzeg nieosiągalny');
});

test('computeTimeGrid: źródło na wodzie przenosi się na sąsiedni ląd; maxSpreadM ogranicza rozlanie', () => {
  const g = grid({ water: [20, 21] });
  computeTimeGrid(g, [[idx(g, 20, 3), 0]]);
  assert.equal(g.time[idx(g, 19, 3)], 0);
  const s = grid();
  computeTimeGrid(s, [[idx(s, 10, 10), 100]], 60); // ≤ 60 m od źródła = 2 piksele
  assert.equal(s.time[idx(s, 12, 10)], 100 + 2 * ORTH);
  assert.equal(s.time[idx(s, 13, 10)], UNREACH);
});

test('computeNoWalkGrid: promień po lądzie, wcześniejszy przyjazd wygrywa', () => {
  const g = grid({ water: [20, 21] });
  computeNoWalkGrid(g, [[idx(g, 8, 10), 600], [idx(g, 14, 10), 300]], 100);
  assert.equal(g.time[idx(g, 8, 10)], 600);
  assert.equal(g.time[idx(g, 12, 10)], 300, 'w zasięgu obu: wcześniejszy przystanek');
  assert.equal(g.time[idx(g, 9, 10)], 600, 'tylko w zasięgu późniejszego');
  assert.equal(g.time[idx(g, 3, 10)], UNREACH, 'poza promieniem');
  assert.equal(g.time[idx(g, 18, 10)], 300);
  assert.equal(g.time[idx(g, 22, 10)], UNREACH, 'woda nie liczy się jako ląd');
});

test('maxTimeGrid, areaPercents, maxBandDistances, pixelIndex', () => {
  const g = grid();
  const a = Uint16Array.from({ length: g.W * g.H }, () => 100);
  const b = Uint16Array.from({ length: g.W * g.H }, (_, i) => (i % 2 ? 50 : 900));
  const m = maxTimeGrid(g, a, b);
  assert.equal(m[1], 100); assert.equal(m[0], 900);

  g.cityMask = new Uint8Array(g.W * g.H).fill(1); g.cityLandPx = g.W * g.H;
  g.time.fill(UNREACH);
  for (let i = 0; i < 200; i++) g.time[i] = 300;   // 200 px w paśmie ≤10 min
  for (let i = 200; i < 400; i++) g.time[i] = 1500; // 200 px w paśmie ≤30 min
  const pct = areaPercents(g, g.time);
  assert.deepEqual(pct.map(v => +v.toFixed(2)), [25, 25, 50, 50, 50, 50]);

  g.time.fill(UNREACH);
  g.time[idx(g, 10, 10)] = 0; g.time[idx(g, 14, 10)] = 500; g.time[idx(g, 10, 4)] = 1300;
  const km = maxBandDistances(g, g.time, idx(g, 10, 10));
  // 500 s → pasmo ≤10 (100 m), 1300 s → pasmo ≤30 (150 m); kumulatywnie
  assert.deepEqual(km.map(v => +v.toFixed(3)), [0.1, 0.1, 0.15, 0.15, 0.15, 0.15]);

  assert.equal(pixelIndex(g, 3, 7), idx(g, 7, 3));
  assert.equal(pixelIndex(g, -1, 7), -1);
  assert.equal(pixelIndex(g, 3, g.W), -1);
});

test('buildContours: blok komórek daje jeden pierścień o poprawnym bboxie i kolejności pasm', async () => {
  const { buildContours } = await import('../js/walkgrid.js');
  const g = grid();
  Object.assign(g, { latN: 50.01, lonW: 20, mPerDegLon: 111320 * Math.cos(50 * Math.PI / 180) });
  g.time.fill(UNREACH);
  for (let y = 5; y < 9; y++) for (let x = 10; x < 16; x++) g.time[idx(g, x, y)] = 400; // 6×4 komórek, ≤10 min
  const bands = buildContours(g, g.time);
  assert.equal(bands.length, 6);
  assert.equal(bands[0].limit, 10);
  assert.equal(bands[0].rings.length, 1, 'jeden pierścień w paśmie ≤10');
  assert.ok(bands.every(b => b.rings.length === 1), 'każde pasmo kumulatywnie zawiera blok');
  const bb = bands[0].bbox[0];
  // blok x∈[10,16), y∈[5,9) w komórkach → lon od 20 + 10·25/mPerDegLon, lat od 50.01 − 9·25/111320
  const kx = 25 / g.mPerDegLon, ky = 25 / 111320;
  assert.ok(Math.abs(bb[1] - (20 + 10 * kx)) < kx, 'zachód'); assert.ok(Math.abs(bb[3] - (20 + 16 * kx)) < kx, 'wschód');
  assert.ok(Math.abs(bb[0] - (50.01 - 9 * ky)) < ky, 'południe'); assert.ok(Math.abs(bb[2] - (50.01 - 5 * ky)) < ky, 'północ');
  assert.ok(bands[0].rings[0].length / 2 < 40, 'obrys uproszczony (bez wierzchołka na każdej krawędzi komórki)');
  g.time.fill(UNREACH);
  assert.ok(buildContours(g, g.time).every(b => b.rings.length === 0), 'pusta siatka = brak obrysów');
});
