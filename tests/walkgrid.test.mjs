import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTimeGrid, computeNoWalkGrid, maxTimeGrid, areaPercents, maxBandDistances, pixelIndex, gapToGrid, borderSeeds, outsideSeeds, UNREACH } from '../js/walkgrid.js';
import { rng } from './helpers.mjs';
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

test('buildContours: poly[] numeruje wielokąty, pierwszy pierścień wielokąta jest zewnętrzny (Z-008)', async () => {
  const { buildContours } = await import('../js/walkgrid.js');
  const g = grid({ W: 50, H: 30 });
  Object.assign(g, { latN: 50.01, lonW: 20, mPerDegLon: 111320 * Math.cos(50 * Math.PI / 180) });
  g.time.fill(UNREACH);
  // pierścień z dziurą (x 5..24, y 5..24, dziura 12..17) + osobna wyspa (x 35..42)
  for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) g.time[idx(g, x, y)] = 400;
  for (let y = 12; y < 18; y++) for (let x = 12; x < 18; x++) g.time[idx(g, x, y)] = UNREACH;
  for (let y = 8; y < 14; y++) for (let x = 35; x < 43; x++) g.time[idx(g, x, y)] = 400;
  const bands = buildContours(g, g.time);
  for (const b of bands) {
    assert.ok(b.poly instanceof Int32Array);
    assert.equal(b.poly.length, b.rings.length, 'poly[] równoległe do rings[]');
  }
  const b = bands[0];
  assert.equal(b.rings.length, 3, 'zewnętrzny + dziura + wyspa');
  assert.deepEqual([...new Set(b.poly)].sort(), [0, 1], 'dwa wielokąty, numery spójne od 0');
  // pierwszy pierścień każdego wielokąta zawiera bbox pozostałych (jest zewnętrzny)
  for (const id of [0, 1]) {
    const idxs = [...b.poly].flatMap((p, i) => (p === id ? [i] : []));
    const outer = b.bbox[idxs[0]];
    for (const i of idxs.slice(1)) {
      const h = b.bbox[i];
      assert.ok(h[0] >= outer[0] && h[1] >= outer[1] && h[2] <= outer[2] && h[3] <= outer[3], 'dziura wewnątrz zewnętrznego');
    }
  }
  assert.ok([0, 1].some(id => [...b.poly].filter(p => p === id).length === 2), 'jeden wielokąt ma dziurę');
});

test('computeTimeGrid(null): wynik nie zależy od starego grid.spread (Z-070)', () => {
  const seed = g => { for (let x = 0; x < 3; x++) g.time[idx(g, x, 10)] = 0; }; // „ulica” zasiana jak paintNetwork
  const clean = grid();
  clean.time.fill(UNREACH);
  seed(clean);
  const a = [...computeTimeGrid(clean, null, 300)];
  // ta sama siatka, drugi przebieg po przebiegu, który zasiał duże rozlanie
  const g = grid();
  seed(g);
  computeTimeGrid(g, [[idx(g, 20, 10), 0]], 7000); // zapisuje spread do kilku km
  assert.ok(g.spread.some(v => v > 300), 'pierwszy przebieg zostawił duże wartości rozlania');
  g.time.fill(UNREACH);
  seed(g);
  const b = [...computeTimeGrid(g, null, 300)];
  assert.deepEqual(b, a);
  assert.ok(b[idx(g, 10, 10)] < UNREACH, 'fala sięga ok. 300 m od ulicy');
  assert.equal(b[idx(g, 30, 10)], UNREACH, 'ale nie dalej niż limit');
});

// --- Z-007: nasiona na brzegu siatki (przystanki tuż za krawędzią) --------------

