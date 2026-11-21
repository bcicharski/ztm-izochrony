/**
 * Zamiana czasów dojazdu per przystanek na geometrię stref czasowych.
 * Strefy: ≤10, ≤20, ≤30, ≤45, ≤60, >60 min (rysowane do 90 min).
 * Kolory: sekwencyjnie ciepły→chłodny o dużych skokach kontrastu;
 * monotoniczna jasność niesie porządek także przy zaburzeniach widzenia barw.
 * Pasmo >60 min jest neutralnie szare — celowo odcina się od reszty.
 */

import { WALK_MPS } from './data.js';

export const BANDS = [
  { limit: 10, color: '#fdc527', label: 'do 10 min' },
  { limit: 20, color: '#e8602d', label: '10–20 min' },
  { limit: 30, color: '#c13b82', label: '20–30 min' },
  { limit: 45, color: '#7e03a8', label: '30–45 min' },
  { limit: 60, color: '#2d0887', label: '45–60 min' },
  { limit: 90, color: '#55555e', label: 'ponad 60 min' }, // neutralna szarość — wyraźne odcięcie
];

/** Promień wizualny przystanku w trybie bez spaceru [m]. */
export const NO_WALK_RADIUS_M = 200;
/**
 * Cap promienia dla przystanków POZA siatką pieszą (dalekie stacje: Lębork,
 * Tczew, Działdowo). Pełny promień pasma to nawet 5,2 km (90 min × tempo), a bez
 * siatki nie ma bariery wody ani lądu — takie koło malowało pół powiatu i zlewało
 * się w jedną plamę. 1 km ≈ 17 min marszu: uczciwy zasięg stacji, nie kontynent.
 */
export const OUTSIDE_MAX_RADIUS_M = 1000;
/** Minimalny rysowany promień [m] — żeby strefa nie znikała przy t ≈ limit. */
const MIN_RADIUS_M = 60;

/**
 * @param {object} net     sieć (dla współrzędnych przystanków)
 * @param {Float64Array} minutes  czas dojazdu per przystanek
 * @param {{walk: boolean, origin: {lat:number, lon:number}, maxRadiusM?: number}} opts
 *        `maxRadiusM` — górny cap promienia (fallback dla przystanków poza siatką);
 *        `egressMps` — tempo wyjścia z przystanku [m/s], domyślnie WALK_MPS;
 *        `originMps` — tempo wokół punktu użytkownika, domyślnie `egressMps`;
 *        `capPerStop` — własny górny cap promienia per przystanek [m] (indeks jak w
 *        `minutes`; brak wartości = bez capa). Działa także bez spaceru. Używane
 *        przy przystankach tuż za krawędzią siatki (Z-007): koło nie wchodzi w siatkę,
 *        tam pracuje fala z nasion brzegowych (`borderSeeds`)
 * @returns {Array<{color: string, circles: Array<[lat, lon, radiusM]>}>}
 *          kolejność: od najchłodniejszej (rysować pierwszą) do najcieplejszej
 */
export function buildZones(net, minutes, opts) {
  const zones = BANDS.map(b => ({ limit: b.limit, color: b.color, circles: [] }));
  const cap = opts.maxRadiusM ?? Infinity;
  // tempo wyjścia z przystanku (rower w pojeździe: rowerowe); origin domyślnie tym samym
  const egressMps = opts.egressMps ?? WALK_MPS;
  const originMps = opts.originMps ?? egressMps;
  const capPerStop = opts.capPerStop;

  if (opts.walk) {
    // punkt startowy zachowuje się jak przystanek o czasie 0
    // (w trybie porównania origin jest pomijany — obszar wyznaczają przystanki)
    if (opts.origin) {
      for (let b = 0; b < BANDS.length; b++) {
        zones[b].circles.push([opts.origin.lat, opts.origin.lon, Math.min(BANDS[b].limit * 60 * originMps, cap)]);
      }
    }
    for (let i = 0; i < net.nStops; i++) {
      const t = minutes[i];
      if (t > 90) continue;
      for (let b = 0; b < BANDS.length; b++) {
        if (t <= BANDS[b].limit) {
          let r = Math.max(Math.min((BANDS[b].limit - t) * 60 * egressMps, cap), MIN_RADIUS_M);
          // cap per przystanek stosowany na końcu, więc obcina także MIN_RADIUS_M
          if (capPerStop && capPerStop[i] < r) {
            r = capPerStop[i];
            if (r <= 0) continue;
          }
          zones[b].circles.push([net.lat[i], net.lon[i], r]);
        }
      }
    }
  } else {
    for (let i = 0; i < net.nStops; i++) {
      const t = minutes[i];
      if (t > 90) continue;
      const b = BANDS.findIndex(band => t <= band.limit);
      if (b >= 0) {
        const r = capPerStop && capPerStop[i] < NO_WALK_RADIUS_M ? capPerStop[i] : NO_WALK_RADIUS_M;
        if (r > 0) zones[b].circles.push([net.lat[i], net.lon[i], r]);
      }
    }
  }

  // rysowanie: najchłodniejsza najpierw, najcieplejsza na wierzchu
  return zones.reverse();
}
