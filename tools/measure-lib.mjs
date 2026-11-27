/**
 * Czyste funkcje pomiarowe dla tools/measure-data.mjs (Z-003, kroki 1–2).
 *
 * Nic tu nie dotyka dysku ani sieci: statystyki grafu pieszego oraz kodowanie
 * HIPOTETYCZNYCH wariantów walknet.json w pamięci (porządek węzłów, kwantyzacja,
 * długość krawędzi jako reszta, zapis binarny). Wyniki służą wyłącznie do
 * zmierzenia rozmiaru po gzipie — niczego się nie zapisuje.
 */

import zlib from 'node:zlib';
import { M_PER_DEG_LAT } from '../js/data.js';
import { chordM } from '../js/walknet.js';

/** Rozmiar po gzipie na zadanym poziomie (serwer: 6; maksimum: 9). */
export const gzipSize = (buf, level) => zlib.gzipSync(buf, { level }).length;

/**
 * Percentyl metodą najbliższej rangi (nearest-rank) na posortowanej rosnąco tablicy.
 * @param {ArrayLike<number>} sorted
 * @param {number} p 0–100
 */
export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Udział wartości ostro mniejszych niż próg (0–1). */
export function shareBelow(values, threshold) {
  if (!values.length) return 0;
  let c = 0;
  for (const v of values) if (v < threshold) c++;
  return c / values.length;
}

/** Udział SUMY wartości pochodzący z wartości mniejszych niż próg (0–1). */
export function sumShareBelow(values, threshold) {
  let total = 0, part = 0;
  for (const v of values) { total += v; if (v < threshold) part += v; }
  return total ? part / total : 0;
}

/**
 * Histogram stopni wierzchołków: klucze 0..maxBucket-1 osobno, reszta w `maxBucket+`.
 * @param {ArrayLike<number>} degrees
 * @returns {Record<string, number>}
 */
export function degreeHistogram(degrees, maxBucket = 6) {
  const h = {};
  for (let i = 0; i < maxBucket; i++) h[i] = 0;
  h[`${maxBucket}+`] = 0;
  for (const d of degrees) h[d >= maxBucket ? `${maxBucket}+` : d]++;
  return h;
}

export const EDGE_THRESHOLDS_M = [10, 20, 25, 40];
export const EDGE_PERCENTILES = [5, 25, 50, 75, 90, 99];

/**
 * Statystyki grafu z surowego walknet.json.
 * @param {object} raw zawartość walknet.json
 * @param {{off: Int32Array, n: number}} net wynik `decodeWalkNet` (stopnie z CSR)
 */
export function graphStats(raw, net) {
  const lens = Array.from(raw.edges.len).sort((a, b) => a - b);
  const degrees = new Int32Array(net.n);
  for (let i = 0; i < net.n; i++) degrees[i] = net.off[i + 1] - net.off[i];
  let km = 0;
  for (const v of lens) km += v;
  return {
    nodes: net.n,
    edges: lens.length,
    km: km / 1000,
    degrees: degreeHistogram(degrees),
    percentiles: Object.fromEntries(EDGE_PERCENTILES.map(p => [p, percentile(lens, p)])),
    shortShare: Object.fromEntries(EDGE_THRESHOLDS_M.map(t => [t, {
      edges: shareBelow(lens, t),
      km: sumShareBelow(lens, t),
    }])),
  };
}

// --- kodowanie wariantów -------------------------------------------------

/** zigzag: liczby ze znakiem -> nieujemne (0,-1,1,-2 -> 0,1,2,3). */
export const zigzag = v => (v >= 0 ? v * 2 : -v * 2 - 1);
export const unzigzag = z => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

/** Dopisuje varint (LEB128, 7 bitów na bajt) do tablicy bajtów; wartość nieujemna, całkowita. */
export function pushVarint(out, value) {
  let v = value;
  while (v >= 0x80) { out.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80); }
  out.push(v);
}

/** Odczyt varintu: zwraca [wartość, nowy offset]. */
export function readVarint(buf, offset) {
  let result = 0, mul = 1, i = offset;
  for (;;) {
    const b = buf[i++];
    result += (b & 0x7f) * mul;
    if (!(b & 0x80)) break;
    mul *= 0x80;
  }
  return [result, i];
}

