#!/usr/bin/env node
/**
 * Brama jakości dla zmian formatu/kodowania walknet.json (Z-003): porównuje
 * trasowanie po STARYM i NOWYM pliku tego samego miasta. Tylko do odczytu.
 *
 * Użycie:
 *   node tools/walknet-ab.mjs <miasto|all> [--points N] [--new plik]
 *
 * Stary plik: data/<miasto>/walknet.json. Nowy: domyślnie ten sam graf
 * przekodowany w pamięci na v2 (tools/walknet-codec.mjs) — czyli to, co
 * zapisałoby `reencode-walknet.mjs --write`; `--new plik` wskazuje gotowy plik
 * (jedno miasto).
 *
 * Dla N deterministycznie losowanych punktów (przystanek miasta + rozrzut do
 * 400 m) liczy czas dojścia do WSZYSTKICH przystanków miasta oraz sumę metrów
 * sieci osiągalnej w pasmach 10/20/30/45/60 min (krawędź liczy się, gdy
 * osiągalne są oba jej końce). Progi: mediana różnicy czasu ≤ 5 s,
 * p95 ≤ 15 s, zmiana metrów w każdym paśmie ≤ 1,5%, udział głównej składowej
 * spójnej nie spada. Przystanek osiągalny tylko w jednej sieci liczy się jako
 * różnica równa horyzontowi (3600 s).
 *
 * Kodowanie reszty jest bezstratne, więc oczekiwana różnica to dokładnie zero.
 * Cokolwiek innego oznacza błąd kodowania albo dekodera — nie „tolerancję".
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  decodeWalkNet, snapEdges, snapSeeds, snapTime, sameEdgeSec, computeNodeTimes,
  NET_WALK_MPS, SNAP_MAX_M,
} from '../js/walknet.js';
import { M_PER_DEG_LAT } from '../js/data.js';
import { encodeWalkNet, graphFromNet, netDifference } from './walknet-codec.mjs';
import { percentile } from './measure-lib.mjs';

export const BANDS_MIN = [10, 20, 30, 45, 60];
export const HORIZON_S = BANDS_MIN[BANDS_MIN.length - 1] * 60;
export const GATE = { medianS: 5, p95S: 15, bandChange: 0.015 };
const JITTER_M = 400;

/** Deterministyczny RNG (mulberry32) — ta sama próbka przy każdym uruchomieniu. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Punkty próby: losowy przystanek + rozrzut do JITTER_M w każdej osi. */
export function samplePoints(stops, count, seed = 20261127) {
  const rand = rng(seed);
  const pts = [];
  for (let i = 0; i < count && stops.lat.length; i++) {
    const s = Math.floor(rand() * stops.lat.length);
    const kLon = M_PER_DEG_LAT * Math.cos(stops.lat[s] * Math.PI / 180);
    pts.push({
      lat: stops.lat[s] + (rand() * 2 - 1) * JITTER_M / M_PER_DEG_LAT,
      lon: stops.lon[s] + (rand() * 2 - 1) * JITTER_M / kLon,
    });
  }
  return pts;
}

/** Czasy dojścia [s] z punktu do każdego przystanku (−1 = poza horyzontem/siecią) i metry w pasmach. */
function probe(net, stopSnaps, point) {
  const snaps = snapEdges(net, point.lat, point.lon, SNAP_MAX_M);
  const stopSec = new Int32Array(stopSnaps.length).fill(-1);
  const bandM = new Float64Array(BANDS_MIN.length);
  if (!snaps.length) return { stopSec, bandM, snapped: false };
  const nodeTime = computeNodeTimes(net, snapSeeds(snaps, 0), HORIZON_S, NET_WALK_MPS);
  for (let i = 0; i < stopSnaps.length; i++) {
    if (!stopSnaps[i].length) continue;
    const via = snapTime(nodeTime, stopSnaps[i]);
    const t = Math.min(via < 0 ? Infinity : via, sameEdgeSec(snaps, stopSnaps[i]));
    if (t <= HORIZON_S) stopSec[i] = t;
  }
  for (let e = 0; e < net.edgeLen.length; e++) {
    const ta = nodeTime[net.edgeFrom[e]], tb = nodeTime[net.edgeTo[e]];
    if (ta < 0 || tb < 0) continue;
    const t = Math.max(ta, tb);
    for (let b = 0; b < BANDS_MIN.length; b++) if (t <= BANDS_MIN[b] * 60) bandM[b] += net.edgeLen[e];
  }
  return { stopSec, bandM, snapped: true };
}

/**
 * Porównanie dwóch sieci. Czyste (bez dysku), więc testowalne na małych grafach.
 * @param {object} oldNet @param {object} newNet sieci z `decodeWalkNet`
 * @param {{lat: ArrayLike<number>, lon: ArrayLike<number>}} stops przystanki miasta
 * @param {{points?: number}} [opts]
 */
