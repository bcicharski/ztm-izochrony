#!/usr/bin/env node
/**
 * Prekompilacja danych GTFS (jeden lub więcej feedów) do kompaktowych plików
 * JSON czytanych przez frontend (data/<miasto>/{workday,saturday,sunday,meta}.json).
 *
 * Użycie:
 *   node tools/build-data.mjs <miasto> <katalog-GTFS> [<katalog-GTFS> ...]
 *   (miasto = klucz z data/cities.json, np. trojmiasto, warszawa, krakow)
 *
 * Obsługiwane warianty GTFS:
 *   - kursowanie przez calendar_dates (ZTM Gdańsk, ZKM Gdynia, SKM, Warszawa),
 *   - pełny calendar.txt z flagami dni tygodnia + wyjątki (Kraków, Wrocław),
 *   - kursy częstotliwościowe frequencies.txt (metro warszawskie).
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const cityKey = process.argv[2];
const feedDirs = process.argv.slice(3);
const citiesFile = path.join(import.meta.dirname, '..', 'data', 'cities.json');
const cities = JSON.parse(fs.readFileSync(citiesFile, 'utf8'));
if (!cities[cityKey]) {
  console.error(`Nieznane miasto "${cityKey}". Dostępne: ${Object.keys(cities).join(', ')}`);
  process.exit(1);
}
const outDir = path.join(import.meta.dirname, '..', 'data', cityKey);
if (!feedDirs.length || !feedDirs.every(d => fs.existsSync(path.join(d, 'stop_times.txt')))) {
  console.error('Podaj katalogi z rozpakowanymi GTFS (każdy musi zawierać stop_times.txt).');
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
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.length);
  const header = splitCsv(lines[0]);
  return lines.slice(1).map(l => {
    const cells = splitCsv(l);
    const row = {};
    header.forEach((h, i) => row[h.trim()] = cells[i] ?? '');
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

function distMeters(aLat, aLon, bLat, bLon) {
  const dy = (bLat - aLat) * EARTH_M_PER_DEG_LAT;
  const dx = (bLon - aLon) * EARTH_M_PER_DEG_LAT * Math.cos(aLat * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

// --- 1. kalendarze: daty wspólne dla wszystkich feedów -------------------
// Pełna semantyka GTFS: calendar.txt (zakres + flagi dni tygodnia),
// potem wyjątki z calendar_dates (1 = dodaje, 2 = usuwa).

function* datesBetween(min, max, capDays = 120) {
  let y = +min.slice(0, 4), m = +min.slice(4, 6) - 1, d = +min.slice(6, 8);
  const cur = new Date(Date.UTC(y, m, d));
  for (let i = 0; i < capDays; i++) {
    const s = cur.toISOString().slice(0, 10).replaceAll('-', '');
    if (s > max) return;
    yield s;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

const WEEKDAY_COLS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const servicesByDate = new Map(); // date -> Set("feedIdx:service_id")
const feedRanges = [];
feedDirs.forEach((dir, f) => {
  let min = '99999999', max = '00000000';
  const add = (date, sid) => {
    if (!servicesByDate.has(date)) servicesByDate.set(date, new Set());
    servicesByDate.get(date).add(`${f}:${sid}`);
    if (date < min) min = date;
    if (date > max) max = date;
  };
  const remove = (date, sid) => servicesByDate.get(date)?.delete(`${f}:${sid}`);

  for (const r of readCsvSync(path.join(dir, 'calendar.txt'))) {
    if (!WEEKDAY_COLS.some(c => r[c] === '1')) continue; // np. SKM: same zera
    for (const date of datesBetween(r.start_date, r.end_date)) {
      if (r[WEEKDAY_COLS[dateToWeekday(date)]] === '1') add(date, r.service_id);
    }
  }
  for (const r of readCsvSync(path.join(dir, 'calendar_dates.txt'))) {
    if (r.exception_type === '1') add(r.date, r.service_id);
    else if (r.exception_type === '2') remove(r.date, r.service_id);
  }
  feedRanges.push({ min, max });
  console.log(`Feed ${f} (${path.basename(dir)}): daty ${min}–${max}`);
});

const commonMin = feedRanges.map(r => r.min).sort().at(-1);
const commonMax = feedRanges.map(r => r.max).sort()[0];
if (commonMin > commonMax) {
  console.error(`Feedy nie mają wspólnego zakresu dat (${commonMin} > ${commonMax}).`);
  process.exit(1);
}
// tylko daty od dziś — feedy z historią nie mogą podsuwać starych rozkładów
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' })
  .format(new Date()).replaceAll('-', '');
let allDates = [...servicesByDate.keys()]
  .filter(d => d >= commonMin && d <= commonMax && d >= today)
  .sort();
if (!allDates.length) {
  console.warn('Uwaga: brak dat od dziś we wspólnym zakresie — używam pełnego zakresu.');
  allDates = [...servicesByDate.keys()].filter(d => d >= commonMin && d <= commonMax).sort();
}
const pickDate = pred => allDates.find(d => pred(dateToWeekday(d)));
const dayTypes = [
  { key: 'workday', date: pickDate(w => w >= 2 && w <= 4) ?? pickDate(w => w >= 1 && w <= 5) },
  { key: 'saturday', date: pickDate(w => w === 6) },
  { key: 'sunday', date: pickDate(w => w === 0) },
].filter(d => d.date);
console.log('Wybrane daty:', dayTypes.map(d => `${d.key}=${d.date}`).join(', '));

// --- 2. linie i kursy (usługa może kursować w kilku wybranych dniach) -----

const routeInfo = new Map(); // "f:route_id" -> {name, type}
const tripMeta = new Map();  // "f:trip_id" -> {routeKey, dayMask}
{
  const serviceDayMask = new Map(); // "f:service_id" -> bitmask dni
  dayTypes.forEach((d, i) => {
    for (const s of servicesByDate.get(d.date)) {
      serviceDayMask.set(s, (serviceDayMask.get(s) ?? 0) | (1 << i));
    }
  });
  feedDirs.forEach((dir, f) => {
    for (const r of readCsvSync(path.join(dir, 'routes.txt'))) {
      // GZM zostawia route_short_name puste, a numer linii trzyma w long_name
      const name = r.route_short_name || r.route_long_name || r.route_id;
      routeInfo.set(`${f}:${r.route_id}`, { name, type: +r.route_type });
    }
    for (const t of readCsvSync(path.join(dir, 'trips.txt'))) {
      const mask = serviceDayMask.get(`${f}:${t.service_id}`);
      if (mask) tripMeta.set(`${f}:${t.trip_id}`, { routeKey: `${f}:${t.route_id}`, dayMask: mask });
    }
  });
}
console.log(`Kursy w wybranych dniach: ${tripMeta.size}`);

// kursy częstotliwościowe (frequencies.txt, np. metro warszawskie):
// tripKey -> [[startSec, endSec, headwaySec], ...]
const frequencies = new Map();
feedDirs.forEach((dir, f) => {
  for (const r of readCsvSync(path.join(dir, 'frequencies.txt'))) {
    const key = `${f}:${r.trip_id}`;
    if (!tripMeta.has(key)) continue;
    if (!frequencies.has(key)) frequencies.set(key, []);
    frequencies.get(key).push([
      timeToMin(r.start_time) * 60 + (+r.start_time.split(':')[2] || 0),
      timeToMin(r.end_time) * 60 + (+r.end_time.split(':')[2] || 0),
      +r.headway_secs,
    ]);
  }
});
if (frequencies.size) console.log(`Kursy częstotliwościowe: ${frequencies.size}`);

// --- 3. przystanki -------------------------------------------------------

const stopIdx = new Map();   // "f:stop_id" -> index
const stops = [];            // {name, lat, lon, group}
feedDirs.forEach((dir, f) => {
  for (const r of readCsvSync(path.join(dir, 'stops.txt'))) {
    if (r.location_type === '1') continue; // stacje-rodzice (GTFS): używamy peronów
    const lat = +r.stop_lat, lon = +r.stop_lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = r.stop_name.trim().replace(/ \d+$/, ''); // "Wrzeszcz PKP 03" -> "Wrzeszcz PKP"
    stopIdx.set(`${f}:${r.stop_id}`, stops.length);
    stops.push({ name, lat, lon, group: -1 });
  }
});

// zespoły przystankowe: ta sama nazwa + odległość ≤300 m (klastrowanie,
// żeby identyczne nazwy w różnych miastach nie sklejały się w jeden zespół)
{
  const byName = new Map();
  stops.forEach((s, i) => {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(i);
  });
  let groupCount = 0;
  for (const idxs of byName.values()) {
    // union-find w ramach nazwy
    const parent = idxs.map((_, k) => k);
    const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const sa = stops[idxs[a]], sb = stops[idxs[b]];
        if (distMeters(sa.lat, sa.lon, sb.lat, sb.lon) <= 300) {
          parent[find(a)] = find(b);
        }
      }
    }
    const rootGroup = new Map();
    for (let k = 0; k < idxs.length; k++) {
      const root = find(k);
      if (!rootGroup.has(root)) rootGroup.set(root, groupCount++);
      stops[idxs[k]].group = rootGroup.get(root);
    }
  }
  console.log(`Przystanki: ${stops.length}, zespoły: ${groupCount}`);
}

// --- 4. stop_times (streaming, wszystkie feedy) ----------------------------

// tripKey -> tablica [stopSeq, stopIndex, depMin, flags]
const tripStops = new Map();
for (let f = 0; f < feedDirs.length; f++) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(feedDirs[f], 'stop_times.txt')),
    crlfDelay: Infinity,
  });
  let header = null, n = 0;
  let iTrip, iDep, iStop, iSeq, iPickup, iDrop;
  for await (const line of rl) {
    if (!header) {
      header = splitCsv(line.replace(/^﻿/, '')).map(h => h.trim());
      iTrip = header.indexOf('trip_id');
      iDep = header.indexOf('departure_time');
      iStop = header.indexOf('stop_id');
      iSeq = header.indexOf('stop_sequence');
      iPickup = header.indexOf('pickup_type');
      iDrop = header.indexOf('drop_off_type');
      continue;
    }
    const c = splitCsv(line);
    const tripKey = `${f}:${c[iTrip]}`;
    if (!tripMeta.has(tripKey)) continue;
    const sIdx = stopIdx.get(`${f}:${c[iStop]}`);
    if (sIdx === undefined) continue;
    // flags: bit0 = zakaz wsiadania (pickup_type=1), bit1 = zakaz wysiadania (drop_off_type=1)
    const flags = ((iPickup >= 0 && c[iPickup] === '1') ? 1 : 0) |
                  ((iDrop >= 0 && c[iDrop] === '1') ? 2 : 0);
    let arr = tripStops.get(tripKey);
    if (!arr) { arr = []; tripStops.set(tripKey, arr); }
    arr.push([+c[iSeq], sIdx, timeToMin(c[iDep]), flags]);
    if (++n % 500000 === 0) console.log(`  stop_times feed ${f}: ${n}…`);
  }
  console.log(`Feed ${f}: wierszy stop_times w wybranych dniach: ${n}`);
}

// --- 5. wzorce tras per dzień --------------------------------------------

const routeNames = [];
const routeNameIdx = new Map();
function routeNameIndex(routeKey) {
  const info = routeInfo.get(routeKey) ?? { name: '?', type: 0 };
  const key = `${info.name}|${info.type}`;
  if (!routeNameIdx.has(key)) {
    routeNameIdx.set(key, routeNames.length);
    routeNames.push({ n: info.name, t: info.type });
  }
  return routeNameIdx.get(key);
}

function buildDay(dayIdx) {
  const patterns = new Map();
  for (const [tripKey, arr] of tripStops) {
    const meta = tripMeta.get(tripKey);
    if (!(meta.dayMask & (1 << dayIdx))) continue;
    arr.sort((a, b) => a[0] - b[0]);
    const stopSeq = arr.map(x => x[1]);
    const flagSeq = arr.map(x => x[3]);
    const times = arr.map(x => x[2]);
    let ok = true;
    for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) { ok = false; break; }
    if (!ok || times.length < 2) continue;
    const key = meta.routeKey + '|' + stopSeq.join(',') + '|' + flagSeq.join(',');
    let p = patterns.get(key);
    if (!p) {
      p = {
        route: routeNameIndex(meta.routeKey),
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
    const freq = frequencies.get(tripKey);
    if (freq) {
      // kurs częstotliwościowy: starty co headway w każdym oknie
      for (const [startSec, endSec, headway] of freq) {
        for (let s = startSec; s < endSec; s += headway) {
          p.trips.push([Math.round(s / 60), profIdx]);
        }
      }
    } else {
      p.trips.push([times[0], profIdx]);
    }
  }
  const out = [];
  for (const p of patterns.values()) {
    p.trips.sort((a, b) => a[0] - b[0]);
    out.push({
      r: p.route,
      s: p.stops,
      f: p.flags.some(f => f) ? p.flags : 0,
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
  const idx = stops.map((_, i) => i).sort((a, b) => stops[a].lat - stops[b].lat);
  const maxDLat = TRANSFER_MAX_M / EARTH_M_PER_DEG_LAT;
  const transfers = [];
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a];
    const si = stops[i];
    for (let b = a + 1; b < idx.length; b++) {
      const j = idx[b];
      const sj = stops[j];
      if (sj.lat - si.lat > maxDLat) break;
      const dist = distMeters(si.lat, si.lon, sj.lat, sj.lon);
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
    version: 2,
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

fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({
  city: cityKey,
  generated: new Date().toISOString(),
  feedEndDate: commonMax,
  dates: Object.fromEntries(dayTypes.map(d => [d.key, d.date])),
  sources: cities[cityKey].credits.map(c => `${c.label} — ${c.url}`),
}, null, 2));
console.log('Gotowe.');
