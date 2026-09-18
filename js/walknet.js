/**
 * Routing pieszy po sieci dróg z OSM (data/<miasto>/walknet.json).
 *
 * Zastępuje falę po rastrze lądu tam, gdzie sieć jest dostępna. Raster znał
 * wyłącznie wodę, więc w głębi lądu izochrona degenerowała się do koła
 * (zmierzony współczynnik nadłożenia drogi ≈ 1,05); tutaj czas biegnie po
 * realnych ulicach, chodnikach i ścieżkach.
 *
 * Podział ról: graf liczy CZAS w węzłach, a raster (js/walkgrid.js) służy
 * dalej jako maska wody i płótno do rysowania — czasy z krawędzi są na niego
 * nanoszone, a potem rozlewane na ograniczoną odległość od sieci
 * (`SPREAD_M`), żeby strefa była obszarem, a nie pajęczyną linii.
 */

import { M_PER_DEG_LAT } from './data.js';

/** Prędkość marszu po sieci [m/s] — 4,5 km/h. Bez współczynnika krętości:
 *  długość trasy bierze się teraz z geometrii ulic, a nie z linii prostej. */
export const NET_WALK_MPS = 4.5 / 3.6;

/** Prędkość roweru po sieci [m/s] — 15 km/h. Ta sama sieć co pieszo: graf nie
 *  ma tagów krawędzi, więc nie odróżnia schodów ani deptaków (patrz README). */
export const NET_BIKE_MPS = 15 / 3.6;

/** Jak daleko od sieci kolorujemy teren [m] — mniej więcej pół kwartału. */
export const SPREAD_M = 75;

/** Maksymalna odległość przyłączenia punktu/przystanku do sieci (rzut na krawędź) [m]. */
export const SNAP_MAX_M = 400;

/** Bok kubełka indeksu przestrzennego [m]. */
const CELL_M = 250;

/**
 * Dekoduje zapis różnicowy do struktur routingu (CSR).
 * @param {object} raw zawartość walknet.json
 * @returns {object} sieć gotowa do `computeNodeTimes`
 */
export function decodeWalkNet(raw) {
  const q = raw.quant || 1e5;
  const { dLat, dLon } = raw.nodes;
  const n = dLat.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  let aLat = 0, aLon = 0;
  for (let i = 0; i < n; i++) {
    aLat += dLat[i]; aLon += dLon[i];
    lat[i] = aLat / q; lon[i] = aLon / q;
  }

  // krawędzie: a zapisane różnicowo, b względem a
  const { a: eA, b: eB, len: eLen } = raw.edges;
  const m = eA.length;
  const from = new Int32Array(m);
  const to = new Int32Array(m);
  let acc = 0;
  for (let i = 0; i < m; i++) {
    acc += eA[i];
    from[i] = acc;
    to[i] = acc + eB[i];
  }

  // lista sąsiedztwa w formacie CSR (obie strony każdej krawędzi)
  const deg = new Int32Array(n + 1);
  for (let i = 0; i < m; i++) { deg[from[i]]++; deg[to[i]]++; }
  const off = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg[i];
  const cursor = off.slice(0, n);
  const adjTo = new Int32Array(m * 2);
  // długości w METRACH, nie w sekundach — tempo (pieszo/rower) wybiera dopiero
  // `computeNodeTimes`, a ta sama sieć obsługuje oba w jednym przeliczeniu
  const adjLen = new Int32Array(m * 2);
  for (let i = 0; i < m; i++) {
    adjTo[cursor[from[i]]] = to[i]; adjLen[cursor[from[i]]++] = eLen[i];
    adjTo[cursor[to[i]]] = from[i]; adjLen[cursor[to[i]]++] = eLen[i];
  }

  const net = { n, lat, lon, off, adjTo, adjLen, edgeFrom: from, edgeTo: to, edgeLen: eLen };
  net.main = mainComponent(net);
  buildIndex(net);
  buildEdgeIndex(net);
  return net;
}

/**
 * Znacznik przynależności do największej spójnej składowej.
 *
 * Sieć z OSM ma 2–3% węzłów w drobnych odpryskach: fragmenty odcięte granicą
 * bboxa, ścieżki bez połączenia z resztą, błędy danych. Przyłączenie punktu do
 * takiego odprysku daje izochronę z kilkunastu pikseli — zdarzyło się to
 * domyślnym punktom GZM (odprysk 7 węzłów, 19 m od punktu) i Bydgoszczy
 * (3 węzły, 22 m). `snapEdge` pomija krawędzie spoza tej składowej; węzły odprysków
 * zostają w danych, ale nikt się do nich nie przyłączy.
 * @returns {Uint8Array} 1 = węzeł w największej składowej
 */
