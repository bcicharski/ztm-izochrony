import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waterQueryBbox, clipLineToBbox, clipRingToBbox, clipWaterToBbox, WATER_MARGIN_KM, signedArea,
} from '../tools/geo.mjs';

// prostokąt w jednostkach *1e5: lat 100..200, lon 100..200
const B = { s: 100, w: 100, n: 200, e: 200 };
const inside = ([la, lo]) => la >= B.s && la <= B.n && lo >= B.w && lo <= B.e;

test('waterQueryBbox: jednakowy zapas w km w każdą stronę', () => {
  const b = waterQueryBbox([54, 18, 54.5, 19], 2);
  assert.ok(Math.abs((54 - b.s) * 111.32 - 2) < 0.01);
  assert.ok(Math.abs((b.n - 54.5) * 111.32 - 2) < 0.01);
  const kl = 111.32 * Math.cos(54.25 * Math.PI / 180);
  assert.ok(Math.abs((18 - b.w) * kl - 2) < 0.02);
  assert.ok(Math.abs((b.e - 19) * kl - 2) < 0.02);
  assert.equal(WATER_MARGIN_KM, 2);
});

test('linia w całości wewnątrz zostaje bez zmian', () => {
  const l = [[120, 120], [150, 160], [180, 190]];
  assert.deepEqual(clipLineToBbox(l, B), [l]);
});

test('linia przecinająca granicę jest ucięta dokładnie na krawędzi', () => {
  const out = clipLineToBbox([[150, 150], [150, 300]], B);
  assert.deepEqual(out, [[[150, 150], [150, 200]]]);
});

test('linia całkowicie poza znika', () => {
  assert.deepEqual(clipLineToBbox([[300, 300], [350, 380]], B), []);
});

test('bardzo długa rzeka nie wystaje poza prostokąt (regresja Z-075)', () => {
  // rzeka biegnąca 72 km (~ 65 000 jedn.) na północ od prostokąta i dalej na południe
  const river = [[-60000, 150], [50, 150], [150, 150], [250, 150], [65000, 150]];
  const out = clipLineToBbox(river, B);
  assert.equal(out.length, 1);
  for (const l of out) for (const p of l) assert.ok(inside(p), `punkt ${p} poza prostokątem`);
  assert.deepEqual(out[0][0], [100, 150]);
  assert.deepEqual(out[0].at(-1), [200, 150]);
});

test('linia wchodząca i wychodząca dwa razy daje dwa fragmenty', () => {
  const out = clipLineToBbox([[150, 50], [150, 150], [150, 250], [50, 250], [50, 150], [150, 150]], B);
  assert.ok(out.length >= 2);
  for (const l of out) for (const p of l) assert.ok(inside(p));
});

test('pierścień w całości wewnątrz zostaje; poza znika', () => {
  const r = [[120, 120], [120, 150], [150, 150], [150, 120]];
  assert.deepEqual(clipRingToBbox(r, B), r);
  assert.equal(clipRingToBbox([[300, 300], [300, 350], [350, 350], [350, 300]], B), null);
});

test('pierścień przecinający granicę jest przycięty i zachowuje obieg', () => {
  const cw = [[150, 150], [250, 150], [250, 250], [150, 250]];
  const out = clipRingToBbox(cw, B);
  for (const p of out) assert.ok(inside(p));
  assert.equal(Math.sign(signedArea(out.map(([la, lo]) => ({ lat: la, lon: lo })))),
    Math.sign(signedArea(cw.map(([la, lo]) => ({ lat: la, lon: lo })))));
});

test('pierścień obejmujący cały prostokąt (morze) staje się prostokątem', () => {
  const out = clipRingToBbox([[0, 0], [0, 400], [400, 400], [400, 0]], B);
  for (const p of out) assert.ok(inside(p));
  assert.equal(new Set(out.map(p => p.join())).size, 4);
});

test('clipWaterToBbox: stopnie na wejściu bbox, współrzędne *1e5 w masce', () => {
  const bbox = { s: 0.001, w: 0.001, n: 0.002, e: 0.002 };
  const out = clipWaterToBbox({
    polys: [[[150, 150], [150, 160], [160, 160], [160, 150]], [[900, 900], [900, 950], [950, 950], [950, 900]]],
    lines: [[[150, 50], [150, 400]]],
  }, bbox);
  assert.equal(out.polys.length, 1);
  assert.deepEqual(out.lines, [[[150, 100], [150, 200]]]);
});
