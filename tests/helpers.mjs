/**
 * Pomocnicze konstrukcje do testów: syntetyczne sieci rozkładowe w formacie
 * data/<miasto>/<dzień>.json (v3), syntetyczne grafy ulic w formacie
 * walknet.json, deterministyczny generator losowy i wyrocznia najwcześniejszego
 * dojazdu (niezależna od RAPTOR-a implementacja tej samej semantyki).
 */

import { decodeNetwork } from '../js/data.js';

/** Deterministyczny RNG (mulberry32) — testy losowe muszą być powtarzalne. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Surowy JSON sieci rozkładowej (v3, sekundy).
 * @param {object} spec
 *   stops: [{name, lat, lon, group?}]  — group domyślnie = indeks
 *   routes: [{n, t}]
 *   patterns: [{r, s:[stopIdx], p:[[deltaSec...]], t:[[startSec, profIdx]], f?, d?}]
 *   transfers: [[a, b, sec]]
 */
export function makeRaw({ stops, routes, patterns, transfers = [], version = 3 }) {
  return {
    version,
    day: 'workday',
    date: '20260101',
    routes,
    stops: {
      name: stops.map(s => s.name),
      lat: stops.map(s => Math.round(s.lat * 1e5)),
      lon: stops.map(s => Math.round(s.lon * 1e5)),
      group: stops.map((s, i) => s.group ?? i),
    },
    transfers,
    patterns: patterns.map(p => ({ r: p.r, s: p.s, f: p.f ?? 0, p: p.p, t: p.t, ...(p.d ? { d: p.d } : {}) })),
  };
}

export const makeNet = spec => decodeNetwork(makeRaw(spec));

/** Kursy co `headway` s od `from` do `to` (włącznie), wszystkie z profilem `prof`. */
export function everyN(from, to, headway, prof = 0) {
  const out = [];
  for (let s = from; s <= to; s += headway) out.push([s, prof]);
  return out;
}

/**
 * Surowy JSON grafu ulic (format build-walknet.mjs v1): węzły w podanej
 * kolejności, krawędzie [a, b, lenM] (a < b).
 */
export function makeWalkRaw(nodes, edges) {
  const q = 1e5;
  const qLat = nodes.map(n => Math.round(n[0] * q));
  const qLon = nodes.map(n => Math.round(n[1] * q));
  const sorted = edges.map(([a, b, len]) => (a < b ? [a, b, len] : [b, a, len])).sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
  return {
    version: 1,
    quant: q,
    nodes: {
      dLat: qLat.map((v, i) => (i ? v - qLat[i - 1] : v)),
      dLon: qLon.map((v, i) => (i ? v - qLon[i - 1] : v)),
    },
    edges: {
      a: sorted.map((e, i) => (i ? e[0] - sorted[i - 1][0] : e[0])),
      b: sorted.map(e => e[1] - e[0]),
      len: sorted.map(e => e[2]),
    },
  };
}

/**
 * Wyrocznia: najwcześniejszy dojazd do każdego przystanku przez relaksację
 * do punktu stałego (Bellman-Ford po kursach), z tą samą semantyką co RAPTOR:
 *   - etykieta przystanku = najlepszy czas + sposób dotarcia (access/ride/foot),
 *   - bufor przy wsiadaniu tylko po dojeździe pojazdem,
 *   - przejścia piesze tylko z przystanków osiągniętych pojazdem,
 *   - tryb ostrożny: mnożnik czasu jazdy od miejsca wsiadania, przejścia ≥ 240 s.
 * Nie ma limitu przesiadek — sieci testowe muszą być na tyle małe, żeby
 * optimum mieściło się w 4 przesiadkach RAPTOR-a.
 * @param {object} g  sieć (z decodeNetwork) — dla kierunku „do" podaj g.reversed
 * @param {number[]} sources  spłaszczone pary [stop, accessSec, ...]
 */