function mainComponent(net) {
  const comp = new Int32Array(net.n).fill(-1);
  const queue = new Int32Array(net.n);
  let bestId = -1, bestSize = 0;
  for (let start = 0, id = 0; start < net.n; start++) {
    if (comp[start] >= 0) continue;
    let head = 0, tail = 0, size = 0;
    comp[start] = id; queue[tail++] = start;
    while (head < tail) {
      const u = queue[head++]; size++;
      for (let k = net.off[u]; k < net.off[u + 1]; k++) {
        const v = net.adjTo[k];
        if (comp[v] < 0) { comp[v] = id; queue[tail++] = v; }
      }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  const main = new Uint8Array(net.n);
  for (let i = 0; i < net.n; i++) main[i] = comp[i] === bestId ? 1 : 0;
  return main;
}

/** Indeks przestrzenny (kubełki CELL_M) do przyłączania punktów do sieci. */
function buildIndex(net) {
  let latS = 90, latN = -90, lonW = 180, lonE = -180;
  for (let i = 0; i < net.n; i++) {
    if (net.lat[i] < latS) latS = net.lat[i];
    if (net.lat[i] > latN) latN = net.lat[i];
    if (net.lon[i] < lonW) lonW = net.lon[i];
    if (net.lon[i] > lonE) lonE = net.lon[i];
  }
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(((latN + latS) / 2) * Math.PI / 180);
  const W = Math.max(1, Math.ceil((lonE - lonW) * mPerDegLon / CELL_M));
  const H = Math.max(1, Math.ceil((latN - latS) * M_PER_DEG_LAT / CELL_M));
  const cellOf = (lat, lon) => {
    const x = Math.min(W - 1, Math.max(0, Math.floor((lon - lonW) * mPerDegLon / CELL_M)));
    const y = Math.min(H - 1, Math.max(0, Math.floor((lat - latS) * M_PER_DEG_LAT / CELL_M)));
    return y * W + x;
  };
  const counts = new Int32Array(W * H + 1);
  for (let i = 0; i < net.n; i++) counts[cellOf(net.lat[i], net.lon[i])]++;
  const start = new Int32Array(W * H + 1);
  for (let i = 0; i < W * H; i++) start[i + 1] = start[i] + counts[i];
  const cursor = start.slice(0, W * H);
  const items = new Int32Array(net.n);
  for (let i = 0; i < net.n; i++) items[cursor[cellOf(net.lat[i], net.lon[i])]++] = i;
  net.index = { W, H, latS, lonW, mPerDegLon, start, items, cellOf };
}

/**
 * Indeks przestrzenny krawędzi: każda krawędź trafia do wszystkich kubełków
 * pokrytych bboxem swojej cięciwy (krawędzie grafu skontrahowanego to proste
 * odcinki między skrzyżowaniami — geometria pośrednia nie jest zapisywana;
 * zmierzone: długość realna/cięciwa mediana 1,008, p95 1,25).
 */
function buildEdgeIndex(net) {
  const ix = net.index;
  const m = net.edgeLen.length;
  const cellX = lon => Math.min(ix.W - 1, Math.max(0, Math.floor((lon - ix.lonW) * ix.mPerDegLon / CELL_M)));
  const cellY = lat => Math.min(ix.H - 1, Math.max(0, Math.floor((lat - ix.latS) * M_PER_DEG_LAT / CELL_M)));
  const counts = new Int32Array(ix.W * ix.H + 1);
  const forEachCell = (e, fn) => {
    const a = net.edgeFrom[e], b = net.edgeTo[e];
    const x0 = Math.min(cellX(net.lon[a]), cellX(net.lon[b])), x1 = Math.max(cellX(net.lon[a]), cellX(net.lon[b]));
    const y0 = Math.min(cellY(net.lat[a]), cellY(net.lat[b])), y1 = Math.max(cellY(net.lat[a]), cellY(net.lat[b]));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(y * ix.W + x);
  };
  for (let e = 0; e < m; e++) forEachCell(e, c => { counts[c]++; });
  const start = new Int32Array(ix.W * ix.H + 1);
  for (let i = 0; i < ix.W * ix.H; i++) start[i + 1] = start[i] + counts[i];
  const cursor = start.slice(0, ix.W * ix.H);
  const items = new Int32Array(start[ix.W * ix.H]);
  for (let e = 0; e < m; e++) forEachCell(e, c => { items[cursor[c]++] = e; });
  net.edgeIndex = { start, items };
}

/** Tolerancja doboru kandydatek: krawędzie nie dalej niż najbliższa + tyle metrów. */
export const SNAP_TOL_M = 25;
/** Maksymalna liczba kandydatek przyłączenia (najbliższe wg odległości od rzutu). */
const SNAP_MAX_CAND = 8;

/**
 * Przyłączenie punktu do sieci: rzut na KRAWĘDZIE (cięciwy), nie na najbliższy
 * węzeł. Graf jest skontrahowany — węzły to tylko skrzyżowania, a krawędź bywa
 * długa (p90 ≈ 170 m, p99 ≈ 600 m). Snap do węzła doliczał wtedy zmyślony
 * marsz do rogu ulicy (do kilku minut) albo w ogóle nie znajdował węzła
 * w `maxM`, choć ulica biegła tuż obok.
 *
 * Zwraca LISTĘ kandydatek: wszystkie krawędzie nie dalej niż najbliższa + `tolM`
 * (posortowane, maks. `SNAP_MAX_CAND`). Jedna „zwyciężczyni" myliła się tam,
 * gdzie równolegle biegną jezdnia i chodnik: punkt na chodniku 4 m od 800-m
 * cięciwy jezdni dostawał jezdnię (0 m) i 400 m marszu do jej końca, choć
 * chodnik miał skrzyżowanie tuż obok. Z listą decyduje Dijkstra — bierze
 * najszybszą drogę przez którąkolwiek kandydatkę.
 *
 * Pomija krawędzie spoza największej spójnej składowej (`mainComponent`).
 *
 * Wynik jest w METRACH i nie zależy od tempa — te same kandydatki obsługują
 * dojście pieszo i rowerem (sekundy liczą konsumenci przez `mps`).
 *
 * @returns {Array<{edge:number, a:number, b:number, t:number, perpM:number,
 *   mA:number, mB:number, lenM:number}>} pusta = poza siecią
 *   `t` — pozycja rzutu na krawędzi (0 = węzeł a, 1 = węzeł b);
 *   `perpM` — dojście z punktu do rzutu (linia prosta);
 *   `mA`/`mB` — droga wzdłuż krawędzi od rzutu do a / do b;
 *   `lenM` — długość całej krawędzi.
 */
export function snapEdges(net, lat, lon, maxM = SNAP_MAX_M, tolM = SNAP_TOL_M) {
  const ix = net.index, ex = net.edgeIndex;
  const kx = ix.mPerDegLon, ky = M_PER_DEG_LAT;
  const cx = Math.min(ix.W - 1, Math.max(0, Math.floor((lon - ix.lonW) * kx / CELL_M)));
  const cy = Math.min(ix.H - 1, Math.max(0, Math.floor((lat - ix.latS) * ky / CELL_M)));
  const maxRing = Math.ceil(maxM / CELL_M) + 1;
  const found = new Map(); // edge -> [d, t] (krawędź siedzi w kilku kubełkach — dedup)
  let bestD = Infinity;
  for (let r = 0; r <= maxRing; r++) {
    // krawędź jest w każdym kubełku swojego bboxa, więc wszystko, co leży
    // w pierścieniach ≤ r−1, zostało już obejrzane — dalsze nie poprawią
    if (bestD + tolM <= (r - 1) * CELL_M) break;
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= ix.H) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= ix.W) continue;
        if (r > 0 && Math.abs(y - cy) !== r && Math.abs(x - cx) !== r) continue; // tylko obrzeże
        const c = y * ix.W + x;
        for (let k = ex.start[c]; k < ex.start[c + 1]; k++) {
          const e = ex.items[k];
          if (found.has(e)) continue;
          const a = net.edgeFrom[e], b = net.edgeTo[e];
          if (!net.main[a]) continue; // odprysk — prowadziłby donikąd
          // rzut punktu na odcinek ab w metrach (rzut równokątny)
          const ax = (net.lon[a] - lon) * kx, ay = (net.lat[a] - lat) * ky;
          const bx = (net.lon[b] - lon) * kx, by = (net.lat[b] - lat) * ky;
          const dx = bx - ax, dy = by - ay;
          const len2 = dx * dx + dy * dy;
          const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
          const d = Math.hypot(ax + t * dx, ay + t * dy);
          if (d > maxM || d > bestD + tolM) continue;
          found.set(e, [d, t]);
          if (d < bestD) bestD = d;
        }
      }
    }
  }
  const out = [];
  for (const [e, [d, t]] of found) {
    if (d > bestD + tolM) continue;
    const lenM = net.edgeLen[e];
    out.push({
      edge: e, a: net.edgeFrom[e], b: net.edgeTo[e], t,
      perpM: d, mA: t * lenM, mB: (1 - t) * lenM, lenM,
    });
  }
  out.sort((p, q) => p.perpM - q.perpM);
  return out.length > SNAP_MAX_CAND ? out.slice(0, SNAP_MAX_CAND) : out;
}

