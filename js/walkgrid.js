/**
 * Zasięg pieszy liczony po lądzie: siatka rastrowa nad bboxem miasta,
 * woda = bariera, mosty/mola/kładki = przejezdne korytarze.
 * Czas dojścia propagowany falowo (multi-source Dijkstra, kolejka kubełkowa)
 * od przystanków (z czasem dojazdu) i punktu startowego.
 *
 * Zastępuje dawne "koła spacerowe" wewnątrz bboxa; przystanki poza bboxem
 * (np. Lębork w feedzie SKM) obsługuje fallback kołowy w app.js.
 */

import { WALK_MPS, M_PER_DEG_LAT } from './data.js';
import { BANDS } from './isochrone.js';

const MAX_CELLS = 4_000_000; // limit rozmiaru siatki — rozdzielczość dobierana automatycznie
const CAP_SEC = 90 * 60;     // horyzont rysowania (jak pasmo "ponad 60")

const gridCache = new Map(); // cityKey -> grid

/**
 * Buduje statyczną siatkę lądu dla miasta (raz, cache).
 * @param {string} cityKey
 * @param {object} cfg          wpis z cities.json (bbox)
 * @param {{polys:Array,lines:Array}|null} water  poligony akwenów + linie rzek/kanałów
 * @param {Array|null} bridges  linie mostów [[ [lat,lon], ...], ...]
 * @param {Array|null} city     granice miasta (do statystyk % powierzchni)
 */
