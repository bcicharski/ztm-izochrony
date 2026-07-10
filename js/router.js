/**
 * Silnik wyznaczania osiągalności:
 *  - tryb "o godzinie": RAPTOR (uwzględnia rozkład i oczekiwanie na przesiadki),
 *  - tryb "ogólny": Dijkstra po minimalnych czasach przejazdu (bez oczekiwania).
 * Kierunek "do miejsca" realizowany na sieci odwróconej (net.reversed).
 * Oprócz czasów zwraca wskaźniki rodziców, z których można odtworzyć trasę.
 */

import { WALK_MPS, MIN_TRANSFER_S, REV_C, distM } from './data.js';

const MAX_ROUNDS = 5;          // maks. 4 przesiadki
const HORIZON_S = 180 * 60;    // ogranicznik wyszukiwania (3 h)
const NEAREST_EXTRA_M = 150;   // tryb bez spaceru: przystanki tuż obok najbliższego zespołu

// Tryb ostrożny: heurystyczny margines na opóźnienia (do czasu zebrania
// rzeczywistych profili opóźnień). Bufor przesiadkowy rośnie z 1 do 4 minut,
// a czasy jazdy są wydłużane zależnie od podatności środka transportu na korki.
const CAUTIOUS_TRANSFER_S = 240;
const CAUTIOUS_RIDE_FACTOR = {
  3: 1.15, 700: 1.15, 800: 1.15, 11: 1.15, // autobusy i trolejbusy
  0: 1.05, 900: 1.05,                       // tramwaje
  1: 1.02, 2: 1.02,                         // metro i kolej
};
const rideFactor = t => CAUTIOUS_RIDE_FACTOR[t] ?? 1.1;

/** Typowe (percentyl) opóźnienie linii dla danego typu dnia i godziny [s] albo null. */
function delayLookup(delays, routeName, dayType, boardDepSec) {
  if (!delays) return null;
  const hour = Math.floor(boardDepSec / 3600) % 24;
  const v = delays[`${routeName}|${dayType}|${hour}`];
  return v == null ? null : v;
}

// rodzaje rodzica w rekonstrukcji trasy
const P_NONE = 0, P_ACCESS = 1, P_RIDE = 2, P_FOOT = 3;

/**
 * Główne wejście.
 * @param {object} net  sieć z data.js (loadDay)
 * @param {object} opts {lat, lon, direction:'from'|'to', walk:bool, mode:'general'|'time',
 *                       timeMin, types?:Set<number> (dozwolone route_type; brak = wszystkie),
 *                       cautious?:bool (margines na opóźnienia),
 *                       delays?:object (profile opóźnień linii), dayType?:0|1|2}
 * @returns {{minutes: Float64Array, journeyTo: (stop:number)=>Array|null}}
 */