export function compareNets(oldNet, newNet, stops, { points = 100 } = {}) {
  const snapAll = net => Array.from(stops.lat, (_, i) => snapEdges(net, stops.lat[i], stops.lon[i], SNAP_MAX_M));
  const oldStops = snapAll(oldNet), newStops = snapAll(newNet);
  const diffs = [];
  let oneSided = 0, compared = 0, snapMismatch = 0;
  const bandOld = new Float64Array(BANDS_MIN.length), bandNew = new Float64Array(BANDS_MIN.length);
  const sample = samplePoints(stops, points);
  for (const p of sample) {
    const a = probe(oldNet, oldStops, p), b = probe(newNet, newStops, p);
    if (a.snapped !== b.snapped) snapMismatch++;
    for (let i = 0; i < a.stopSec.length; i++) {
      const x = a.stopSec[i], y = b.stopSec[i];
      if (x < 0 && y < 0) continue;
      compared++;
      if (x < 0 || y < 0) { oneSided++; diffs.push(HORIZON_S); } else diffs.push(Math.abs(x - y));
    }
    a.bandM.forEach((v, k) => { bandOld[k] += v; });
    b.bandM.forEach((v, k) => { bandNew[k] += v; });
  }
  diffs.sort((x, y) => x - y);
  const bandChange = Array.from(bandOld, (v, k) => (v ? Math.abs(bandNew[k] - v) / v : (bandNew[k] ? 1 : 0)));
  const share = net => net.main.reduce((s, v) => s + v, 0) / (net.n || 1);
  const r = {
    points: sample.length, stopPairs: compared, oneSided, snapMismatch,
    medianS: percentile(diffs, 50), p95S: percentile(diffs, 95), maxS: diffs.length ? diffs[diffs.length - 1] : 0,
    bandOldM: Array.from(bandOld), bandNewM: Array.from(bandNew), bandChange,
    mainShareOld: share(oldNet), mainShareNew: share(newNet),
    graphDifference: netDifference(oldNet, newNet),
  };
  r.pass = r.stopPairs > 0 // brak próby (zero osiągalnych par) to nie jest zielone światło
    && r.medianS <= GATE.medianS && r.p95S <= GATE.p95S
    && bandChange.every(c => c <= GATE.bandChange)
    && r.mainShareNew >= r.mainShareOld && r.snapMismatch === 0;
  return r;
}

/** Przystanki miasta z data/<miasto>/workday.json (te same, których używa silnik). */
export function loadStops(dir) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'workday.json'), 'utf8'));
  return { lat: raw.stops.lat.map(v => v / 1e5), lon: raw.stops.lon.map(v => v / 1e5) };
}

function main() {
  const DATA = path.join(import.meta.dirname, '..', 'data');
  const args = process.argv.slice(2);
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const points = Number(opt('--points') ?? 100);
  const newFile = opt('--new');
  const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--points' && args[i - 1] !== '--new');
  const cities = JSON.parse(fs.readFileSync(path.join(DATA, 'cities.json'), 'utf8'));
  const keys = target === 'all' ? Object.keys(cities) : [target];
  if (!target || !keys.every(k => cities[k]) || (newFile && keys.length !== 1)) {
    console.error(`Użycie: walknet-ab.mjs <miasto|all> [--points N] [--new plik]. Miasta: ${Object.keys(cities).join(', ')}`);
    process.exit(1);
  }
  let allPass = true;
  for (const key of keys) {
    const dir = path.join(DATA, key);
    const oldRaw = JSON.parse(fs.readFileSync(path.join(dir, 'walknet.json'), 'utf8'));
    const oldNet = decodeWalkNet(oldRaw);
    // nowy plik także przechodzi przez tekst JSON, tak jak zobaczy go przeglądarka
    const newRaw = newFile
      ? JSON.parse(fs.readFileSync(newFile, 'utf8'))
      : JSON.parse(JSON.stringify(encodeWalkNet(graphFromNet(oldNet, oldRaw.quant || 1e5))));
    const t0 = Date.now();
    const r = compareNets(oldNet, decodeWalkNet(newRaw), loadStops(dir), { points });
    allPass &&= r.pass;
    console.log(`${key.padEnd(12)} ${r.pass ? 'PRZESZŁO' : 'NIE PRZESZŁO'}  punkty ${r.points}, pary ${r.stopPairs}, ` +
      `jednostronne ${r.oneSided}, mediana ${r.medianS} s, p95 ${r.p95S} s, max ${r.maxS} s, ` +
      `metry w pasmach (zmiana %) ${r.bandChange.map(c => (c * 100).toFixed(2)).join('/')}, ` +
      `główna składowa ${(r.mainShareOld * 100).toFixed(2)}% -> ${(r.mainShareNew * 100).toFixed(2)}%, ` +
      `graf ${r.graphDifference ?? 'identyczny'}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  console.log(allPass ? '\nBRAMA: PRZESZŁA dla wszystkich' : '\nBRAMA: NIE PRZESZŁA');
  if (!allPass) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main();