/** Źródła fali dla `computeNodeTimes` z punktu przyłączonego do sieci (oba końce każdej kandydatki). */
export function snapSeeds(snaps, startSec, mps = NET_WALK_MPS) {
  const seeds = [];
  for (const s of snaps) {
    const base = startSec + s.perpM / mps;
    seeds.push([s.a, Math.round(base + s.mA / mps)], [s.b, Math.round(base + s.mB / mps)]);
  }
  return seeds;
}

/**
 * Czas dotarcia fali (`nodeTime`) do punktu przyłączonego do sieci — najkrótsza
 * z dróg przez końce którejkolwiek kandydatki + dojście z rzutu; −1 = brak.
 * Nie obejmuje przypadku „oba punkty na tej samej krawędzi" (patrz `sameEdgeSec`).
 */
export function snapTime(nodeTime, snaps, mps = NET_WALK_MPS) {
  let best = Infinity;
  for (const s of snaps) {
    let t = Infinity;
    if (nodeTime[s.a] >= 0) t = nodeTime[s.a] + s.mA / mps;
    if (nodeTime[s.b] >= 0) t = Math.min(t, nodeTime[s.b] + s.mB / mps);
    if (t + s.perpM / mps < best) best = t + s.perpM / mps;
  }
  return best === Infinity ? -1 : Math.round(best);
}

