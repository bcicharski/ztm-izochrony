#!/usr/bin/env node
/**
 * Kolektor opóźnień komunikacji miejskiej. Odpytuje źródła czasu rzeczywistego
 * zdefiniowane w data/cities.json (pole "rt") i dolicza obserwacje do
 * kompaktowych agregatów w data/delays/<miasto>.json.
 *
 * Agregat: klucz "linia|typDnia|godzina" (typ dnia: 0=roboczy, 1=sobota,
 * 2=niedziela; godzina lokalna Europe/Warsaw) -> [n, sumaSekund, b0..b5],
 * gdzie b0..b5 to histogram: <-1min, -1..1, 1..3, 3..5, 5..10, >10 min.
 * Z histogramu można później policzyć medianę i percentyle per linia/godzina.
 *
 * Uruchamiany co ~15 min przez GitHub Actions (collect-delays.yml);
 * jedna obserwacja = jeden kurs (pojazd) na jedno odpytanie.
 *
 * Wymaga pakietu gtfs-realtime-bindings (instalowany w workflow, bez zapisu
 * do package.json).
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const cities = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cities.json'), 'utf8'));
const outDir = path.join(root, 'data', 'delays');
fs.mkdirSync(outDir, { recursive: true });

const UA = { 'User-Agent': 'ztm-izochrony-delays/1.0' };
const BUCKETS = [-60, 60, 180, 300, 600]; // granice histogramu [s]

// lokalny typ dnia i godzina (Actions działa w UTC)
function localSlot(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw', hour: 'numeric', hour12: false, weekday: 'short',
  }).formatToParts(date);
  const wd = parts.find(p => p.type === 'weekday').value;
  const hour = +parts.find(p => p.type === 'hour').value % 24;
  const dayType = wd === 'Sun' ? 2 : wd === 'Sat' ? 1 : 0;
  return { dayType, hour };
}

function bucketIndex(delaySec) {
  for (let i = 0; i < BUCKETS.length; i++) if (delaySec < BUCKETS[i]) return i;
  return BUCKETS.length;
}

/** Obserwacje z feedu GTFS-RT TripUpdates: mapa kurs -> {route, delaySec}. */
async function fromGtfsRt(urls) {
  const { transit_realtime } = (await import('gtfs-realtime-bindings')).default;
  const obs = new Map();
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) { console.warn(`RT ${url}: HTTP ${res.status}`); continue; }
      const decoded = transit_realtime.FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));
      // toObject bez defaults: pola nieobecne w feedzie są undefined
      // (surowa instancja materializuje protobufowe zera, co fałszuje dane)
      const feed = transit_realtime.FeedMessage.toObject(decoded, { defaults: false });
      for (const e of feed.entity ?? []) {
        const tu = e.tripUpdate;
        if (!tu?.trip?.routeId) continue; // bez linii obserwacja jest bezużyteczna
        let delay = tu.delay;
        if (delay === undefined) {
          for (const stu of tu.stopTimeUpdate ?? []) {
            const d = stu.arrival?.delay ?? stu.departure?.delay;
            if (d !== undefined) { delay = d; break; }
          }
        }
        if (delay === undefined) continue;
        obs.set(`${url}|${tu.trip.tripId ?? e.id}`, { route: String(tu.trip.routeId), delaySec: delay });
      }
    } catch (err) {
      console.warn(`RT ${url}: ${err.message}`);
    }
  }
  return obs;
}

/** Obserwacje z API estymacji ZTM Gdańsk: jedna na kurs (pole trip). */
async function fromGdanskDepartures(url) {
  const obs = new Map();
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) { console.warn(`RT ${url}: HTTP ${res.status}`); return obs; }
    const data = await res.json();
    for (const stop of Object.values(data)) {
      for (const dep of stop.departures ?? []) {
        if (dep.status !== 'REALTIME' || dep.delayInSeconds == null) continue;
        const key = String(dep.trip ?? `${dep.routeId}|${dep.vehicleId}`);
        if (!obs.has(key)) {
          obs.set(key, { route: String(dep.routeShortName ?? dep.routeId), delaySec: dep.delayInSeconds });
        }
      }
    }
  } catch (err) {
    console.warn(`RT ${url}: ${err.message}`);
  }
  return obs;
}

const { dayType, hour } = localSlot();
let totalObs = 0;

for (const [cityKey, cfg] of Object.entries(cities)) {
  if (!cfg.rt) continue;
  const obs = cfg.rt.type === 'gtfsrt'
    ? await fromGtfsRt(cfg.rt.urls)
    : cfg.rt.type === 'gdansk-departures'
      ? await fromGdanskDepartures(cfg.rt.url)
      : new Map();
  if (obs.size === 0) { console.warn(`${cityKey}: brak obserwacji`); continue; }

  const file = path.join(outDir, `${cityKey}.json`);
  const agg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const { route, delaySec } of obs.values()) {
    const key = `${route}|${dayType}|${hour}`;
    const row = agg[key] ?? [0, 0, 0, 0, 0, 0, 0, 0];
    row[0] += 1;
    row[1] += delaySec;
    row[2 + bucketIndex(delaySec)] += 1;
    agg[key] = row;
  }
  fs.writeFileSync(file, JSON.stringify(agg));
  totalObs += obs.size;
  console.log(`${cityKey}: ${obs.size} obserwacji (slot ${dayType}/${hour}), kluczy: ${Object.keys(agg).length}`);
}

console.log(`Razem: ${totalObs} obserwacji.`);
