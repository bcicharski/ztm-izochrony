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
 * @param {{walk: boolean, origin: {lat, lon}}} opts
 * @returns {Array<{limit, color, label, maxKm, areaPct}>} wiersze w kolejności pasm
 */
export function computeStats(net, minutes, opts) {
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
    for (const row of rows) row.maxKm = row.limit * 60 * WALK_MPS / 1000; // sam spacer
  }
  for (let i = 0; i < net.nStops; i++) {
    const t = minutes[i];
    if (t > 90) continue;
    const d = distM(opts.origin.lat, opts.origin.lon, net.lat[i], net.lon[i]);
    for (const row of rows) {
      if (t > row.limit) continue;
      const reach = (d + (opts.walk ? (row.limit - t) * 60 * WALK_MPS : 0)) / 1000;
      if (reach > row.maxKm) row.maxKm = reach;
    }
  }
  return rows;
}
