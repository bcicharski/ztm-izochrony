/**
 * Statystyki zasięgu:
 *  - maksymalna odległość (w linii prostej) od punktu w każdym paśmie czasu,
 *  - odsetek powierzchni lądowej Gdańska objętej strefą (tylko tryb ze spacerem).
 *
 * Powierzchnia liczona rastrowo: granica miasta i maska wody rysowane są raz
 * na offscreen canvas w siatce RES_M m/px (rzut równokątny), a strefy każdego
 * pasma nanoszone i przecinane z lądem przez compositing.
 */

import { WALK_MPS, distM, M_PER_DEG_LAT } from './data.js';
import { BANDS } from './isochrone.js';

const RES_M = 25;   // metrów na piksel rastra
const PAD_M = 500;  // margines wokół granicy miasta

let raster = null;  // { W, H, toX, toY, landCanvas, landPx, landKm2, scratch }

/** Jednorazowa inicjalizacja rastra lądu. cityRings/waterRings: [[[lat,lon],...],...] */
export function initStats(cityRings, waterRings) {
  let latN = -Infinity, latS = Infinity, lonW = Infinity, lonE = -Infinity;
  for (const ring of cityRings) {
    for (const [la, lo] of ring) {
      if (la > latN) latN = la;
      if (la < latS) latS = la;
      if (lo < lonW) lonW = lo;
      if (lo > lonE) lonE = lo;
    }
  }
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(((latN + latS) / 2) * Math.PI / 180);
  latN += PAD_M / M_PER_DEG_LAT; latS -= PAD_M / M_PER_DEG_LAT;
  lonW -= PAD_M / mPerDegLon; lonE += PAD_M / mPerDegLon;

  const W = Math.ceil((lonE - lonW) * mPerDegLon / RES_M);
  const H = Math.ceil((latN - latS) * M_PER_DEG_LAT / RES_M);
  const toX = lon => (lon - lonW) * mPerDegLon / RES_M;
  const toY = lat => (latN - lat) * M_PER_DEG_LAT / RES_M;

  const landCanvas = document.createElement('canvas');
  landCanvas.width = W; landCanvas.height = H;
  const ctx = landCanvas.getContext('2d');

  const tracePath = rings => {
    ctx.beginPath();
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const x = toX(ring[i][1]), y = toY(ring[i][0]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  };

  ctx.fillStyle = '#000';
  tracePath(cityRings);
  ctx.fill('nonzero');
  if (waterRings) {
    ctx.globalCompositeOperation = 'destination-out';
    tracePath(waterRings.map(r => r.map(p => [p[0], p[1]])));
    ctx.fill('nonzero');
    ctx.globalCompositeOperation = 'source-over';
  }

  const landPx = countPixels(ctx, W, H);
  const scratch = document.createElement('canvas');
  scratch.width = W; scratch.height = H;
  raster = { W, H, toX, toY, landCanvas, landPx, landKm2: landPx * RES_M * RES_M / 1e6, scratch };
  return raster.landKm2;
}

function countPixels(ctx, W, H) {
  // widok 32-bitowy: piksel niezerowy = cokolwiek narysowane (alfa > 0)
  const px = new Uint32Array(ctx.getImageData(0, 0, W, H).data.buffer);
  let n = 0;
  for (let i = 0; i < px.length; i++) if (px[i] !== 0) n++;
  return n;
}

/**
 * Maksymalna odległość w linii prostej per pasmo (szybkie — liczone od razu).
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

/**
 * Uzupełnia w wierszach odsetek powierzchni lądowej miasta (cięższe —
 * rasteryzacja; wywoływane z opóźnieniem, poza rysowaniem mapy).
 * Ma sens tylko w trybie ze spacerem, gdy strefy są obszarami.
 * @param {Array} zones  wynik buildZones
 * @param {Array} rows   wiersze z computeStats (modyfikowane w miejscu)
 */
export function computeAreas(zones, rows) {
  if (!raster) return rows;
  const { W, H, toX, toY, landCanvas, landPx, scratch } = raster;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  for (const zone of zones) {
    const row = rows.find(r => r.limit === zone.limit);
    if (!row) continue;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (const [lat, lon, rM] of zone.circles) {
      const x = toX(lon), y = toY(lat), r = rM / RES_M;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(landCanvas, 0, 0);
    row.areaPct = 100 * countPixels(ctx, W, H) / landPx;
  }
  return rows;
}
