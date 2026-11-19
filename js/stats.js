/**
 * Statystyki zasięgu: maksymalna odległość (w linii prostej) od punktu
 * w każdym paśmie czasu — przybliżenie kołowe, liczone od razu.
 *
 * Odsetek powierzchni miasta liczy `areaPercents` w js/walkgrid.js na tej
 * samej siatce, na której rysowane są strefy (dawny osobny raster z tego
 * pliku dawał wyniki niespójne ze strefami i został usunięty).
 */

import { WALK_MPS, distM } from './data.js';
import { BANDS } from './isochrone.js';

/**
 * Maksymalna odległość w linii prostej per pasmo.
 * @param {object} net      sieć (współrzędne przystanków)
 * @param {Float64Array} minutes  czasy dojazdu per przystanek
 * @param {{walk: boolean, origin: {lat, lon}, accessMps?: number, egressMps?: number,
 *   maxEgressSec?: number}} opts
 *   `accessMps` — tempo poruszania się od punktu (pieszo albo rowerem),
 *   `egressMps` — tempo od przystanku do celu (rower „zostaje na przystanku"
 *   daje tu tempo marszu, mimo że dojście było rowerem),
 *   `maxEgressSec` — limit spaceru od przystanku [s] (Z-012; domyślnie bez limitu).
 *   Wiersz „sam spacer z punktu" go nie dotyczy — punkt jest z limitu zwolniony.
 * @returns {Array<{limit, color, label, maxKm, areaPct}>} wiersze w kolejności pasm
 */
export function computeStats(net, minutes, opts) {
  const accessMps = opts.accessMps ?? WALK_MPS;
  const egressMps = opts.egressMps ?? WALK_MPS;
  const maxEgressSec = opts.maxEgressSec ?? Infinity;
  const rows = BANDS.map(b => ({
    limit: b.limit, color: b.color, label: b.label,
    maxKm: 0, areaPct: null,
  }));

  // bez punktu odniesienia (tryb porównania) odległość nie ma sensu
  if (!opts.origin) {
    for (const row of rows) row.maxKm = null;
    return rows;
  }

  if (opts.walk) {
    for (const row of rows) row.maxKm = row.limit * 60 * accessMps / 1000; // bez pojazdu
  }
  for (let i = 0; i < net.nStops; i++) {
    const t = minutes[i];
    if (t > 90) continue;
    const d = distM(opts.origin.lat, opts.origin.lon, net.lat[i], net.lon[i]);
    for (const row of rows) {
      if (t > row.limit) continue;
      const reach = (d + (opts.walk ? Math.min((row.limit - t) * 60, maxEgressSec) * egressMps : 0)) / 1000;
      if (reach > row.maxKm) row.maxKm = reach;
    }
  }
  return rows;
}

/* ---------- Miejsce spotkania dwóch osób (Z-004) ---------- */

/** Ile pozycji zwraca lista (pozycja 1 + alternatywy 2–5). */
export const MEET_LIMIT = 5;
/** Dwie pozycje listy bliżej niż to są jedną propozycją — promień zespołu z `clusterStopGroups`. */
export const MEET_MIN_SEPARATION_M = 300;
/** Okno dopuszczalności kryterium „po równo": najwyżej tyle minut ponad najszybsze spotkanie… */
export const MEET_SLACK_MIN = 10;
/** …i nie więcej niż ta część najszybszego spotkania (mała wartość nie pozwala „wyrównać" kosztem długiej jazdy). */
export const MEET_SLACK_FRAC = 0.5;

/** Górna granica czasu „dopuszczalnego" spotkania przy kryterium „po równo". */
export const meetingWindow = bestMaxMin =>
  bestMaxMin + Math.min(MEET_SLACK_MIN, Math.round(bestMaxMin * MEET_SLACK_FRAC));

