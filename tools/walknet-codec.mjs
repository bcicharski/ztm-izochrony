/**
 * Enkoder walknet.json (Z-003) — jedno miejsce, z którego korzystają
 * tools/build-walknet.mjs i tools/reencode-walknet.mjs. Dekoder to
 * `decodeWalkNet` z js/walknet.js; obie strony dzielą `chordM`.
 *
 * Formaty (rozpoznawane w dekoderze po polu `edges.len` / `edges.res`):
 *   v1  { version:1, quant, nodes:{dLat,dLon}, edges:{a,b,len} }
 *   v2  { version:2, quant, nodes:{dLat,dLon}, edges:{a,b,res} }
 *       res = len − round(chordM(końce krawędzi)) — bezstratnie; zmierzone
 *       15,8–17,0% mniej po gzipie (tools/measure-data.mjs --variants).
 */

import { chordM } from '../js/walknet.js';

/** Różnice kolejnych elementów (pierwszy zostaje wartością). */
const diff = arr => arr.map((x, i) => (i ? x - arr[i - 1] : x));

/**
 * Składa obiekt gotowy do `JSON.stringify`.
 * Kolejność węzłów i krawędzi jest zachowana tak, jak ją podano — enkoder niczego
 * nie sortuje, więc przekodowanie nie zmienia grafu ani indeksów.
 * @param {{qLat: ArrayLike<number>, qLon: ArrayLike<number>, quant: number,
 *   edges: Array<[number, number, number]>}} g węzły jako liczby całkowite
 *   (stopnie × quant), krawędzie [początek, koniec, długość m]
 * @param {{version?: 1|2}} [opts] domyślnie 2
 */
export function encodeWalkNet(g, { version = 2 } = {}) {
  const { qLat, qLon, quant, edges } = g;
  const eA = edges.map((e, i) => (i ? e[0] - edges[i - 1][0] : e[0]));
  const eB = edges.map(e => e[1] - e[0]);
  const nodes = { dLat: diff(Array.from(qLat)), dLon: diff(Array.from(qLon)) };
  if (version === 1) {
    return { version: 1, quant, nodes, edges: { a: eA, b: eB, len: edges.map(e => e[2]) } };
  }
  const res = edges.map(e => e[2] - Math.round(chordM(qLat[e[0]], qLon[e[0]], qLat[e[1]], qLon[e[1]], quant)));
  return { version: 2, quant, nodes, edges: { a: eA, b: eB, res } };
}

/**
 * Graf źródłowy dla `encodeWalkNet` ze zdekodowanej sieci (`decodeWalkNet`).
 * Współrzędne wracają do liczb całkowitych (lat = k / quant, więc round(lat·quant) = k).
 */
export function graphFromNet(net, quant) {
  const qLat = Array.from(net.lat, v => Math.round(v * quant));
  const qLon = Array.from(net.lon, v => Math.round(v * quant));
  const edges = [];
  for (let e = 0; e < net.edgeFrom.length; e++) edges.push([net.edgeFrom[e], net.edgeTo[e], net.edgeLen[e]]);
  return { qLat, qLon, quant, edges };
}

/** Czy dwie tablice (zwykłe albo typowane) mają identyczną zawartość. */
const sameArray = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

/**
 * Dosłowna równość dwóch zdekodowanych sieci: te same węzły, krawędzie, długości
 * i lista sąsiedztwa. Zwraca opis pierwszej różnicy albo `null`.
 */
export function netDifference(a, b) {
  if (a.n !== b.n) return `liczba węzłów ${a.n} ≠ ${b.n}`;
  for (const key of ['lat', 'lon', 'edgeFrom', 'edgeTo', 'edgeLen', 'off', 'adjTo', 'adjLen', 'main']) {
    if (!sameArray(a[key], b[key])) return `pole ${key} różni się`;
  }
  return null;
}