test('gapToGrid: 0 w siatce (zgodnie z pixelIndex), odległość do prostokąta poza nią', () => {
  const g = grid(); // 40×20, res 25, toX/toY = tożsamość: „lon" = x, „lat" = y
  assert.equal(gapToGrid(g, 10, 20), 0);
  assert.equal(gapToGrid(g, 0, 0), 0);
  assert.equal(gapToGrid(g, 10, -5.5), 5 * 25, 'na zachód od siatki: 5 px');
  assert.equal(gapToGrid(g, 10, 39.5 + 4), 4 * 25, 'na wschód');
  assert.equal(gapToGrid(g, -3.5, 10), 3 * 25, 'na północ');
  assert.equal(gapToGrid(g, 19.5 + 6, 10), 6 * 25, 'na południe');
  assert.equal(gapToGrid(g, -3.5, -4.5), Math.hypot(3, 4) * 25, 'narożnik: odległość euklidesowa');
  for (const [y, x] of [[10, -0.6], [10, 39.6], [-0.6, 5], [19.6, 5], [3, 3], [19, 39]]) {
    assert.equal(gapToGrid(g, y, x) > 0, pixelIndex(g, y, x) < 0, `spójne z pixelIndex dla (${x}, ${y})`);
  }
});

test('borderSeeds: tylko piksele brzegu widoczne z przystanku, czas = przyjazd + odległość/tempo, startM = odległość', () => {
  const g = grid();
  const seeds = borderSeeds(g, 10, -4, 600, { mps: 1, reachM: 110 }); // y=10, x=-4 → 4 px = 100 m od brzegu
  assert.ok(seeds.length > 0);
  assert.ok(seeds.every(([i]) => i % g.W === 0), 'wyłącznie zachodnia kolumna (x = 0)');
  const at = Object.fromEntries(seeds.map(([i, sec, m]) => [Math.floor(i / g.W), [sec, m]]));
  assert.deepEqual(at[10], [600 + 100, 100], 'na wprost: 100 m');
  assert.equal(at[7], undefined, 'piksel 125 m poza zasięgiem');
  assert.deepEqual(borderSeeds(g, 10, -4, 600, { mps: 1, reachM: 99 }), [], 'zasięg krótszy niż odstęp od siatki: nic');
  const wide = borderSeeds(g, 10, -4, 600, { mps: 1, reachM: 200 });
  const w = Object.fromEntries(wide.map(([i, sec, m]) => [Math.floor(i / g.W), [sec, m]]));
  const d3 = Math.round(Math.hypot(4, 3) * 25);
  assert.deepEqual(w[7], [600 + d3, d3]);
  // tryb bez spaceru: czas to sam przyjazd, metry dalej liczą się do promienia
  const nw = borderSeeds(g, 10, -4, 600, { reachM: 200, addWalk: false });
  assert.ok(nw.length > 0 && nw.every(([, sec]) => sec === 600));
  assert.deepEqual(borderSeeds(g, 10, 5, 600, { mps: 1, reachM: 500 }), [], 'przystanek w siatce: bez nasion');
  assert.deepEqual(borderSeeds(g, 10, -4, 5399, { mps: 1, reachM: 500 }).filter(([, sec]) => sec > 5400), [], 'czas > 90 min odpada');
});

test('borderSeeds: woda na brzegu nie dostaje nasion; narożnik ma nasiona na dwóch bokach, ale bez duplikatów', () => {
  const g = grid({ water: [0, 0] }); // cała zachodnia kolumna to woda
  assert.deepEqual(borderSeeds(g, 10, -3, 0, { mps: 1, reachM: 500 }), [], 'brzeg z wody: brak nasion');
  const c = grid();
  const seeds = borderSeeds(c, -3, -3, 0, { mps: 1, reachM: 200 }); // narożnik NW, 3 px po przekątnej
  const ids = seeds.map(([i]) => i);
  assert.equal(new Set(ids).size, ids.length, 'bez duplikatów');
  assert.equal(ids.filter(i => i === idx(c, 0, 0)).length, 1, 'piksel narożny dokładnie raz');
  assert.ok(ids.some(i => i % c.W === 0 && i > 0), 'jest bok zachodni (x = 0, y > 0)');
  assert.ok(ids.some(i => i < c.W && i > 0), 'jest bok północny (y = 0, x > 0)');
  // przystanek na wprost zachodniego boku nie sieje północnego (odcinek przecinałby siatkę)
  assert.ok(borderSeeds(c, 3, -3, 0, { mps: 1, reachM: 500 }).every(([i]) => i % c.W === 0));
});