/**
 * Dwa punkty na TEJ SAMEJ krawędzi: marsz wprost wzdłuż niej, bez zahaczania
 * o skrzyżowanie (droga przez węzeł nigdy nie jest krótsza). Sprawdzane dla
 * każdej pary kandydatek. `Infinity`, gdy nie dzielą żadnej krawędzi.
 */
export function sameEdgeSec(snapsA, snapsB, mps = NET_WALK_MPS) {
  let best = Infinity;
  for (const s1 of snapsA) {
    for (const s2 of snapsB) {
      if (s1.edge !== s2.edge) continue;
      const sec = (s1.perpM + s2.perpM + Math.abs(s1.t - s2.t) * s1.lenM) / mps;
      if (sec < best) best = sec;
    }
  }
  return best === Infinity ? Infinity : Math.round(best);
}

/**
 * Multi-source Dijkstra po sieci, kolejka kubełkowa po sekundach.
 * @param {object} net    sieć z `decodeWalkNet`
 * @param {Array<[number, number]>} seeds  [indeksWęzła, sekundyStartu]
 * @param {number} capSec  horyzont [s]
 * @param {number} mps     tempo [m/s] — `NET_WALK_MPS` albo `NET_BIKE_MPS`
 * @returns {Int32Array} czas w każdym węźle (−1 = nieosiągalny)
 */
export function computeNodeTimes(net, seeds, capSec, mps = NET_WALK_MPS) {
  const time = new Int32Array(net.n).fill(-1);
  const buckets = new Array(capSec + 1);
  let pending = 0;
  const push = (node, t) => {
    if (t > capSec) return;
    const cur = time[node];
    if (cur >= 0 && cur <= t) return;
    time[node] = t;
    (buckets[t] ??= []).push(node);
    pending++;
  };
  for (const [node, sec] of seeds) {
    if (node >= 0 && node < net.n) push(node, Math.max(0, Math.min(sec, capSec)));
  }
  for (let t = 0; t <= capSec && pending > 0; t++) {
    const bucket = buckets[t];
    if (!bucket) continue;
    for (const node of bucket) {
      pending--;
      if (time[node] !== t) continue; // nieaktualny wpis
      for (let k = net.off[node]; k < net.off[node + 1]; k++) {
        push(net.adjTo[k], t + Math.max(1, Math.round(net.adjLen[k] / mps)));
      }
    }
    buckets[t] = undefined;
  }
  return time;
}

