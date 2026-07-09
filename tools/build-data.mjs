#!/usr/bin/env node
/**
 * Prekompilacja danych GTFS ZTM Gdańsk do kompaktowych plików JSON
 * czytanych przez frontend (data/workday.json, saturday.json, sunday.json, meta.json).
 *
 * Użycie:
 *   node tools/build-data.mjs <katalog-z-rozpakowanym-GTFS> [katalog-wyjściowy]
 *
 * GTFS: https://ckan.multimediagdansk.pl/dataset/tristar (Rozkład jazdy GTFS, licencja CC-BY)
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const gtfsDir = process.argv[2];
const outDir = process.argv[3] ?? path.join(import.meta.dirname, '..', 'data');
if (!gtfsDir || !fs.existsSync(path.join(gtfsDir, 'stop_times.txt'))) {
  console.error('Podaj katalog z rozpakowanym GTFS (musi zawierać stop_times.txt).');
  process.exit(1);
}

// --- pomocnicze ---------------------------------------------------------

/** Parser linii CSV z obsługą cudzysłowów. */
function splitCsv(line) {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function readCsvSync(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.length);
  const header = splitCsv(lines[0]);
  return lines.slice(1).map(l => {
    const cells = splitCsv(l);
    const row = {};
    header.forEach((h, i) => row[h] = cells[i] ?? '');
    return row;
  });
}

/** "28:16:00" -> minuty od północy (może przekraczać 1440). */
function timeToMin(t) {
  const [h, m] = t.split(':');
  return (+h) * 60 + (+m);
}

function dateToWeekday(yyyymmdd) {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=nd, 6=sob
}

const EARTH_M_PER_DEG_LAT = 111320;

// --- 1. kalendarz: wybór dat reprezentatywnych --------------------------

const calRows = readCsvSync(path.join(gtfsDir, 'calendar_dates.txt'));
const servicesByDate = new Map(); // date -> Set(service_id)
for (const r of calRows) {
  if (r.exception_type !== '1') continue;
  if (!servicesByDate.has(r.date)) servicesByDate.set(r.date, new Set());
  servicesByDate.get(r.date).add(r.service_id);
}
const allDates = [...servicesByDate.keys()].sort();
const pickDate = pred => allDates.find(d => pred(dateToWeekday(d)));
const dayTypes = [
  { key: 'workday', date: pickDate(w => w >= 2 && w <= 4) ?? pickDate(w => w >= 1 && w <= 5) },
  { key: 'saturday', date: pickDate(w => w === 6) },
  { key: 'sunday', date: pickDate(w => w === 0) },
].filter(d => d.date);
console.log('Wybrane daty:', dayTypes.map(d => `${d.key}=${d.date}`).join(', '));

// --- 2. linie i kursy ----------------------------------------------------

const routeRows = readCsvSync(path.join(gtfsDir, 'routes.txt'));
const routeInfo = new Map(); // route_id -> {name, type}
for (const r of routeRows) routeInfo.set(r.route_id, { name: r.route_short_name, type: +r.route_type });

const tripRows = readCsvSync(path.join(gtfsDir, 'trips.txt'));
// trip_id -> {routeId, dayIdx}
const tripMeta = new Map();
{
  const serviceToDay = new Map();
  dayTypes.forEach((d, i) => {
    for (const s of servicesByDate.get(d.date)) serviceToDay.set(s, i);
  });
  for (const t of tripRows) {
    const dayIdx = serviceToDay.get(t.service_id);
    if (dayIdx !== undefined) tripMeta.set(t.trip_id, { routeId: t.route_id, dayIdx });
  }
}
console.log(`Kursy w wybranych dniach: ${tripMeta.size}`);

// --- 3. przystanki -------------------------------------------------------