export function oracleEarliest(g, sources, t0, walk, cautious = false, horizonSec = 180 * 60) {
  const INF = Infinity;
  const ACCESS = 1, RIDE = 2, FOOT = 3;
  const n = g.nStops;
  const best = new Float64Array(n).fill(INF);
  const by = new Uint8Array(n);
  const cap = t0 + horizonSec;
  const buffer = cautious ? 240 : 60;
  const factor = { 3: 1.15, 700: 1.15, 800: 1.15, 11: 1.15, 0: 1.05, 900: 1.05, 1: 1.02, 2: 1.02 };
  const footAdj = walk ? g.transferAdj : g.sameGroupAdj;

  for (let i = 0; i < sources.length; i += 2) {
    const s = sources[i], t = t0 + sources[i + 1];
    if (t < best[s]) { best[s] = t; by[s] = ACCESS; }
  }
  for (let iter = 0; iter < 1000; iter++) {
    let changed = false;
    for (const p of g.patterns) {
      const fac = cautious ? (factor[g.routes[p.route].t] ?? 1.1) : 1;
      for (let tr = 0; tr < p.nTrips; tr++) {
        const start = p.tripStart[tr];
        const cum = p.profCum[p.tripProf[tr]], arr = p.profArr[p.tripProf[tr]];
        // wszystkie pozycje, gdzie dało się wsiąść do tego kursu: w trybie
        // ostrożnym margines rośnie z długością przejazdu, więc późniejsze
        // wsiadanie do TEGO SAMEGO kursu może dać wcześniejszy „ostrożny" przyjazd
        const boards = [];
        for (let pos = 0; pos < p.stops.length; pos++) {
          const stop = p.stops[pos];
          const fl = p.flags ? p.flags[pos] : 0;
          if (boards.length && !(fl & 2)) {
            let arrT = Infinity;
            for (const bp of boards) {
              let a = start + arr[pos];
              if (cautious) a += Math.round((arr[pos] - cum[bp]) * (fac - 1));
              if (a < arrT) arrT = a;
            }
            if (arrT < best[stop] && arrT <= cap) { best[stop] = arrT; by[stop] = RIDE; changed = true; }
          }
          if (!(fl & 1) && best[stop] < INF) {
            const ready = best[stop] + (by[stop] === RIDE ? buffer : 0);
            if (start + cum[pos] >= ready) boards.push(pos);
          }
        }
      }
    }
    for (let s = 0; s < n; s++) {
      if (by[s] !== RIDE) continue;
      const adj = footAdj[s];
      for (let k = 0; k < adj.length; k += 2) {
        const sec = cautious ? Math.max(adj[k + 1], 240) : adj[k + 1];
        const to = adj[k], t = best[s] + sec;
        if (t < best[to] && t <= cap) { best[to] = t; by[to] = FOOT; changed = true; }
      }
    }
    if (!changed) break;
  }
  const seconds = new Float64Array(n);
  for (let i = 0; i < n; i++) seconds[i] = best[i] === INF ? INF : best[i] - t0;
  return seconds;
}

/**
 * Losowa mała sieć: przystanki na siatce ~500 m, kilka linii o losowych
 * przebiegach, kursy bez wyprzedzania (jeden profil na wzorzec), przesiadki
 * piesze między przystankami bliżej niż 500 m.
 */
export function randomNetSpec(rand, { nStops = 9, nRoutes = 3 } = {}) {
  const stops = [];
  for (let i = 0; i < nStops; i++) {
    stops.push({ name: `S${i}`, lat: 50 + Math.floor(i / 3) * 0.0045 + rand() * 0.001, lon: 20 + (i % 3) * 0.007 + rand() * 0.001 });
  }
  const routes = [], patterns = [];
  const types = [3, 0, 2];
  for (let r = 0; r < nRoutes; r++) {
    routes.push({ n: `L${r}`, t: types[r % types.length] });
    const len = 3 + Math.floor(rand() * 3);
    const seq = [];
    while (seq.length < len) { const s = Math.floor(rand() * nStops); if (!seq.includes(s)) seq.push(s); }
    const deltas = seq.slice(1).map(() => 120 + Math.floor(rand() * 6) * 60);
    const headway = 300 + Math.floor(rand() * 4) * 300;
    const first = 7 * 3600 + Math.floor(rand() * 10) * 60;
    patterns.push({ r, s: seq, p: [deltas], t: everyN(first, first + 3 * 3600, headway) });
    // kierunek powrotny jako osobny wzorzec tej samej linii
    patterns.push({ r, s: seq.slice().reverse(), p: [deltas.slice().reverse()], t: everyN(first + 150, first + 150 + 3 * 3600, headway) });
  }
  const transfers = [];
  for (let a = 0; a < nStops; a++) {
    for (let b = a + 1; b < nStops; b++) {
      const dy = (stops[b].lat - stops[a].lat) * 111320, dx = (stops[b].lon - stops[a].lon) * 111320 * Math.cos(50 * Math.PI / 180);
      const d = Math.hypot(dx, dy);
      if (d <= 500) transfers.push([a, b, Math.round(d / 0.96)]);
    }
  }
  return { stops, routes, patterns, transfers };
}
