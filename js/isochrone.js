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
/** Minimalny rysowany promień [m] — żeby strefa nie znikała przy t ≈ limit. */
const MIN_RADIUS_M = 60;

/**
 * @param {object} net     sieć (dla współrzędnych przystanków)
 * @param {Float64Array} minutes  czas dojazdu per przystanek
 * @param {{walk: boolean, origin: {lat:number, lon:number}}} opts
 * @returns {Array<{color: string, circles: Array<[lat, lon, radiusM]>}>}
 *          kolejność: od najchłodniejszej (rysować pierwszą) do najcieplejszej
 */
export function buildZones(net, minutes, opts) {
  const zones = BANDS.map(b => ({ limit: b.limit, color: b.color, circles: [] }));

  if (opts.walk) {
    // punkt startowy zachowuje się jak przystanek o czasie 0
    // (w trybie porównania origin jest pomijany — obszar wyznaczają przystanki)
    if (opts.origin) {
      for (let b = 0; b < BANDS.length; b++) {
        zones[b].circles.push([opts.origin.lat, opts.origin.lon, BANDS[b].limit * 60 * WALK_MPS]);
      }
    }
    for (let i = 0; i < net.nStops; i++) {
      const t = minutes[i];
      if (t > 90) continue;
      for (let b = 0; b < BANDS.length; b++) {
        if (t <= BANDS[b].limit) {
          const r = Math.max((BANDS[b].limit - t) * 60 * WALK_MPS, MIN_RADIUS_M);
          zones[b].circles.push([net.lat[i], net.lon[i], r]);
        }
      }
    }
  } else {
    for (let i = 0; i < net.nStops; i++) {
      const t = minutes[i];
      if (t > 90) continue;
      const b = BANDS.findIndex(band => t <= band.limit);
      if (b >= 0) zones[b].circles.push([net.lat[i], net.lon[i], NO_WALK_RADIUS_M]);
    }
  }

  // rysowanie: najchłodniejsza najpierw, najcieplejsza na wierzchu
  return zones.reverse();
}