test('outsideSeeds: zbiera nasiona przystanków poza siatką osiągalnych w 90 min, pomija dalekie, wewnętrzne i nieosiągalne', () => {
  const g = grid();
  const net = { nStops: 5, lat: [10, 10, 10, 10, 10], lon: [-3, 20, -3, -40, -3] };
  const mins = [5, 5, 120, 5, NaN];
  const seeds = outsideSeeds(g, net, mins, { mps: 1, reachM: 100 });
  assert.ok(seeds.length > 0);
  assert.ok(seeds.every(([, sec]) => sec >= 300 && sec <= 400), 'tylko przystanek 0');
  assert.deepEqual(outsideSeeds(g, net, null, { reachM: 100 }), []);
});

test('computeTimeGrid: krotka dwuelementowa i trzyelementowa z 0 dają ten sam wynik, startM zjada limit rozlania', () => {
  const a = grid(), b = grid();
  const base = [[idx(a, 10, 10), 100], [idx(a, 30, 5), 200]];
  computeTimeGrid(a, base, 300);
  computeTimeGrid(b, base.map(s => [...s, 0]), 300);
  assert.deepEqual([...b.time], [...a.time]);
  const s = grid();
  computeTimeGrid(s, [[idx(s, 10, 10), 100, 50]], 60); // 50 m już przebyte, zostaje 10 m < 1 piksel
  assert.equal(s.time[idx(s, 10, 10)], 100);
  assert.equal(s.time[idx(s, 11, 10)], UNREACH);
  const u = grid();
  computeTimeGrid(u, [[idx(u, 10, 10), 100, 50]]); // bez limitu startM nic nie zmienia
  assert.equal(u.time[idx(u, 13, 10)], 100 + 3 * ORTH);
});

test('computeTimeGrid: bez nowych opcji wynik bajt w bajt jak przed Z-007 (reset domyślnie, tempo WALK_MPS)', () => {
  const a = grid({ water: [20, 21], bridgeY: 10 }), b = grid({ water: [20, 21], bridgeY: 10 });
  const seeds = [[idx(a, 5, 10), 0], [idx(a, 12, 3), 90]];
  computeTimeGrid(a, seeds, 400);
  computeTimeGrid(b, seeds, 400, { reset: true, mps: WALK_MPS });
  assert.deepEqual([...b.time], [...a.time]);
});

test('computeTimeGrid: opts.mps skaluje tempo fali', () => {
  const g = grid();
  computeTimeGrid(g, [[idx(g, 2, 10), 0]], Infinity, { mps: 2 * WALK_MPS });
  assert.equal(g.time[idx(g, 12, 10)], 10 * Math.round(25 / (2 * WALK_MPS)));
});

test('monotoniczność (Z-007): nasiona brzegowe domieszane reset:false nigdy nie wydłużają czasu żadnego piksela', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = rng(seed);
    const g = grid({ W: 60, H: 40 });
    for (let k = 0; k < 6; k++) { // losowa woda (prostokąty)
      const x0 = Math.floor(r() * 50), y0 = Math.floor(r() * 30), w = 1 + Math.floor(r() * 8), h = 1 + Math.floor(r() * 8);
      for (let y = y0; y < Math.min(40, y0 + h); y++) for (let x = x0; x < Math.min(60, x0 + w); x++) g.land[y * 60 + x] = 0;
    }
    const inner = Array.from({ length: 5 }, () => [Math.floor(r() * 2400), Math.floor(r() * 4000)]);
    const limit = r() < 0.5 ? Infinity : 75 + Math.floor(r() * 400);
    computeTimeGrid(g, inner, limit);
    const before = Uint16Array.from(g.time);
    const net = { nStops: 4, lat: [], lon: [] };
    for (let k = 0; k < 4; k++) { // przystanki tuż za losowym bokiem
      const side = Math.floor(r() * 4);
      const along = r() * 40;
      const off = -(0.6 + r() * 8);
      if (side === 0) { net.lat.push(along); net.lon.push(off); }
      else if (side === 1) { net.lat.push(along); net.lon.push(59 - off); }
      else if (side === 2) { net.lat.push(off); net.lon.push(along + 10); }
      else { net.lat.push(39 - off); net.lon.push(along + 10); }
    }
    const ring = outsideSeeds(g, net, [10, 20, 30, 5], { mps: WALK_MPS, reachM: 1000 });
    assert.ok(ring.length > 0, `seed ${seed}: są nasiona`);
    computeTimeGrid(g, ring, 1000, { reset: false });
    for (let i = 0; i < before.length; i++) {
      assert.ok(g.time[i] <= before[i], `seed ${seed}, piksel ${i}: ${g.time[i]} > ${before[i]}`);
    }
  }
});