/**
 * Kandydaci na miejsce spotkania: jeden na zespół przystanków (`net.group`),
 * osiągalny przez obie osoby w `maxMin` minut. Reprezentant zespołu to słupek
 * o najmniejszym `max(a,b)` (remis: mniejsza suma, potem indeks) — jedna reguła
 * dla obu kryteriów, więc karta obiecuje jedną, realną parę czasów.
 * @returns {{list: object[], bothCount: number, bestMaxMin: number|null}}
 */
export function meetingCandidates(net, minutesA, minutesB, { maxMin = 90 } = {}) {
  const byGroup = new Map();
  for (let i = 0; i < net.nStops; i++) {
    const a = minutesA[i], b = minutesB[i];
    if (!(a <= maxMin) || !(b <= maxMin)) continue; // odrzuca też Infinity i NaN
    const meet = Math.max(a, b), sum = a + b;
    const cur = byGroup.get(net.group[i]);
    if (!cur || meet < cur.meetMin || (meet === cur.meetMin && sum < cur.sumMin)) {
      byGroup.set(net.group[i], {
        group: net.group[i], stop: i, name: net.stopName[i], lat: net.lat[i], lon: net.lon[i],
        aMin: a, bMin: b, meetMin: meet, sumMin: sum, diffMin: Math.abs(a - b),
      });
    }
  }
  const list = [...byGroup.values()];
  let bestMaxMin = null;
  for (const c of list) if (bestMaxMin === null || c.meetMin < bestMaxMin) bestMaxMin = c.meetMin;
  return { list, bothCount: list.length, bestMaxMin };
}

/** „Po równo": różnica (pełne minuty) → dłuższa z dwóch jazd (pełne minuty) → numer zespołu. */
export const compareFair = (x, y) =>
  (Math.round(x.diffMin) - Math.round(y.diffMin))
  || (Math.round(x.meetMin) - Math.round(y.meetMin))
  || (x.group - y.group);

/** „Najkrócej razem": suma → dłuższa z dwóch jazd → numer zespołu. */
export const compareSum = (x, y) =>
  (x.sumMin - y.sumMin) || (x.meetMin - y.meetMin) || (x.group - y.group);

/** Pierwsze `limit` pozycji z zachowaniem odstępu `MEET_MIN_SEPARATION_M` od już wybranych. */
function pickSeparated(sorted, limit) {
  const out = [];
  for (const c of sorted) {
    if (out.length >= limit) break;
    if (out.some(o => distM(o.lat, o.lon, c.lat, c.lon) < MEET_MIN_SEPARATION_M)) continue;
    out.push(c);
  }
  return out;
}

/**
 * Ranking miejsc spotkania obu kryteriów naraz (zmiana kryterium w UI nie
 * wymaga przeliczenia).
 * @param {{maxMin?: number, limit?: number}} [opts]
 * @returns {{bothCount: number, bestMaxMin: number|null, windowMin: number|null,
 *   fair: object[], sum: object[], fastest: object|null}}
 *   `fastest` — zespół o najkrótszym `max(a,b)` (do noty „najszybciej spotkalibyście się…").
 */
export function rankMeetingPlaces(net, minutesA, minutesB, opts = {}) {
  const { list, bothCount, bestMaxMin } = meetingCandidates(net, minutesA, minutesB, opts);
  if (!bothCount) return { bothCount: 0, bestMaxMin: null, windowMin: null, fair: [], sum: [], fastest: null };
  const limit = opts.limit ?? MEET_LIMIT;
  const windowMin = meetingWindow(bestMaxMin);
  const fair = pickSeparated(list.filter(c => c.meetMin <= windowMin).sort(compareFair), limit);
  const sum = pickSeparated(list.slice().sort(compareSum), limit);
  const fastest = list.reduce((b, c) => (c.meetMin - b.meetMin || compareSum(c, b)) < 0 ? c : b);
  return { bothCount, bestMaxMin, windowMin, fair, sum, fastest };
}