const stopRows = readCsvSync(path.join(gtfsDir, 'stops.txt'));
const stopIdx = new Map();   // stop_id -> index
const stops = [];            // {id, name, lat, lon, group}
{
  const groupIdx = new Map(); // nazwa zespołu -> group index
  for (const r of stopRows) {
    const name = r.stop_name.trim();
    const groupName = name.replace(/ \d+$/, ''); // "Wrzeszcz PKP 03" -> "Wrzeszcz PKP"
    if (!groupIdx.has(groupName)) groupIdx.set(groupName, groupIdx.size);
    stopIdx.set(r.stop_id, stops.length);
    stops.push({
      id: r.stop_id,
      name: groupName,
      lat: +r.stop_lat,
      lon: +r.stop_lon,
      group: groupIdx.get(groupName),
    });
  }
}
console.log(`Przystanki: ${stops.length}`);

// --- 4. stop_times (streaming) -------------------------------------------

// tripStops: trip_id -> tablica [stopSeq, stopIndex, depMin, flags] spłaszczona
const tripStops = new Map();
{
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(gtfsDir, 'stop_times.txt')),
    crlfDelay: Infinity,
  });
  let header = null, n = 0;
  let iTrip, iDep, iStop, iSeq, iPickup, iDrop;
  for await (const line of rl) {
    if (!header) {
      header = splitCsv(line.replace(/^﻿/, ''));
      iTrip = header.indexOf('trip_id');
      iDep = header.indexOf('departure_time');
      iStop = header.indexOf('stop_id');
      iSeq = header.indexOf('stop_sequence');
      iPickup = header.indexOf('pickup_type');
      iDrop = header.indexOf('drop_off_type');
      continue;
    }
    const c = splitCsv(line);
    const meta = tripMeta.get(c[iTrip]);
    if (!meta) continue;
    const sIdx = stopIdx.get(c[iStop]);
    if (sIdx === undefined) continue;
    // flags: bit0 = zakaz wsiadania (pickup_type=1), bit1 = zakaz wysiadania (drop_off_type=1)
    const flags = (c[iPickup] === '1' ? 1 : 0) | (c[iDrop] === '1' ? 2 : 0);
    let arr = tripStops.get(c[iTrip]);
    if (!arr) { arr = []; tripStops.set(c[iTrip], arr); }
    arr.push([+c[iSeq], sIdx, timeToMin(c[iDep]), flags]);
    if (++n % 500000 === 0) console.log(`  stop_times: ${n}…`);
  }
  console.log(`Wiersze stop_times w wybranych dniach: ${n}`);
}

// --- 5. wzorce tras per dzień --------------------------------------------

const routeNames = [];
const routeNameIdx = new Map();
function routeNameIndex(routeId) {
  const info = routeInfo.get(routeId) ?? { name: '?', type: 0 };
  const key = `${info.name}|${info.type}`;
  if (!routeNameIdx.has(key)) {
    routeNameIdx.set(key, routeNames.length);
    routeNames.push({ n: info.name, t: info.type });
  }
  return routeNameIdx.get(key);
}

function buildDay(dayIdx) {
  // patternKey -> {route, stops:[], flags:[], profiles:Map(deltaKey->idx), profileList, trips:[[startMin, profIdx]]}
  const patterns = new Map();
  for (const [tripId, arr] of tripStops) {
    const meta = tripMeta.get(tripId);
    if (meta.dayIdx !== dayIdx) continue;
    arr.sort((a, b) => a[0] - b[0]);
    const stopSeq = arr.map(x => x[1]);
    const flagSeq = arr.map(x => x[3]);
    const times = arr.map(x => x[2]);
    // czasy muszą być niemalejące; odrzuć kursy uszkodzone
    let ok = true;
    for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) { ok = false; break; }
    if (!ok || times.length < 2) continue;
    const key = meta.routeId + '|' + stopSeq.join(',') + '|' + flagSeq.join(',');
    let p = patterns.get(key);
    if (!p) {
      p = {
        route: routeNameIndex(meta.routeId),
        stops: stopSeq,
        flags: flagSeq,
        profiles: new Map(),
        profileList: [],
        trips: [],
      };
      patterns.set(key, p);
    }
    const deltas = [];
    for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
    const dKey = deltas.join(',');
    let profIdx = p.profiles.get(dKey);
    if (profIdx === undefined) {
      profIdx = p.profileList.length;
      p.profiles.set(dKey, profIdx);
      p.profileList.push(deltas);
    }
    p.trips.push([times[0], profIdx]);
  }
  const out = [];
  for (const p of patterns.values()) {
    p.trips.sort((a, b) => a[0] - b[0]);
    out.push({
      r: p.route,
      s: p.stops,
      f: p.flags.some(f => f) ? p.flags : 0, // 0 = wszystkie bez ograniczeń
      p: p.profileList,
      t: p.trips,
    });
  }
  return out;
}

