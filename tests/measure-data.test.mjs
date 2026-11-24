import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentile, shareBelow, sumShareBelow, degreeHistogram, graphStats, zigzag, unzigzag,
  pushVarint, readVarint, hilbertIndex, nodeOrder, buildVariant, restoreLens, variantBinary,
  parseVariantBinary, variantJson, sourceGraph, measureVariants, gain, quantErrorM, gzipSize,
} from '../tools/measure-lib.mjs';
import { decodeWalkNet } from '../js/walknet.js';
import { makeWalkRaw } from './helpers.mjs';
import { M_PER_DEG_LAT } from '../js/data.js';

const dLon = 100 / (M_PER_DEG_LAT * Math.cos(50 * Math.PI / 180));
const dLat = 100 / M_PER_DEG_LAT;
// siatka 5x4 węzłów co 100 m, krawędzie poziome i pionowe z realistycznymi długościami
const nodes = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) nodes.push([50 + r * dLat, 20 + c * dLon]);
const edges = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
  const i = r * 5 + c;
  if (c < 4) edges.push([i, i + 1, 100 + (i % 3)]);
  if (r < 3) edges.push([i, i + 5, 101 + (i % 2)]);
}
const raw = makeWalkRaw(nodes, edges);
const net = decodeWalkNet(raw);
const sortNum = arr => Array.from(arr).sort((a, b) => a - b);

test('percentile: najbliższa ranga', () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(s, 50), 5);
  assert.equal(percentile(s, 90), 9);
  assert.equal(percentile(s, 100), 10);
  assert.equal(percentile(s, 1), 1);
  assert.ok(Number.isNaN(percentile([], 50)));
});

test('shareBelow / sumShareBelow: próg ostry', () => {
  assert.equal(shareBelow([5, 10, 15, 20], 10), 0.25);
  assert.equal(shareBelow([], 10), 0);
  assert.equal(sumShareBelow([5, 5, 30], 10), 10 / 40);
  assert.equal(sumShareBelow([], 10), 0);
});

test('degreeHistogram: kubełek końcowy zbiera resztę', () => {
  assert.deepEqual(degreeHistogram([0, 1, 1, 2, 3, 6, 9], 4),
    { 0: 1, 1: 2, 2: 1, 3: 1, '4+': 2 });
});

test('graphStats: liczności i udziały na grafie syntetycznym', () => {
  const st = graphStats(raw, net);
  assert.equal(st.nodes, 20);
  assert.equal(st.edges, edges.length);
  assert.equal(st.shortShare[40].edges, 0);
  assert.equal(st.shortShare[10].edges, 0);
  assert.ok(st.percentiles[50] >= 100 && st.percentiles[50] <= 102);
  assert.equal(Object.values(st.degrees).reduce((a, b) => a + b, 0), 20);
  assert.equal(st.degrees[2], 4); // cztery narożniki siatki
});

test('zigzag i varint: odwracalne, także dla dużych wartości', () => {
  for (const v of [0, 1, -1, 63, -64, 64, 100000, -100000, 5053558]) assert.equal(unzigzag(zigzag(v)), v);
  const out = [];
  const vals = [0, 127, 128, 300, 16384, 5053558 * 2];
  for (const v of vals) pushVarint(out, v);
  let o = 0;
  for (const v of vals) { let r; [r, o] = readVarint(out, o); assert.equal(r, v); }
  assert.equal(o, out.length);
});

test('hilbertIndex: bijekcja na siatce 4x4, sąsiedztwo kolejnych komórek', () => {
  const seen = new Map();
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) seen.set(hilbertIndex(4, x, y), [x, y]);
  assert.equal(seen.size, 16);
  for (let d = 1; d < 16; d++) {
    const [x0, y0] = seen.get(d - 1), [x1, y1] = seen.get(d);
    assert.equal(Math.abs(x0 - x1) + Math.abs(y0 - y1), 1);
  }
});

test('nodeOrder: permutacja dla pasm i Hilberta', () => {
  const g = sourceGraph(net);
  for (const order of [{ kind: 'band', bandM: 250 }, { kind: 'hilbert' }]) {
    const p = nodeOrder(g, order);
    assert.deepEqual(sortNum(p), Array.from({ length: 20 }, (_, i) => i));
  }
});

test('buildVariant: obecny wariant odtwarza strukturę walknet.json (dekoder daje ten sam graf)', () => {
  const v = buildVariant(sourceGraph(net), { order: { kind: 'band', bandM: 500 }, quant: 1e5, lenMode: 'value' });
  const back = decodeWalkNet({ version: 1, quant: v.quant, nodes: { dLat: v.dLat, dLon: v.dLon }, edges: { a: v.a, b: v.b, len: v.len } });
  assert.equal(back.n, net.n);
  assert.equal(back.edgeLen.length, net.edgeLen.length);
  assert.deepEqual(sortNum(back.edgeLen), sortNum(net.edgeLen));
});

test('buildVariant: reszta od cięciwy jest odwracalna, w każdym porządku i kwantyzacji', () => {
  for (const order of [{ kind: 'band', bandM: 100 }, { kind: 'hilbert' }]) {
    for (const quant of [1e5, 1e4]) {
      const v = buildVariant(sourceGraph(net), { order, quant, lenMode: 'residual' });
      assert.deepEqual(sortNum(restoreLens(v)), sortNum(net.edgeLen));
    }
  }
});

test('zapis binarny: odwracalny i mniejszy niż JSON przed kompresją', () => {
  const v = buildVariant(sourceGraph(net), { order: { kind: 'hilbert' }, quant: 1e5, lenMode: 'residual' });
  const parsed = parseVariantBinary(variantBinary(v));
  assert.deepEqual(parsed, { quant: v.quant, dLat: v.dLat, dLon: v.dLon, a: v.a, b: v.b, len: v.len });
  assert.ok(variantBinary(v).length < variantJson(v).length);
});

test('measureVariants: komplet pól, odniesienie pierwsze, rozmiary dodatnie', () => {
  const res = measureVariants(net);
  assert.equal(res[0].id, 'obecny');
  for (const r of res) {
    assert.ok(r.jsonRaw > 0 && r.jsonGz6 > 0 && r.jsonGz9 > 0 && r.binRaw > 0 && r.binGz9 > 0);
  }
  assert.ok(res.find(r => r.id === 'q1e4').quantErrM > res.find(r => r.id === 'q5e4').quantErrM);
});

test('gain, quantErrorM, gzipSize', () => {
  assert.equal(gain(100, 80), 0.2);
  assert.equal(gain(0, 5), 0);
  assert.ok(Math.abs(quantErrorM(1e5) - 0.5 / 1e5 * M_PER_DEG_LAT) < 1e-9);
  assert.ok(gzipSize(Buffer.alloc(10000, 'a'), 6) < 100);
});