/** Indeks krzywej Hilberta (xy -> d) na siatce n×n, n potęga dwójki. */
export function hilbertIndex(n, x, y) {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    // obrót ćwiartki
    x &= s - 1; y &= s - 1;
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      [x, y] = [y, x];
    }
  }
  return d;
}

/**
 * Kolejność węzłów (permutacja: pozycja -> stary indeks).
 * @param {{lat: ArrayLike<number>, lon: ArrayLike<number>}} pts stopnie
 * @param {{kind: 'band'|'hilbert', bandM?: number}} order
 */
export function nodeOrder(pts, order) {
  const n = pts.lat.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (let i = 0; i < n; i++) {
    latMin = Math.min(latMin, pts.lat[i]); latMax = Math.max(latMax, pts.lat[i]);
    lonMin = Math.min(lonMin, pts.lon[i]); lonMax = Math.max(lonMax, pts.lon[i]);
  }
  if (order.kind === 'hilbert') {
    const SIDE = 1 << 15;
    const sLat = (latMax - latMin) || 1, sLon = (lonMax - lonMin) || 1;
    const keys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      keys[i] = hilbertIndex(
        SIDE,
        Math.min(SIDE - 1, Math.floor((pts.lon[i] - lonMin) / sLon * SIDE)),
        Math.min(SIDE - 1, Math.floor((pts.lat[i] - latMin) / sLat * SIDE)));
    }
    return idx.sort((i, j) => keys[i] - keys[j] || i - j);
  }
  // pasma: jak w tools/build-walknet.mjs (rząd po szerokości, w rzędzie po długości)
  const cellDeg = order.bandM / M_PER_DEG_LAT;
  const row = i => Math.floor((pts.lat[i] - latMin) / cellDeg);
  return idx.sort((i, j) => (row(i) - row(j)) || (pts.lon[i] - pts.lon[j]) || (i - j));
}

/** Cięciwa — jedna definicja w js/walknet.js (dekoder i enkoder muszą liczyć tak samo). */
export { chordM };

/**
 * Buduje w pamięci logiczną treść wariantu (te same pięć strumieni co walknet.json v1).
 * @param {{lat: ArrayLike<number>, lon: ArrayLike<number>, from: ArrayLike<number>,
 *   to: ArrayLike<number>, len: ArrayLike<number>}} g graf źródłowy (stopnie, indeksy, metry)
 * @param {{order: {kind: string, bandM?: number}, quant: number, lenMode: 'value'|'residual'}} v
 * @returns {{dLat:number[], dLon:number[], a:number[], b:number[], len:number[], quant:number}}
 */
export function buildVariant(g, v) {
  const perm = nodeOrder(g, v.order);
  const remap = new Int32Array(perm.length);
  perm.forEach((old, neu) => { remap[old] = neu; });
  const qLat = perm.map(i => Math.round(g.lat[i] * v.quant));
  const qLon = perm.map(i => Math.round(g.lon[i] * v.quant));
  const edges = [];
  for (let e = 0; e < g.from.length; e++) edges.push([remap[g.from[e]], remap[g.to[e]], g.len[e]]);
  edges.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
  const diff = arr => arr.map((x, i) => (i ? x - arr[i - 1] : x));
  return {
    quant: v.quant,
    dLat: diff(qLat),
    dLon: diff(qLon),
    a: edges.map((e, i) => (i ? e[0] - edges[i - 1][0] : e[0])),
    b: edges.map(e => e[1] - e[0]),
    len: edges.map(e => (v.lenMode === 'residual'
      ? e[2] - Math.round(chordM(qLat[e[0]], qLon[e[0]], qLat[e[1]], qLon[e[1]], v.quant))
      : e[2])),
  };
}

/** Odtwarza długości [m] z wariantu `residual` (wyłącznie do testów i weryfikacji). */
export function restoreLens(variant) {
  const { quant: q, dLat, dLon, a, b, len } = variant;
  const qLat = [], qLon = [];
  let la = 0, lo = 0;
  for (let i = 0; i < dLat.length; i++) { la += dLat[i]; lo += dLon[i]; qLat.push(la); qLon.push(lo); }
  let acc = 0;
  return len.map((r, i) => {
    acc += a[i];
    const to = acc + b[i];
    return r + Math.round(chordM(qLat[acc], qLon[acc], qLat[to], qLon[to], q));
  });
}

