/**
 * Silnik wyznaczania osiągalności:
 *  - tryb "o godzinie": RAPTOR (uwzględnia rozkład i oczekiwanie na przesiadki),
 *  - tryb "ogólny": Dijkstra po minimalnych czasach przejazdu (bez oczekiwania).
 * Kierunek "do miejsca" realizowany na sieci odwróconej (net.reversed).
 */

import { WALK_MPS, MIN_TRANSFER_S, REV_C, distM } from './data.js';

const MAX_ROUNDS = 5;          // maks. 4 przesiadki
const HORIZON_S = 180 * 60;    // ogranicznik wyszukiwania (3 h)
const NEAREST_EXTRA_M = 150;   // tryb bez spaceru: przystanki tuż obok najbliższego zespołu

/**
 * Główne wejście.
 * @param {object} net  sieć z data.js (loadDay)
 * @param {object} opts {lat, lon, direction:'from'|'to', walk:bool, mode:'general'|'time', timeMin}
 * @returns {{minutes: Float64Array, sources: number[]}} czas całkowity [min] do/z każdego przystanku
 */
export function computeReachability(net, opts) {
  const g = opts.direction === 'to' ? net.reversed : net;
  const sources = findAccessStops(g, opts.lat, opts.lon, opts.walk);
  if (sources.length === 0) return { minutes: new Float64Array(g.nStops).fill(Infinity), sources: [] };

  let seconds;
  if (opts.mode === 'time') {
    let t0 = opts.timeMin * 60;
    if (opts.direction === 'to') t0 = REV_C - t0;
    seconds = raptor(g, sources, t0, opts.walk);
    // pora nocna: kursy "po północy" zapisane są jako 24:00+ dnia poprzedniego
    if (opts.timeMin < 300) {
      const t0b = opts.direction === 'to' ? REV_C - (opts.timeMin + 1440) * 60 : t0 + 86400;
      const second = raptor(g, sources, t0b, opts.walk);
      for (let i = 0; i < seconds.length; i++) seconds[i] = Math.min(seconds[i], second[i]);
    }
  } else {
    seconds = dijkstra(g, sources, opts.walk);
  }

  const minutes = new Float64Array(g.nStops);
  for (let i = 0; i < g.nStops; i++) minutes[i] = seconds[i] / 60;
  return { minutes, sources: sources.filter((_, i) => i % 2 === 0) };
}

/**
 * Przystanki startowe jako spłaszczone pary [stopIdx, accessSec, ...].
 * Spacer wł.: wszystkie przystanki w zasięgu pieszym; wył.: najbliższy zespół (dojście = 0).
 */
export function findAccessStops(g, lat, lon, walk) {
  const out = [];
  if (walk) {
    const maxDist = HORIZON_S * WALK_MPS; // i tak przycięte horyzontem
    for (let i = 0; i < g.nStops; i++) {
      const d = distM(lat, lon, g.lat[i], g.lon[i]);
      if (d <= maxDist) out.push(i, Math.round(d / WALK_MPS));
    }
  } else {
    let nearest = -1, nearestD = Infinity;
    for (let i = 0; i < g.nStops; i++) {
      const d = distM(lat, lon, g.lat[i], g.lon[i]);
      if (d < nearestD) { nearestD = d; nearest = i; }
    }
    if (nearest < 0) return out;
    const grp = g.group[nearest];
    for (let i = 0; i < g.nStops; i++) {
      if (g.group[i] === grp || distM(g.lat[nearest], g.lon[nearest], g.lat[i], g.lon[i]) <= NEAREST_EXTRA_M) {
        out.push(i, 0);
      }
    }
  }
  return out;
}

// --- RAPTOR -----------------------------------------------------------------