// --- 6. przesiadki piesze -------------------------------------------------

const WALK_SPEED_MPS = 4.5 / 3.6 / 1.3; // 4,5 km/h w linii prostej ÷ krętość 1,3 ≈ 0,96 m/s
const TRANSFER_MAX_M = 500;

function buildTransfers() {
  // sortowanie po lat, przeszukiwanie okna — O(n·k)
  const idx = stops.map((s, i) => i).sort((a, b) => stops[a].lat - stops[b].lat);
  const maxDLat = TRANSFER_MAX_M / EARTH_M_PER_DEG_LAT;
  const transfers = [];
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a];
    const si = stops[i];
    const cosLat = Math.cos(si.lat * Math.PI / 180);
    for (let b = a + 1; b < idx.length; b++) {
      const j = idx[b];
      const sj = stops[j];
      if (sj.lat - si.lat > maxDLat) break;
      const dy = (sj.lat - si.lat) * EARTH_M_PER_DEG_LAT;
      const dx = (sj.lon - si.lon) * EARTH_M_PER_DEG_LAT * cosLat;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= TRANSFER_MAX_M) {
        transfers.push([i, j, Math.round(dist / WALK_SPEED_MPS)]); // sekundy
      }
    }
  }
  return transfers;
}

// --- 7. zapis --------------------------------------------------------------

fs.mkdirSync(outDir, { recursive: true });

const stopsOut = {
  name: stops.map(s => s.name),
  lat: stops.map(s => Math.round(s.lat * 1e5)),
  lon: stops.map(s => Math.round(s.lon * 1e5)),
  group: stops.map(s => s.group),
};
const transfers = buildTransfers();
console.log(`Przesiadki piesze (pary ≤${TRANSFER_MAX_M} m): ${transfers.length}`);

for (let d = 0; d < dayTypes.length; d++) {
  const patterns = buildDay(d);
  const nTrips = patterns.reduce((s, p) => s + p.t.length, 0);
  const file = path.join(outDir, `${dayTypes[d].key}.json`);
  const payload = {
    version: 1,
    day: dayTypes[d].key,
    date: dayTypes[d].date,
    routes: routeNames,
    stops: stopsOut,
    transfers,
    patterns,
  };
  fs.writeFileSync(file, JSON.stringify(payload));
  const mb = (fs.statSync(file).size / 1e6).toFixed(2);
  console.log(`${dayTypes[d].key}: wzorce=${patterns.length}, kursy=${nTrips}, plik=${mb} MB`);
}

const feedInfo = readCsvSync(path.join(gtfsDir, 'feed_info.txt'))[0] ?? {};
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({
  generated: new Date().toISOString(),
  feedEndDate: feedInfo.feed_end_date ?? null,
  dates: Object.fromEntries(dayTypes.map(d => [d.key, d.date])),
  source: 'ZTM Gdańsk – Otwarte dane (CC BY), https://ckan.multimediagdansk.pl/dataset/tristar',
}, null, 2));
console.log('Gotowe.');