export function buildWalkGrid(cityKey, cfg, water, bridges, city) {
  if (gridCache.has(cityKey)) return gridCache.get(cityKey);

  const [latS, lonW, latN, lonE] = cfg.bbox;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(((latN + latS) / 2) * Math.PI / 180);
  const spanX = (lonE - lonW) * mPerDegLon;
  const spanY = (latN - latS) * M_PER_DEG_LAT;
  // rozdzielczość: 25 m albo grubsza, żeby zmieścić się w limicie komórek
  const res = Math.max(25, Math.ceil(Math.sqrt((spanX * spanY) / MAX_CELLS)));
  const W = Math.ceil(spanX / res);
  const H = Math.ceil(spanY / res);

  const toX = lon => (lon - lonW) * mPerDegLon / res;
  const toY = lat => (latN - lat) * M_PER_DEG_LAT / res;

  // rasteryzacja przez canvas: ląd = alfa 0, woda = wypełnienie, mosty = wycięte z wody
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const trace = rings => {
    ctx.beginPath();
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const x = toX(ring[i][1]), y = toY(ring[i][0]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  };
  if (water?.polys?.length) {
    ctx.fillStyle = '#000';
    trace(water.polys);
    ctx.fill('nonzero');
  }
  if (water?.lines?.length) {
    // linie rzek/kanałów uzupełniają dziury poligonów; ~100 m szerokości,
    // większe niż korytarz mostu (50 m), by most-cut nie zniwelował rzeki
    ctx.strokeStyle = '#000';
    ctx.lineWidth = Math.max(3, 100 / res);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const line of water.lines) {
      for (let i = 0; i < line.length; i++) {
        const x = toX(line[i][1]), y = toY(line[i][0]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  if (bridges) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = Math.max(1.5, 50 / res); // korytarz ~50 m — pewne połączenie po obu brzegach
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const line of bridges) {
      for (let i = 0; i < line.length; i++) {
        const x = toX(line[i][1]), y = toY(line[i][0]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  const img = ctx.getImageData(0, 0, W, H).data;
  const land = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) land[i] = img[i * 4 + 3] > 127 ? 0 : 1;

  // maska granic miasta (statystyka % powierzchni na tej samej siatce)
  let cityMask = null, cityLandPx = 0;
  if (city) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    trace(city);
    ctx.fill('nonzero');
    const cimg = ctx.getImageData(0, 0, W, H).data;
    cityMask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      cityMask[i] = cimg[i * 4 + 3] > 127 ? 1 : 0;
      if (cityMask[i] && land[i]) cityLandPx++;
    }
  }

  const grid = {
    W, H, res, latS, lonW, latN, lonE, mPerDegLon, land, cityMask, cityLandPx,
    toX, toY,
    // bufory wielokrotnego użytku
    time: new Uint16Array(W * H),
    imageData: new ImageData(W, H),
    canvas: (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; })(),
  };
  gridCache.set(cityKey, grid);
  return grid;
}

export const UNREACH = 65535;

/**
 * Propagacja czasu po lądzie od źródeł [pxIndex, sekundy].
 * Wynik w grid.time (sekundy, UNREACH = nieosiągalne).
 */
export function computeTimeGrid(grid, seeds) {
  const { W, H, res, land, time } = grid;
  time.fill(UNREACH);
  const orth = Math.max(1, Math.round(res / WALK_MPS));
  const diag = Math.round(orth * Math.SQRT2);

  // kolejka kubełkowa po sekundach
  const buckets = new Array(CAP_SEC + 1);
  let pending = 0;
  const push = (idx, t) => {
    if (t > CAP_SEC || t >= time[idx]) return;
    time[idx] = t;
    (buckets[t] ??= []).push(idx);
    pending++;
  };
  for (const [idx, sec] of seeds) {
    if (idx >= 0 && idx < W * H && land[idx]) push(idx, Math.min(sec, CAP_SEC));
    else if (idx >= 0 && idx < W * H) {
      // przystanek na pikselu wody (pomost, błąd rastra) — spróbuj sąsiadów
      for (const d of [-1, 1, -W, W]) {
        const j = idx + d;
        if (j >= 0 && j < W * H && land[j]) { push(j, Math.min(sec, CAP_SEC)); break; }
      }
    }
  }

  for (let t = 0; t <= CAP_SEC && pending > 0; t++) {
    const bucket = buckets[t];
    if (!bucket) continue;
    for (const idx of bucket) {
      pending--;
      if (time[idx] !== t) continue; // nieaktualny wpis
      const x = idx % W, y = (idx / W) | 0;
      const left = x > 0, right = x < W - 1, up = y > 0, down = y < H - 1;
      if (left && land[idx - 1]) push(idx - 1, t + orth);
      if (right && land[idx + 1]) push(idx + 1, t + orth);
      if (up && land[idx - W]) push(idx - W, t + orth);
      if (down && land[idx + W]) push(idx + W, t + orth);
      if (left && up && land[idx - W - 1]) push(idx - W - 1, t + diag);
      if (right && up && land[idx - W + 1]) push(idx - W + 1, t + diag);
      if (left && down && land[idx + W - 1]) push(idx + W - 1, t + diag);
      if (right && down && land[idx + W + 1]) push(idx + W + 1, t + diag);
    }
    buckets[t] = undefined;
  }
  return time;
}

/**
 * Tryb bez spaceru: strefy o promieniu `radiusM` wokół przystanków, mierzone
 * PO LĄDZIE (woda blokuje, jak w `computeTimeGrid`), ale bez dodawania czasu
 * dojścia — każdy piksel dostaje czysty czas przyjazdu przystanku-źródła
 * (kolor = pasmo przystanku, tak jak dawne stałe koła 200 m, tylko przycięte
 * geometrią wody). Przy nakładaniu stref wygrywa wcześniejszy przyjazd
 * (mniejsze sekundy), a przy remisie — bliższy przystanek (mniejszy `spread`);
 * to samo pierwszeństwo, co rysowanie kół „najcieplejsza na wierzchu".
 *
 * Uwaga: przy nakładających się strefach dwóch przystanków propagacja nie
 * przechodzi przez piksele już zajęte przez wcześniejszy przyjazd, więc na
 * styku może wystąpić minimalne (podpikselowe przy res 25–40 m) niedopokrycie
 * po stronie zachowawczej — bez wpływu wizualnego.
 *
 * @param {object} grid   siatka z `buildWalkGrid`
 * @param {Array<[number, number]>} seeds  [pxIndex, sekundy przyjazdu] (bez origin)
 * @param {number} radiusM  promień strefy wokół przystanku [m]
 * @returns {Uint16Array} grid.time (sekundy przyjazdu, UNREACH = poza strefami)
 */
export function computeNoWalkGrid(grid, seeds, radiusM) {
  const { W, H, res, land, time } = grid;
  time.fill(UNREACH);
  const spread = new Uint16Array(W * H).fill(0xffff); // metry po lądzie od przystanku-źródła
  const orth = res;
  const diag = Math.round(res * Math.SQRT2);
  const buckets = new Array(CAP_SEC + 1);

  const push = (idx, arr, sp) => {
    if (sp > radiusM) return;
    if (arr < time[idx] || (arr === time[idx] && sp < spread[idx])) {
      time[idx] = arr;
      spread[idx] = sp;
      (buckets[arr] ??= []).push(idx);
    }
  };
  for (const [idx0, sec] of seeds) {
    if (idx0 < 0 || idx0 >= W * H) continue;
    let idx = idx0;
    if (!land[idx]) {
      // przystanek na pikselu wody (pomost, błąd rastra) — przenieś na sąsiada lądowego
      for (const d of [-1, 1, -W, W]) {
        const j = idx + d;
        if (j >= 0 && j < W * H && land[j]) { idx = j; break; }
      }
      if (!land[idx]) continue;
    }
    push(idx, Math.min(sec, CAP_SEC), 0);
  }

  // przetwarzanie kubełkami po czasie przyjazdu (rosnąco) = wcześniejszy koloruje pierwszy;
  // wewnątrz kubełka BFS po lądzie do promienia (kubełek rośnie w trakcie iteracji)
  for (let arr = 0; arr <= CAP_SEC; arr++) {
    const bucket = buckets[arr];
    if (!bucket) continue;
    for (let bi = 0; bi < bucket.length; bi++) {
      const idx = bucket[bi];
      if (time[idx] !== arr) continue; // przejęty przez wcześniejszy przyjazd
      const sp = spread[idx];
      const x = idx % W, y = (idx / W) | 0;
      const left = x > 0, right = x < W - 1, up = y > 0, down = y < H - 1;
      if (left && land[idx - 1]) push(idx - 1, arr, sp + orth);
      if (right && land[idx + 1]) push(idx + 1, arr, sp + orth);
      if (up && land[idx - W]) push(idx - W, arr, sp + orth);
      if (down && land[idx + W]) push(idx + W, arr, sp + orth);
      if (left && up && land[idx - W - 1]) push(idx - W - 1, arr, sp + diag);
      if (right && up && land[idx - W + 1]) push(idx - W + 1, arr, sp + diag);
      if (left && down && land[idx + W - 1]) push(idx + W - 1, arr, sp + diag);
      if (right && down && land[idx + W + 1]) push(idx + W + 1, arr, sp + diag);
    }
    buckets[arr] = undefined;
  }
  return time;
}

/** Punkt (lat, lon) -> indeks piksela albo -1 poza siatką. */
export function pixelIndex(grid, lat, lon) {
  const x = Math.round(grid.toX(lon)), y = Math.round(grid.toY(lat));
  if (x < 0 || y < 0 || x >= grid.W || y >= grid.H) return -1;
  return y * grid.W + x;
}

/** Łączy dwie siatki czasów (tryb porównania): wolniejsza osoba decyduje. */
export function maxTimeGrid(grid, a, b) {
  const out = grid.time; // nadpisujemy bufor
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(a[i], b[i]);
  }
  return out;
}

const BAND_RGBA = BANDS.map(b => {
  const n = parseInt(b.color.slice(1), 16);
  return { limit: b.limit * 60, r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
});

/** Koloruje siatkę czasów na canvas stref (pasma jak w legendzie). */
export function renderTimeGrid(grid, time) {
  const { W, H, imageData, canvas } = grid;
  const px = new Uint32Array(imageData.data.buffer);
  const little = true; // canvas ImageData = RGBA w pamięci little-endian jako ABGR w Uint32
  for (let i = 0; i < W * H; i++) {
    const t = time[i];
    if (t >= UNREACH) { px[i] = 0; continue; }
    let band = BAND_RGBA[BAND_RGBA.length - 1];
    for (const b of BAND_RGBA) { if (t <= b.limit) { band = b; break; } }
    px[i] = little
      ? (255 << 24) | (band.b << 16) | (band.g << 8) | band.r
      : (band.r << 24) | (band.g << 16) | (band.b << 8) | 255;
  }
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Statystyka: maksymalna odległość w linii prostej od punktu odniesienia
 * osiągnięta w każdym paśmie — liczona po siatce, więc zgodna z narysowanymi
 * strefami (uwzględnia obejścia wody), w odróżnieniu od przybliżenia kołowego
 * w `stats.js`. Siatka jest równokątna o stałym `res` w metrach na obu osiach,
 * więc odległość to zwykły dystans pikselowy × `res` (bez trygonometrii).
 * @param {object} grid       siatka z `buildWalkGrid`
 * @param {Uint16Array} time  czasy z `computeTimeGrid`/`computeNoWalkGrid`
 * @param {number} originIdx  indeks piksela punktu odniesienia (−1 = brak)
 * @returns {Array<number>|null} kilometry w kolejności BANDS, kumulatywnie
 */
export function maxBandDistances(grid, time, originIdx) {
  if (originIdx < 0) return null;
  const { W, res } = grid;
  const x0 = originIdx % W, y0 = (originIdx / W) | 0;
  const best = new Array(BAND_RGBA.length).fill(0);
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    if (t >= UNREACH) continue;
    let b = BAND_RGBA.length - 1;
    for (let k = 0; k < BAND_RGBA.length; k++) {
      if (t <= BAND_RGBA[k].limit) { b = k; break; }
    }
    const dx = (i % W) - x0, dy = ((i / W) | 0) - y0;
    const d = Math.sqrt(dx * dx + dy * dy) * res;
    if (d > best[b]) best[b] = d;
  }
  // kumulatywnie: pasmo ≤20 zawiera też ≤10, więc zasięg nie może maleć
  let cum = 0;
  return best.map(v => { cum = Math.max(cum, v); return cum / 1000; });
}

/** Statystyka: % powierzchni lądowej miasta w zasięgu każdego pasma. */
export function areaPercents(grid, time) {
  if (!grid.cityMask || !grid.cityLandPx) return null;
  const counts = new Array(BAND_RGBA.length).fill(0);
  for (let i = 0; i < time.length; i++) {
    if (!grid.cityMask[i] || !grid.land[i]) continue;
    const t = time[i];
    if (t >= UNREACH) continue;
    for (let b = 0; b < BAND_RGBA.length; b++) {
      if (t <= BAND_RGBA[b].limit) { counts[b]++; break; }
    }
  }
  // pasma kumulatywnie (strefa ≤20 zawiera ≤10 itd.)
  const out = [];
  let cum = 0;
  for (let b = 0; b < counts.length; b++) {
    cum += counts[b];
    out.push(100 * cum / grid.cityLandPx);
  }
  return out; // wartości % w kolejności BANDS
}
