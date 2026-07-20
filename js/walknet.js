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

/** Jak daleko od sieci kolorujemy teren [m] — mniej więcej pół kwartału. */
export const SPREAD_M = 75;

/** Maksymalna odległość przyłączenia punktu/przystanku do sieci [m]. */
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
  const adjSec = new Int32Array(m * 2);
  for (let i = 0; i < m; i++) {
    const sec = Math.max(1, Math.round(eLen[i] / NET_WALK_MPS));
    adjTo[cursor[from[i]]] = to[i]; adjSec[cursor[from[i]]++] = sec;
    adjTo[cursor[to[i]]] = from[i]; adjSec[cursor[to[i]]++] = sec;
  }

  const net = { n, lat, lon, off, adjTo, adjSec, edgeFrom: from, edgeTo: to, edgeLen: eLen };
  net.main = mainComponent(net);
  buildIndex(net);
  return net;
}

/**
 * Znacznik przynależności do największej spójnej składowej.
 *
 * Sieć z OSM ma 2–3% węzłów w drobnych odpryskach: fragmenty odcięte granicą
 * bboxa, ścieżki bez połączenia z resztą, błędy danych. Przyłączenie punktu do
 * takiego odprysku daje izochronę z kilkunastu pikseli — zdarzyło się to
 * domyślnym punktom GZM (odprysk 7 węzłów, 19 m od punktu) i Bydgoszczy
 * (3 węzły, 22 m). `snapNode` pomija węzły spoza tej składowej; węzły odprysków
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
 * Najbliższy węzeł sieci albo −1, gdy dalej niż `maxM`.
 * Przeszukuje pierścienie kubełków, rosnąco, aż znaleziony węzeł jest bliżej
 * niż nieprzeszukany obszar. Pomija węzły spoza największej spójnej składowej
 * (patrz `mainComponent`) — przyłączenie do odprysku dawałoby pustą izochronę.
 */
export function snapNode(net, lat, lon, maxM = SNAP_MAX_M) {
  const ix = net.index;
  const cx = Math.min(ix.W - 1, Math.max(0, Math.floor((lon - ix.lonW) * ix.mPerDegLon / CELL_M)));
  const cy = Math.min(ix.H - 1, Math.max(0, Math.floor((lat - ix.latS) * M_PER_DEG_LAT / CELL_M)));
  const maxRing = Math.ceil(maxM / CELL_M) + 1;
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= maxRing; r++) {
    if (best >= 0 && bestD <= (r - 1) * CELL_M) break; // dalsze pierścienie nie poprawią
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= ix.H) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= ix.W) continue;
        if (r > 0 && Math.abs(y - cy) !== r && Math.abs(x - cx) !== r) continue; // tylko obrzeże
        const c = y * ix.W + x;
        for (let k = ix.start[c]; k < ix.start[c + 1]; k++) {
          const i = ix.items[k];
          if (!net.main[i]) continue; // odprysk — prowadziłby donikąd
          const dy = (net.lat[i] - lat) * M_PER_DEG_LAT;
          const dx = (net.lon[i] - lon) * ix.mPerDegLon;
          const d = Math.hypot(dx, dy);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
  }
  return bestD <= maxM ? best : -1;
}

/**
 * Multi-source Dijkstra po sieci, kolejka kubełkowa po sekundach.
 * @param {object} net    sieć z `decodeWalkNet`
 * @param {Array<[number, number]>} seeds  [indeksWęzła, sekundyStartu]
 * @param {number} capSec  horyzont [s]
 * @returns {Int32Array} czas w każdym węźle (−1 = nieosiągalny)
 */
export function computeNodeTimes(net, seeds, capSec) {
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
        push(net.adjTo[k], t + net.adjSec[k]);
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
 * @param {object} net
 * @param {Int32Array} nodeTime  wynik `computeNodeTimes`
 * @param {object} grid          siatka z `buildWalkGrid`
 * @param {(grid:object, lat:number, lon:number)=>number} pixelIndex
 * @param {number} unreach       wartość „nieosiągalne" bufora (walkgrid.UNREACH)
 * @param {number} capSec        horyzont — dłuższych czasów nie ma sensu nanosić
 */
export function paintNetwork(net, nodeTime, grid, pixelIndex, unreach, capSec) {
  const time = grid.time;
  time.fill(unreach);
  // krok próbkowania poniżej boku piksela, żeby kolejne próbki trafiały
  // w sąsiadujące komórki także po skosie
  const stepM = Math.max(8, grid.res * 0.7);
  const nEdges = net.edgeLen.length;
  for (let e = 0; e < nEdges; e++) {
    const a = net.edgeFrom[e], b = net.edgeTo[e];
    const ta = nodeTime[a], tb = nodeTime[b];
    if (ta < 0 && tb < 0) continue;
    const len = net.edgeLen[e];
    const latA = net.lat[a], lonA = net.lon[a];
    const dLat = net.lat[b] - latA, dLon = net.lon[b] - lonA;
    const steps = Math.max(1, Math.round(len / stepM));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const idx = pixelIndex(grid, latA + dLat * f, lonA + dLon * f);
      if (idx < 0) continue;
      // czas krótszy z dwóch kierunków dojścia wzdłuż krawędzi
      let t = Infinity;
      if (ta >= 0) t = ta + (len * f) / NET_WALK_MPS;
      if (tb >= 0) {
        const viaB = tb + (len * (1 - f)) / NET_WALK_MPS;
        if (viaB < t) t = viaB;
      }
      if (t > capSec) continue;
      const v = t | 0;
      if (v < time[idx]) time[idx] = v;
    }
  }
}