test('bariera wody (Z-007): bez mostu druga strona pasa wody nieosiągalna, z mostem osiągalna i później', () => {
  const run = bridgeY => {
    const g = grid({ W: 60, H: 20, water: [30, 31], bridgeY });
    computeTimeGrid(g, [], Infinity); // pierwszy przebieg: pusto (brak źródeł wewnątrz)
    const ring = borderSeeds(g, 10, -4, 0, { mps: WALK_MPS, reachM: 1500 }); // przystanek 100 m za zachodnim brzegiem
    assert.ok(ring.length > 0);
    computeTimeGrid(g, ring, 1500, { reset: false });
    return g;
  };
  const blocked = run(-1);
  const bridged = run(10);
  const open = grid({ W: 60, H: 20 });
  computeTimeGrid(open, borderSeeds(open, 10, -4, 0, { mps: WALK_MPS, reachM: 1500 }), 1500);
  assert.ok(blocked.time[idx(blocked, 20, 10)] < UNREACH, 'strona A osiągalna');
  for (let y = 0; y < 20; y++) assert.equal(blocked.time[idx(blocked, 40, y)], UNREACH, `strona B bez mostu (y=${y})`);
  assert.ok(bridged.time[idx(bridged, 40, 10)] < UNREACH, 'strona B przez most');
  assert.ok(bridged.time[idx(bridged, 40, 3)] < UNREACH, 'także dalej od mostu');
  assert.ok(bridged.time[idx(bridged, 40, 3)] > open.time[idx(open, 40, 3)], 'objazd przez most trwa dłużej niż bez wody');
});

test('computeNoWalkGrid (Z-007): zgodność w tył, startM zjada promień, reset:false tylko skraca', () => {
  const a = grid({ water: [20, 21] }), b = grid({ water: [20, 21] });
  const seeds = [[idx(a, 8, 10), 600], [idx(a, 14, 10), 300]];
  computeNoWalkGrid(a, seeds, 100);
  computeNoWalkGrid(b, seeds, 100, { reset: true });
  assert.deepEqual([...b.time], [...a.time]);
  const c = grid();
  computeNoWalkGrid(c, [[idx(c, 10, 10), 500, 75]], 100); // zostaje 25 m = 1 piksel
  assert.equal(c.time[idx(c, 11, 10)], 500);
  assert.equal(c.time[idx(c, 12, 10)], UNREACH);
  // dwuprzebiegowo: wcześniejszy przyjazd z nasion przejmuje piksele, pozostałe bez zmian
  const d = grid();
  computeNoWalkGrid(d, [[idx(d, 5, 10), 900]], 100);
  const before = Uint16Array.from(d.time);
  computeNoWalkGrid(d, [[idx(d, 0, 10), 300, 25]], 100, { reset: false });
  for (let i = 0; i < before.length; i++) assert.ok(d.time[i] <= before[i], `piksel ${i}`);
  assert.equal(d.time[idx(d, 1, 10)], 300);
  assert.equal(d.time[idx(d, 3, 10)], 300, 'wcześniejszy przyjazd wygrywa');
  assert.equal(d.time[idx(d, 9, 10)], 900, 'poza zasięgiem nasienia: wynik pierwszego przebiegu');
});