function raptor(g, sources, t0, walk) {
  const n = g.nStops;
  const INF = Infinity;
  const best = new Float64Array(n).fill(INF);      // najlepszy znany czas przyjazdu
  const arrPrev = new Float64Array(n).fill(INF);   // przyjazdy z poprzedniej rundy
  const cap = t0 + HORIZON_S;

  let marked = [];
  const isMarked = new Uint8Array(n);
  const mark = s => { if (!isMarked[s]) { isMarked[s] = 1; marked.push(s); } };

  for (let i = 0; i < sources.length; i += 2) {
    const s = sources[i], t = t0 + sources[i + 1];
    if (t < best[s]) { best[s] = t; arrPrev[s] = t; mark(s); }
  }

  const footAdj = walk ? g.transferAdj : g.sameGroupAdj;
  const qPattern = new Int32Array(g.patterns.length).fill(-1); // najwcześniejsza pozycja wejścia

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // 1. wzorce obsługujące oznaczone przystanki
    const qList = [];
    for (const s of marked) {
      const pas = g.patternsAtStop[s];
      for (let k = 0; k < pas.length; k += 2) {
        const p = pas[k], pos = pas[k + 1];
        if (qPattern[p] === -1) { qPattern[p] = pos; qList.push(p); }
        else if (pos < qPattern[p]) qPattern[p] = pos;
      }
    }
    for (const s of marked) isMarked[s] = 0;
    marked = [];

    // 2. skan wzorców
    const buffer = round > 1 ? MIN_TRANSFER_S : 0;
    for (const pi of qList) {
      const p = g.patterns[pi];
      const startPos = qPattern[pi];
      qPattern[pi] = -1;
      const nStops = p.stops.length;
      let trip = -1, tripCum = null, tripStartT = 0;
      for (let pos = startPos; pos < nStops; pos++) {
        const stop = p.stops[pos];
        const fl = p.flags ? p.flags[pos] : 0;
        // wysiądź, jeśli poprawia wynik
        if (trip >= 0 && !(fl & 2)) {
          const arrT = tripStartT + tripCum[pos];
          if (arrT < best[stop] && arrT <= cap) {
            best[stop] = arrT;
            mark(stop);
          }
        }
        // spróbuj złapać wcześniejszy kurs
        if (!(fl & 1) && arrPrev[stop] < INF) {
          const ready = arrPrev[stop] + buffer;
          const currentDep = trip >= 0 ? tripStartT + tripCum[pos] : Infinity;
          if (ready < currentDep) {
            const t = earliestTrip(p, pos, ready);
            if (t >= 0) {
              const dep = p.depAt[pos * p.nTrips + t];
              if (dep < currentDep) {
                trip = t;
                tripCum = p.profCum[p.tripProf[t]];
                tripStartT = p.tripStart[t];
              }
            }
          }
        }
      }
    }

    if (marked.length === 0) break;

    // 3. przejścia piesze z nowo osiągniętych przystanków
    const newlyByRide = marked.slice();
    for (const s of newlyByRide) {
      const adj = footAdj[s];
      for (let k = 0; k < adj.length; k += 2) {
        const to = adj[k], t = best[s] + adj[k + 1];
        if (t < best[to] && t <= cap) { best[to] = t; mark(to); }
      }
    }

    // 4. przygotuj następną rundę
    arrPrev.set(best);
  }

  return subtract(best, t0);
}

/** Najwcześniejszy kurs wzorca z odjazdem z pozycji pos o czasie ≥ ready. */
function earliestTrip(p, pos, ready) {
  const base = pos * p.nTrips;
  let lo = 0, hi = p.nTrips - 1, ans = -1;
  // odjazdy z danej pozycji są (w praktyce) posortowane rosnąco po kursach
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (p.depAt[base + mid] >= ready) { ans = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  return ans;
}

function subtract(best, t0) {
  const out = new Float64Array(best.length);
  for (let i = 0; i < best.length; i++) out[i] = best[i] === Infinity ? Infinity : best[i] - t0;
  return out;
}

// --- Dijkstra (tryb ogólny) ---------------------------------------------------

/** Krawędzie przejazdowe: minimalny czas między kolejnymi przystankami wzorca. */
function rideAdjacency(g) {
  if (g.rideAdjCache) return g.rideAdjCache;
  const minEdge = new Map(); // klucz u*100000+v
  for (const p of g.patterns) {
    for (let pos = 0; pos + 1 < p.stops.length; pos++) {
      const u = p.stops[pos], v = p.stops[pos + 1];
      if (u === v) continue;
      let w = Infinity;
      for (const cum of p.profCum) w = Math.min(w, cum[pos + 1] - cum[pos]);
      const key = u * 100000 + v;
      const cur = minEdge.get(key);
      if (cur === undefined || w < cur) minEdge.set(key, w);
    }
  }
  const adj = Array.from({ length: g.nStops }, () => []);
  for (const [key, w] of minEdge) {
    const u = Math.floor(key / 100000), v = key % 100000;
    adj[u].push(v, w);
  }
  g.rideAdjCache = adj;
  return adj;
}

function dijkstra(g, sources, walk) {
  const n = g.nStops;
  const rideAdj = rideAdjacency(g);
  const footAdj = walk ? g.transferAdj : g.sameGroupAdj;
  const dist = new Float64Array(n).fill(Infinity);

  // prosty kopiec binarny [czas, węzeł]
  const heap = [];
  const push = (t, v) => {
    heap.push([t, v]);
    let i = heap.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (heap[par][0] <= heap[i][0]) break;
      [heap[par], heap[i]] = [heap[i], heap[par]];
      i = par;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  for (let i = 0; i < sources.length; i += 2) {
    const s = sources[i], t = sources[i + 1];
    if (t < dist[s]) { dist[s] = t; push(t, s); }
  }

  while (heap.length) {
    const [t, u] = pop();
    if (t > dist[u] || t > HORIZON_S) continue;
    const ra = rideAdj[u];
    for (let k = 0; k < ra.length; k += 2) {
      const v = ra[k], nt = t + ra[k + 1];
      if (nt < dist[v]) { dist[v] = nt; push(nt, v); }
    }
    const fa = footAdj[u];
    for (let k = 0; k < fa.length; k += 2) {
      const v = fa[k], nt = t + fa[k + 1];
      if (nt < dist[v]) { dist[v] = nt; push(nt, v); }
    }
  }
  return dist;
}