export function computeReachability(net, opts) {
  const g = opts.direction === 'to' ? net.reversed : net;
  const sources = findAccessStops(g, opts.lat, opts.lon, opts.walk);
  if (sources.length === 0) {
    return { minutes: new Float64Array(g.nStops).fill(Infinity), journeyTo: () => null };
  }

  // profile opóźnień: tylko tryb godzinowy „z miejsca" (w kierunku „do" oś
  // czasu jest odwrócona i godzina wsiadania nie odpowiada kluczowi profilu)
  const delays = (opts.cautious && opts.direction === 'from') ? opts.delays : null;

  let run, t0 = 0;
  if (opts.mode === 'time') {
    t0 = opts.timeMin * 60;
    if (opts.direction === 'to') t0 = REV_C - t0;
    run = raptor(g, sources, t0, opts.walk, opts.types, opts.cautious, delays, opts.dayType);
    // pora nocna: kursy "po północy" zapisane są jako 24:00+ dnia poprzedniego
    if (opts.timeMin < 300) {
      const t0b = opts.direction === 'to' ? REV_C - (opts.timeMin + 1440) * 60 : t0 + 86400;
      const second = raptor(g, sources, t0b, opts.walk, opts.types, opts.cautious, delays, opts.dayType);
      // scal: dla każdego przystanku wygrywa szybszy przebieg
      for (let i = 0; i < run.seconds.length; i++) {
        if (second.seconds[i] < run.seconds[i]) {
          run.seconds[i] = second.seconds[i];
          run.fromSecond ??= new Uint8Array(run.seconds.length);
          run.fromSecond[i] = 1;
        }
      }
      run.second = second;
    }
  } else {
    run = dijkstra(g, sources, opts.walk, opts.types, opts.cautious);
  }

  const minutes = new Float64Array(g.nStops);
  for (let i = 0; i < g.nStops; i++) minutes[i] = run.seconds[i] / 60;

  const journeyTo = stop => {
    if (!Number.isFinite(minutes[stop])) return null;
    const src = run.fromSecond?.[stop] ? run.second : run;
    return buildJourney(g, src, stop, opts);
  };

  return { minutes, journeyTo };
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

function newParents(n) {
  return {
    kind: new Uint8Array(n),
    stop: new Int32Array(n),
    route: new Int32Array(n),
    dep: new Int32Array(n),   // ride: odjazd z przystanku wsiadania; foot/access: czas przejścia [s]
    arr: new Int32Array(n),   // czas dotarcia do przystanku w chwili ustawienia rodzica
  };
}

// --- RAPTOR -----------------------------------------------------------------

function raptor(g, sources, t0, walk, types, cautious, delays, dayType) {
  const n = g.nStops;
  const INF = Infinity;
  const best = new Float64Array(n).fill(INF);      // najlepszy znany czas przyjazdu
  const arrPrev = new Float64Array(n).fill(INF);   // przyjazdy z poprzedniej rundy
  const par = newParents(n);
  const cap = t0 + HORIZON_S;

  let marked = [];
  const isMarked = new Uint8Array(n);
  const mark = s => { if (!isMarked[s]) { isMarked[s] = 1; marked.push(s); } };

  for (let i = 0; i < sources.length; i += 2) {
    const s = sources[i], t = t0 + sources[i + 1];
    if (t < best[s]) {
      best[s] = t;
      arrPrev[s] = t;
      par.kind[s] = P_ACCESS;
      par.dep[s] = sources[i + 1];
      par.arr[s] = t;
      mark(s);
    }
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
        if (types && !types.has(g.routes[g.patterns[p].route].t)) continue;
        if (qPattern[p] === -1) { qPattern[p] = pos; qList.push(p); }
        else if (pos < qPattern[p]) qPattern[p] = pos;
      }
    }
    for (const s of marked) isMarked[s] = 0;
    marked = [];

    // 2. skan wzorców
    const buffer = round > 1 ? (cautious ? CAUTIOUS_TRANSFER_S : MIN_TRANSFER_S) : 0;
    for (const pi of qList) {
      const p = g.patterns[pi];
      const startPos = qPattern[pi];
      qPattern[pi] = -1;
      const nStops = p.stops.length;
      // margines na opóźnienia: realny profil linii (percentyl) tam, gdzie jest
      // dość danych, inaczej heurystyczny mnożnik czasu jazdy wg typu pojazdu
      const routeName = g.routes[p.route].n;
      const fac = cautious ? rideFactor(g.routes[p.route].t) : 1;
      let trip = -1, tripCum = null, tripStartT = 0, boardStop = -1, boardDep = 0, boardPos = 0;
      for (let pos = startPos; pos < nStops; pos++) {
        const stop = p.stops[pos];
        const fl = p.flags ? p.flags[pos] : 0;
        // wysiądź, jeśli poprawia wynik
        if (trip >= 0 && !(fl & 2)) {
          let arrT = tripStartT + tripCum[pos];
          if (cautious) {
            const d = delayLookup(delays, routeName, dayType, boardDep);
            arrT += d != null ? d : Math.round((tripCum[pos] - tripCum[boardPos]) * (fac - 1));
          }
          if (arrT < best[stop] && arrT <= cap) {
            best[stop] = arrT;
            par.kind[stop] = P_RIDE;
            par.stop[stop] = boardStop;
            par.route[stop] = p.route;
            par.dep[stop] = boardDep;
            par.arr[stop] = arrT;
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
                boardStop = stop;
                boardDep = dep;
                boardPos = pos;
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
        const sec = cautious ? Math.max(adj[k + 1], CAUTIOUS_TRANSFER_S) : adj[k + 1];
        const to = adj[k], t = best[s] + sec;
        if (t < best[to] && t <= cap) {
          best[to] = t;
          par.kind[to] = P_FOOT;
          par.stop[to] = s;
          par.dep[to] = sec;
          par.arr[to] = t;
          mark(to);
        }
      }
    }

    // 4. przygotuj następną rundę
    arrPrev.set(best);
  }

  const seconds = new Float64Array(n);
  for (let i = 0; i < n; i++) seconds[i] = best[i] === INF ? INF : best[i] - t0;
  return { seconds, par, t0, timed: true };
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

// --- Dijkstra (tryb ogólny) ---------------------------------------------------

/**
 * Krawędzie przejazdowe: minimalny czas między kolejnymi przystankami wzorca,
 * z zachowaniem linii, która ten czas osiąga. Cache per zestaw dozwolonych typów.
 */
function rideAdjacency(g, types, cautious) {
  const key = (cautious ? 'c|' : 'n|') + (types ? [...types].sort().join(',') : 'all');
  g.rideAdjCache ??= new Map();
  if (g.rideAdjCache.has(key)) return g.rideAdjCache.get(key);

  const minEdge = new Map(); // klucz u*100000+v -> [w, routeIdx]
  for (const p of g.patterns) {
    if (types && !types.has(g.routes[p.route].t)) continue;
    const fac = cautious ? rideFactor(g.routes[p.route].t) : 1;
    for (let pos = 0; pos + 1 < p.stops.length; pos++) {
      const u = p.stops[pos], v = p.stops[pos + 1];
      if (u === v) continue;
      let w = Infinity;
      for (const cum of p.profCum) w = Math.min(w, cum[pos + 1] - cum[pos]);
      w = Math.round(w * fac);
      const k = u * 100000 + v;
      const cur = minEdge.get(k);
      if (cur === undefined || w < cur[0]) minEdge.set(k, [w, p.route]);
    }
  }
  const adj = Array.from({ length: g.nStops }, () => []);
  for (const [k, [w, route]] of minEdge) {
    const u = Math.floor(k / 100000), v = k % 100000;
    adj[u].push(v, w, route);
  }
  g.rideAdjCache.set(key, adj);
  return adj;
}

function dijkstra(g, sources, walk, types, cautious) {
  const n = g.nStops;
  const rideAdj = rideAdjacency(g, types, cautious);
  const footAdj = walk ? g.transferAdj : g.sameGroupAdj;
  const dist = new Float64Array(n).fill(Infinity);
  const par = newParents(n);

  // prosty kopiec binarny [czas, węzeł]
  const heap = [];
  const push = (t, v) => {
    heap.push([t, v]);
    let i = heap.length - 1;
    while (i > 0) {
      const parI = (i - 1) >> 1;
      if (heap[parI][0] <= heap[i][0]) break;
      [heap[parI], heap[i]] = [heap[i], heap[parI]];
      i = parI;
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
    if (t < dist[s]) {
      dist[s] = t;
      par.kind[s] = P_ACCESS;
      par.dep[s] = t;
      par.arr[s] = t;
      push(t, s);
    }
  }

  while (heap.length) {
    const [t, u] = pop();
    if (t > dist[u] || t > HORIZON_S) continue;
    const ra = rideAdj[u];
    for (let k = 0; k < ra.length; k += 3) {
      const v = ra[k], nt = t + ra[k + 1];
      if (nt < dist[v]) {
        dist[v] = nt;
        par.kind[v] = P_RIDE;
        par.stop[v] = u;
        par.route[v] = ra[k + 2];
        par.dep[v] = ra[k + 1]; // w trybie ogólnym: czas odcinka
        par.arr[v] = nt;
        push(nt, v);
      }
    }
    const fa = footAdj[u];
    for (let k = 0; k < fa.length; k += 2) {
      const sec = cautious ? Math.max(fa[k + 1], CAUTIOUS_TRANSFER_S) : fa[k + 1];
      const v = fa[k], nt = t + sec;
      if (nt < dist[v]) {
        dist[v] = nt;
        par.kind[v] = P_FOOT;
        par.stop[v] = u;
        par.dep[v] = sec;
        par.arr[v] = nt;
        push(nt, v);
      }
    }
  }
  return { seconds: dist, par, t0: 0, timed: false };
}

// --- rekonstrukcja trasy --------------------------------------------------------

/**
 * Odtwarza trasę do danego przystanku z łańcucha rodziców.
 * Zwraca listę etapów w rzeczywistej kolejności podróży:
 *   {kind:'access'|'walk', fromStop?, toStop?, durSec}
 *   {kind:'ride', fromStop, toStop, route, depSec?, arrSec?, durSec}
 * Czasy depSec/arrSec (sekundy doby) tylko w trybie "o godzinie".
 */
function buildJourney(g, run, target, opts) {
  const { par, timed } = run;
  const reversedNet = opts.direction === 'to';
  const raw = []; // etapy od celu wstecz do źródła
  let cur = target;
  for (let guard = 0; guard < 100; guard++) {
    const kind = par.kind[cur];
    if (kind === P_NONE) return null;
    if (kind === P_ACCESS) {
      raw.push({ kind: 'access', stop: cur, durSec: par.dep[cur] });
      break;
    }
    const prev = par.stop[cur];
    if (kind === P_RIDE) {
      raw.push({
        kind: 'ride', a: prev, b: cur, route: g.routes[par.route[cur]],
        depAbs: timed ? par.dep[cur] : null,
        arrAbs: timed ? par.arr[cur] : null,
        durSec: timed ? par.arr[cur] - par.dep[cur] : par.dep[cur],
      });
    } else { // P_FOOT
      raw.push({ kind: 'walk', a: prev, b: cur, durSec: par.dep[cur] });
    }
    cur = prev;
  }
  if (raw[raw.length - 1]?.kind !== 'access') return null;

  // normalizacja czasów sieci odwróconej: t_real = REV_C − t', zamiana ról a/b
  const toReal = t => reversedNet ? REV_C - t : t;
  const legs = [];
  for (const leg of raw) {
    if (leg.kind === 'access') {
      legs.push({ kind: 'access', stop: leg.stop, durSec: leg.durSec });
    } else if (leg.kind === 'ride') {
      legs.push({
        kind: 'ride',
        fromStop: reversedNet ? leg.b : leg.a,
        toStop: reversedNet ? leg.a : leg.b,
        route: leg.route,
        depSec: leg.depAbs == null ? null : toReal(reversedNet ? leg.arrAbs : leg.depAbs),
        arrSec: leg.arrAbs == null ? null : toReal(reversedNet ? leg.depAbs : leg.arrAbs),
        durSec: leg.durSec,
      });
    } else {
      legs.push({
        kind: 'walk',
        fromStop: reversedNet ? leg.b : leg.a,
        toStop: reversedNet ? leg.a : leg.b,
        durSec: leg.durSec,
      });
    }
  }
  // 'from': łańcuch był od celu wstecz → odwróć; 'to': kolejność już rzeczywista,
  // ale etap 'access' (dojście do punktu użytkownika) ma trafić na koniec
  if (!reversedNet) legs.reverse();
  else legs.push(...legs.splice(legs.findIndex(l => l.kind === 'access'), 1));

  // tryb ogólny: sklej sąsiednie odcinki tej samej linii w jeden etap
  if (!timed) {
    const merged = [];
    for (const leg of legs) {
      const last = merged[merged.length - 1];
      if (leg.kind === 'ride' && last?.kind === 'ride' && last.route === leg.route &&
          last.toStop === leg.fromStop) {
        last.toStop = leg.toStop;
        last.durSec += leg.durSec;
      } else if (leg.kind === 'walk' && last?.kind === 'walk' && last.toStop === leg.fromStop) {
        last.toStop = leg.toStop;
        last.durSec += leg.durSec;
      } else {
        merged.push({ ...leg });
      }
    }
    return merged;
  }
  return legs;
}
