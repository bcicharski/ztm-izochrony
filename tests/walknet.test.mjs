import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeWalkNet, snapEdges, snapSeeds, snapTime, sameEdgeSec, computeNodeTimes, paintNetwork, NET_WALK_MPS, SNAP_MAX_M } from '../js/walknet.js';
import { makeWalkRaw } from './helpers.mjs';
import { M_PER_DEG_LAT } from '../js/data.js';

// kwadrat 500 m: 0 SW, 1 SE, 2 NW, 3 NE; + odprysk 4–5 daleko na wschodzie
const dLon = 500 / (M_PER_DEG_LAT * Math.cos(50 * Math.PI / 180));
const dLat = 500 / M_PER_DEG_LAT;
const nodes = [[50, 20], [50, 20 + dLon], [50 + dLat, 20], [50 + dLat, 20 + dLon], [50, 20 + 4 * dLon], [50, 20 + 4.1 * dLon]];
const edges = [[0, 1, 500], [0, 2, 500], [1, 3, 500], [2, 3, 500], [4, 5, 32]];
const net = () => decodeWalkNet(makeWalkRaw(nodes, edges));

test('decodeWalkNet: CSR, czasy krawędzi, największa składowa', () => {
  const w = net();
  assert.equal(w.n, 6);
  assert.deepEqual([...w.main], [1, 1, 1, 1, 0, 0]);
  assert.equal(w.off[1] - w.off[0], 2); // węzeł 0 ma dwóch sąsiadów
  assert.equal(w.adjSec[w.off[0]], Math.round(500 / NET_WALK_MPS));
});

test('snapEdges: rzut na wnętrze krawędzi, kandydatki, odprysk pomijany, limit odległości', () => {
  const w = net();
  const s = snapEdges(w, 50 + 2 / M_PER_DEG_LAT, 20 + dLon / 2); // 2 m na północ od środka krawędzi 0–1
  assert.equal(s.length, 1);
  assert.equal(s[0].a, 0); assert.equal(s[0].b, 1);
  assert.ok(Math.abs(s[0].t - 0.5) < 0.01);
  assert.ok(s[0].perpM > 1.5 && s[0].perpM < 2.5);
  assert.ok(Math.abs(s[0].secA - 250 / NET_WALK_MPS) < 0.5);
  // róg kwadratu: obie krawędzie przy węźle 0 w tolerancji 25 m
  const corner = snapEdges(w, 50 - 5 / M_PER_DEG_LAT, 20);
  assert.equal(corner.length, 2);
  // punkt przy odprysku: odprysk pomijany, a główna sieć jest > 400 m → brak
  assert.equal(snapEdges(w, 50, 20 + 4.05 * dLon).length, 0);
  assert.equal(snapEdges(w, 50 + 10 * dLat, 20, SNAP_MAX_M).length, 0);
});

test('snapSeeds / snapTime / sameEdgeSec: czasy przez końce i wprost wzdłuż krawędzi', () => {
  const w = net();
  const a = snapEdges(w, 50, 20 + dLon * 0.2); // na krawędzi 0–1, 100 m od węzła 0
  const b = snapEdges(w, 50, 20 + dLon * 0.8); // 400 m od węzła 0
  const seeds = snapSeeds(a, 0);
  assert.deepEqual(seeds.map(x => x[0]).sort(), [0, 1]);
  assert.equal(seeds.find(x => x[0] === 0)[1], Math.round(100 / NET_WALK_MPS));
  const nodeTime = computeNodeTimes(w, seeds, 3600);
  // do b przez węzeł 1: 400 m + 100 m; wprost: 300 m
  assert.equal(snapTime(nodeTime, b), Math.round(500 / NET_WALK_MPS));
  assert.equal(sameEdgeSec(a, b), Math.round(300 / NET_WALK_MPS));
  assert.equal(sameEdgeSec(a, snapEdges(w, 50 + dLat, 20 + dLon / 2)), Infinity);
  // węzeł 3 (NE): 400 m do węzła 1 + 500 m = 900 m
  assert.equal(nodeTime[3], Math.round(400 / NET_WALK_MPS) + Math.round(500 / NET_WALK_MPS));
  assert.equal(nodeTime[4], -1, 'odprysk nieosiągalny');
});

test('paintNetwork: wnętrze krawędzi malowane od rzutu, nie przez końce', () => {
  const w = net();
  const res = 25, W = 40, H = 40;
  const lonW = 20 - 5 * dLon / 20, latN = 50 + dLat + 5 * dLat / 20;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(50 * Math.PI / 180);
  const grid = { W, H, res, land: new Uint8Array(W * H).fill(1), time: new Uint16Array(W * H),
    toX: lon => (lon - lonW) * mPerDegLon / res, toY: lat => (latN - lat) * M_PER_DEG_LAT / res };
  const pixelIndex = (g, lat, lon) => { const x = Math.round(g.toX(lon)), y = Math.round(g.toY(lat)); return (x < 0 || y < 0 || x >= g.W || y >= g.H) ? -1 : y * g.W + x; };
  const origin = snapEdges(w, 50, 20 + dLon / 2); // środek krawędzi 0–1
  const nodeTime = computeNodeTimes(w, snapSeeds(origin, 0), 3600);
  const edgeSeeds = new Map([[origin[0].edge, [[origin[0].t, origin[0].perpSec]]]]);
  paintNetwork(w, nodeTime, grid, pixelIndex, 65535, 3600, edgeSeeds);
  const atOrigin = grid.time[pixelIndex(grid, 50, 20 + dLon / 2)];
  assert.ok(atOrigin <= 20, `punkt startu ≈ 0 s, jest ${atOrigin}`);
  const atNode0 = grid.time[pixelIndex(grid, 50, 20)];
  assert.ok(Math.abs(atNode0 - 250 / NET_WALK_MPS) < 30);
  // bez edgeSeeds środek krawędzi dostałby czas przez końce (≈ 2 × 200 s)
  paintNetwork(w, nodeTime, grid, pixelIndex, 65535, 3600, null);
  assert.ok(grid.time[pixelIndex(grid, 50, 20 + dLon / 2)] > 300);
});