/**
 * Nanosi czasy z węzłów wprost na bufor czasu siatki: próbkuje każdą krawędź
 * gęściej niż piksel i wpisuje czas krótszy z dwóch dojść (od początku albo
 * od końca krawędzi). Bez próbkowania wnętrza długich krawędzi byłyby
 * nieosiągalne, choć realnie się po nich idzie.
 *
 * Pisze do `grid.time` zamiast zwracać listę źródeł, bo w dużym mieście
 * (GZM: 605 tys. krawędzi, 49 tys. km sieci) lista miałaby ponad 2 mln par —
 * sama jej budowa i przepchnięcie przez kolejkę kosztowały 6,4 s. Zapis do
 * gotowego bufora zbija to do kilkudziesięciu milisekund, bo wiele próbek
 * trafia w ten sam piksel i zwyczajnie się nadpisuje.
 *
 * Źródła leżące WEWNĄTRZ krawędzi (`edgeSeeds`: punkt użytkownika, przystanki —
 * przyłączone rzutem na krawędź, patrz `snapEdge`) dostają czas liczony wprost
 * od rzutu, nie przez końce krawędzi — inaczej otoczenie źródła malowało się
 * z czasem powiększonym o marsz do skrzyżowania i z powrotem.
 *
 * @param {object} net
 * @param {Int32Array} nodeTime  wynik `computeNodeTimes`
 * @param {object} grid          siatka z `buildWalkGrid`
 * @param {(grid:object, lat:number, lon:number)=>number} pixelIndex
 * @param {number} unreach       wartość „nieosiągalne" bufora (walkgrid.UNREACH)
 * @param {number} capSec        horyzont — dłuższych czasów nie ma sensu nanosić
 * @param {object} [opts]
 * @param {Map<number, Array<[number, number]>>|null} [opts.edgeSeeds]
 *        krawędź -> [[t (0..1), sekundy w punkcie rzutu], ...]
 * @param {number} [opts.mps]    tempo [m/s] tej fali
 * @param {boolean} [opts.reset] czy wyczyścić bufor przed malowaniem; `false`
 *        dokłada falę do już namalowanej (min per piksel) — tak łączy się
 *        dojazd rowerem od punktu z dojściem pieszo od przystanków
 */
export function paintNetwork(net, nodeTime, grid, pixelIndex, unreach, capSec, opts = {}) {
  const { edgeSeeds = null, mps = NET_WALK_MPS, reset = true } = opts;
  const time = grid.time;
  if (reset) time.fill(unreach);
  // krok próbkowania poniżej boku piksela, żeby kolejne próbki trafiały
  // w sąsiadujące komórki także po skosie
  const stepM = Math.max(8, grid.res * 0.7);
  const nEdges = net.edgeLen.length;
  for (let e = 0; e < nEdges; e++) {
    const a = net.edgeFrom[e], b = net.edgeTo[e];
    const ta = nodeTime[a], tb = nodeTime[b];
    const inner = edgeSeeds?.get(e) ?? null;
    if (ta < 0 && tb < 0 && !inner) continue;
    const len = net.edgeLen[e];
    const lenSec = len / mps;
    const latA = net.lat[a], lonA = net.lon[a];
    const dLat = net.lat[b] - latA, dLon = net.lon[b] - lonA;
    const steps = Math.max(1, Math.round(len / stepM));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const idx = pixelIndex(grid, latA + dLat * f, lonA + dLon * f);
      if (idx < 0) continue;
      // czas krótszy z dwóch kierunków dojścia wzdłuż krawędzi
      let t = Infinity;
      if (ta >= 0) t = ta + lenSec * f;
      if (tb >= 0) {
        const viaB = tb + lenSec * (1 - f);
        if (viaB < t) t = viaB;
      }
      if (inner) {
        for (const [ts, sec] of inner) {
          const direct = sec + Math.abs(f - ts) * lenSec;
          if (direct < t) t = direct;
        }
      }
      if (t > capSec) continue;
      const v = t | 0;
      if (v < time[idx]) time[idx] = v;
    }
  }
}