/** Zapis JSON (jak dziś: kompaktowy). */
export const variantJson = variant => Buffer.from(JSON.stringify({
  version: 1,
  quant: variant.quant,
  nodes: { dLat: variant.dLat, dLon: variant.dLon },
  edges: { a: variant.a, b: variant.b, len: variant.len },
}));

/**
 * Zapis binarny: nagłówek (n, m, quant) i pięć kolumn varintów ze znakiem (zigzag).
 * Kolumnowo, bo gzip lepiej ściska jednorodne strumienie.
 */
export function variantBinary(variant) {
  const out = [];
  pushVarint(out, variant.dLat.length);
  pushVarint(out, variant.a.length);
  pushVarint(out, variant.quant);
  for (const col of [variant.dLat, variant.dLon, variant.a, variant.b, variant.len]) {
    for (const x of col) pushVarint(out, zigzag(x));
  }
  return Buffer.from(out);
}

/** Dekoduje bufor `variantBinary` z powrotem do kolumn (test odwracalności). */
export function parseVariantBinary(buf) {
  let o = 0, n, m, quant;
  [n, o] = readVarint(buf, o); [m, o] = readVarint(buf, o); [quant, o] = readVarint(buf, o);
  const col = count => {
    const r = [];
    for (let i = 0; i < count; i++) { let z; [z, o] = readVarint(buf, o); r.push(unzigzag(z)); }
    return r;
  };
  return { quant, dLat: col(n), dLon: col(n), a: col(m), b: col(m), len: col(m) };
}

/** Maksymalny błąd położenia węzła od kwantyzacji [m] (pół kroku siatki w szerokości). */
export const quantErrorM = q => 0.5 / q * M_PER_DEG_LAT;

/** Ze zdekodowanej sieci (`decodeWalkNet`) wyciąga graf źródłowy dla `buildVariant`. */
export function sourceGraph(net) {
  return { lat: net.lat, lon: net.lon, from: net.edgeFrom, to: net.edgeTo, len: net.edgeLen };
}

/** Zestaw wariantów z projektu Z-003 (krok 2). Pierwszy to punkt odniesienia. */
export const VARIANTS = [
  { id: 'obecny', label: 'obecny (pasma 500 m, 1e5, długość=wartość)', order: { kind: 'band', bandM: 500 }, quant: 1e5, lenMode: 'value' },
  { id: 'pasma250', label: 'pasma 250 m', order: { kind: 'band', bandM: 250 }, quant: 1e5, lenMode: 'value' },
  { id: 'pasma100', label: 'pasma 100 m', order: { kind: 'band', bandM: 100 }, quant: 1e5, lenMode: 'value' },
  { id: 'hilbert', label: 'krzywa Hilberta', order: { kind: 'hilbert' }, quant: 1e5, lenMode: 'value' },
  { id: 'q5e4', label: 'kwantyzacja 5e4', order: { kind: 'band', bandM: 500 }, quant: 5e4, lenMode: 'value' },
  { id: 'q1e4', label: 'kwantyzacja 1e4', order: { kind: 'band', bandM: 500 }, quant: 1e4, lenMode: 'value' },
  { id: 'reszta', label: 'długość jako reszta od cięciwy', order: { kind: 'band', bandM: 500 }, quant: 1e5, lenMode: 'residual' },
  { id: 'hilbert+reszta', label: 'Hilbert + reszta', order: { kind: 'hilbert' }, quant: 1e5, lenMode: 'residual' },
  { id: 'hilbert+reszta+5e4', label: 'Hilbert + reszta + 5e4', order: { kind: 'hilbert' }, quant: 5e4, lenMode: 'residual' },
];

/** Mierzy wszystkie warianty: JSON gzip-6/9 oraz binarny gzip-9. */
export function measureVariants(net, variants = VARIANTS) {
  const g = sourceGraph(net);
  return variants.map(v => {
    const variant = buildVariant(g, v);
    const json = variantJson(variant);
    const bin = variantBinary(variant);
    return {
      ...v,
      jsonRaw: json.length,
      jsonGz6: gzipSize(json, 6),
      jsonGz9: gzipSize(json, 9),
      binRaw: bin.length,
      binGz9: gzipSize(bin, 9),
      quantErrM: quantErrorM(v.quant),
    };
  });
}

/** Zysk względem odniesienia: (ref − x) / ref. Dodatni = mniejszy plik. */
export const gain = (ref, x) => (ref ? (ref - x) / ref : 0);

export const GATE_JSON = 0.15;
export const GATE_BINARY = 0.25;
