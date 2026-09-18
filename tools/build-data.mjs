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
 *
 * Format wyjścia v3: czasy w SEKUNDACH (v2 był w minutach — obcinał sekundy,
 * zawyżając krótkie odcinki, np. SKM Gdańsk). Każdy przystanek ma osobno odjazd
 * (delty w polu p) i postój (pole d, dep−arr); czysty przejazd = arr[i+1]−dep[i].
 * Pole d pomijane, gdy wszystkie postoje zerowe (feedy z rozdzielczością minutową,
 * gdzie arrival_time == departure_time). Dekoder w js/data.js czyta v2 i v3.
 *
 * Opcjonalne per-feed filtry (pola w danym feedzie w data/cities.json, dopasowane
 * po nazwie katalogu = feed.name); używane do wyłuskania jednego przewoźnika/
 * regionu z feedu zbiorczego (np. PolRegio-Pomorze z ogólnopolskiego
 * polish_trains.zip):
 *   - keepAgency: ["PR", ...] — zostaw tylko trasy o tym agency_id (routes.txt),
 *   - keepBbox: [minLat, minLon, maxLat, maxLon] — zostaw tylko kursy z ≥1
 *     przystankiem w tym prostokącie (pełny przebieg kursu zachowany, także
 *     przystanki poza bboxem — dojazd dalekobieżny liczy się jak zwykle).
 *
 * Czasy przesiadek pieszych (pole transfers) liczone są po grafie dróg z OSM,
 * jeśli miasto ma już data/<miasto>/walknet.json — patrz sekcja 6. Bez tego
 * pliku zostaje dawne przybliżenie w linii prostej.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { decodeWalkNet, snapEdges, snapSeeds, snapTime, sameEdgeSec, computeNodeTimes, NET_WALK_MPS } from '../js/walknet.js';
import { COMPLEX_MAX_M, WALK_MPS, M_PER_DEG_LAT, DAY_KEYS, distM } from '../js/data.js';

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
// konfiguracja per-feed z cities.json (dopasowanie po nazwie katalogu = feed.name):
// keepAgency / keepBbox — filtry wyłuskujące przewoźnika/region z feedu zbiorczego
const feedCfgByName = new Map((cities[cityKey].feeds ?? []).map(fe => [fe.name, fe]));
const feedCfg = feedDirs.map(d => feedCfgByName.get(path.basename(d)) ?? {});

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

/** "28:16:30" -> sekundy od północy (może przekraczać 86400). */
function timeToSec(t) {
  const [h, m, s] = t.split(':');
  return (+h) * 3600 + (+m) * 60 + (+s || 0);
}

function dateToWeekday(yyyymmdd) {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=nd, 6=sob
}

// stałe geometryczne i tempo marszu wspólne z frontendem (js/data.js) —
// jedno źródło prawdy, żeby prekompilacja i silnik nie rozjechały się cicho
const EARTH_M_PER_DEG_LAT = M_PER_DEG_LAT;
const distMeters = distM;

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

const routeInfo = new Map(); // "f:route_id" -> {name, type, agency}
const tripMeta = new Map();  // "f:trip_id" -> {routeKey, dayMask}
// route_id (surowe, bez prefiksu feedu) -> nazwa linii; zapisywane do meta.json,
// bo feedy GTFS-RT identyfikują kursy po route_id (np. Kraków tramwaje
// "route_5" = linia "40"), a silnik i profile opóźnień operują na nazwie
const routeNames = {};
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
      routeInfo.set(`${f}:${r.route_id}`, { name, type: +r.route_type, agency: r.agency_id ?? '' });
      if (routeNames[r.route_id] && routeNames[r.route_id] !== name) {
        console.warn(`Uwaga: route_id "${r.route_id}" w kilku feedach z różną nazwą (${routeNames[r.route_id]} / ${name}).`);
      }
      routeNames[r.route_id] ??= name;
    }
    const keepAgency = feedCfg[f].keepAgency; // filtr przewoźnika (feed zbiorczy)
    for (const t of readCsvSync(path.join(dir, 'trips.txt'))) {
      const mask = serviceDayMask.get(`${f}:${t.service_id}`);
      if (!mask) continue;
      if (keepAgency && !keepAgency.includes(routeInfo.get(`${f}:${t.route_id}`)?.agency)) continue;
      tripMeta.set(`${f}:${t.trip_id}`, { routeKey: `${f}:${t.route_id}`, dayMask: mask });
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
      timeToSec(r.start_time),
      timeToSec(r.end_time),
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

// tripKey -> tablica [stopSeq, stopIndex, depSec, arrSec, flags]
// depSec i arrSec osobno: różnica arr[i+1]−dep[i] to czysty przejazd (bez postoju),
// a dep[i]−arr[i] to postój — rozdzielenie usuwa zawyżanie czasów (np. SKM, gdzie
// rozkład ma sekundy i realne postoje; feedy minutowe mają arr==dep, więc postój=0)
const tripStops = new Map();
for (let f = 0; f < feedDirs.length; f++) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(feedDirs[f], 'stop_times.txt')),
    crlfDelay: Infinity,
  });
  let header = null, n = 0;
  let iTrip, iDep, iArr, iStop, iSeq, iPickup, iDrop;
  for await (const line of rl) {
    if (!header) {
      header = splitCsv(line.replace(/^﻿/, '')).map(h => h.trim());
      iTrip = header.indexOf('trip_id');
      iDep = header.indexOf('departure_time');
      iArr = header.indexOf('arrival_time');
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
    const depSec = timeToSec(c[iDep]);
    const arrSec = iArr >= 0 && c[iArr] ? timeToSec(c[iArr]) : depSec;
    let arr = tripStops.get(tripKey);
    if (!arr) { arr = []; tripStops.set(tripKey, arr); }
    arr.push([+c[iSeq], sIdx, depSec, arrSec, flags]);
    if (++n % 500000 === 0) console.log(`  stop_times feed ${f}: ${n}…`);
  }
  console.log(`Feed ${f}: wierszy stop_times w wybranych dniach: ${n}`);
}

// --- 4b. filtr geograficzny per-feed (keepBbox) --------------------------
// Feed zbiorczy (np. polish_trains.zip): zostaw tylko kursy dotykające regionu.
// Warunek liczony po zbudowaniu tripStops, bo potrzebne są współrzędne
// przystanków; cały przebieg kursu zostaje (dalekie przystanki jak zwykle).
for (let f = 0; f < feedDirs.length; f++) {
  const bb = feedCfg[f].keepBbox;
  if (!bb) continue;
  const [minLat, minLon, maxLat, maxLon] = bb;
  const prefix = `${f}:`;
  let dropped = 0, kept = 0;
  for (const [tripKey, arr] of tripStops) {
    if (!tripKey.startsWith(prefix)) continue;
    const inBox = arr.some(([, sIdx]) => {
      const s = stops[sIdx];
      return s.lat >= minLat && s.lat <= maxLat && s.lon >= minLon && s.lon <= maxLon;
    });
    if (inBox) kept++;
    else { tripStops.delete(tripKey); tripMeta.delete(tripKey); dropped++; }
  }
  console.log(`Feed ${f} (${path.basename(feedDirs[f])}): filtr bbox — zostawiono ${kept}, usunięto ${dropped} kursów`);
}

// --- 5. wzorce tras per dzień --------------------------------------------

const routeList = [];
const routeNameIdx = new Map();
function routeNameIndex(routeKey) {
  const info = routeInfo.get(routeKey) ?? { name: '?', type: 0 };
  const key = `${info.name}|${info.type}`;
  if (!routeNameIdx.has(key)) {
    routeNameIdx.set(key, routeList.length);
    routeList.push({ n: info.name, t: info.type });
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
    const flagSeq = arr.map(x => x[4]);
    const times = arr.map(x => x[2]); // odjazdy [s]
    const arrs = arr.map(x => x[3]);  // przyjazdy [s]
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
        dwellList: [],
        trips: [],
      };
      patterns.set(key, p);
    }
    // delty odjazd-odjazd [s] + postoje [s] (dep−arr; skrajne przystanki = 0)
    const deltas = [];
    for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
    const dwell = times.map((dep, i) =>
      (i === 0 || i === times.length - 1) ? 0 : Math.max(0, dep - arrs[i]));
    const dKey = deltas.join(',') + ';' + dwell.join(',');
    let profIdx = p.profiles.get(dKey);
    if (profIdx === undefined) {
      profIdx = p.profileList.length;
      p.profiles.set(dKey, profIdx);
      p.profileList.push(deltas);
      p.dwellList.push(dwell);
    }
    const freq = frequencies.get(tripKey);
    if (freq) {
      // kurs częstotliwościowy: starty co headway w każdym oknie
      for (const [startSec, endSec, headway] of freq) {
        for (let s = startSec; s < endSec; s += headway) {
          p.trips.push([s, profIdx]);
        }
      }
    } else {
      p.trips.push([times[0], profIdx]);
    }
  }
  const out = [];
  for (const p of patterns.values()) {
    p.trips.sort((a, b) => a[0] - b[0]);
    // pole d (postoje) pomijamy, gdy wszystkie zerowe (feedy minutowe) — mniejszy plik
    const anyDwell = p.dwellList.some(dw => dw.some(x => x));
    const entry = {
      r: p.route,
      s: p.stops,
      f: p.flags.some(f => f) ? p.flags : 0,
      p: p.profileList,
      t: p.trips,
    };
    if (anyDwell) entry.d = p.dwellList;
    out.push(entry);
  }
  return out;
}

// --- 6. przesiadki piesze -------------------------------------------------

const WALK_SPEED_MPS = WALK_MPS; // 4,5 km/h w linii prostej ÷ krętość 1,3 ≈ 0,96 m/s (js/data.js)
const TRANSFER_MAX_M = 500;
/**
 * Budżet przesiadki pieszej [s] po sieci ulic: 650 m marszu przy NET_WALK_MPS.
 * 650 = TRANSFER_MAX_M × 1,3, czyli tyle, ile dawny ryczałt krętości zakładał
 * dla pary oddalonej o 500 m w linii prostej — budżet CZASU zostaje ten sam,
 * zmienia się tylko sposób jego mierzenia (realna droga zamiast prostej).
 */
const TRANSFER_MAX_NET_S = Math.round((TRANSFER_MAX_M * 1.3) / NET_WALK_MPS);

/** Sieć piesza miasta (data/<miasto>/walknet.json) albo null, gdy jej nie ma. */
function loadWalkNetFile() {
  const file = path.join(outDir, 'walknet.json');
  if (!fs.existsSync(file)) return null;
  return decodeWalkNet(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/**
 * Linie wody miasta (brzegi akwenów + osie rzek/kanałów) z bboxem każdego
 * pierścienia — do sprawdzenia, czy parę przystanków dzieli woda.
 */
function loadWaterRings() {
  const file = path.join(outDir, 'water.json');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  for (const ring of [...(raw.polys ?? []), ...(raw.lines ?? [])]) {
    if (ring.length < 2) continue;
    let latS = 90, latN = -90, lonW = 180, lonE = -180;
    const pts = ring.map(([la, lo]) => {
      const lat = la / 1e5, lon = lo / 1e5;
      if (lat < latS) latS = lat;
      if (lat > latN) latN = lat;
      if (lon < lonW) lonW = lon;
      if (lon > lonE) lonE = lon;
      return [lat, lon];
    });
    out.push({ pts, latS, latN, lonW, lonE });
  }
  return out;
}

/** Czy odcinki AB i CD się przecinają (test orientacji; stopnie wystarczą). */
function segmentsCross(aLat, aLon, bLat, bLon, cLat, cLon, dLat, dLon) {
  const side = (pLat, pLon, qLat, qLon, rLat, rLon) =>
    Math.sign((qLon - pLon) * (rLat - pLat) - (qLat - pLat) * (rLon - pLon));
  return side(aLat, aLon, bLat, bLon, cLat, cLon) !== side(aLat, aLon, bLat, bLon, dLat, dLon)
    && side(cLat, cLon, dLat, dLon, aLat, aLon) !== side(cLat, cLon, dLat, dLon, bLat, bLon);
}

/** Czy linia prosta między dwoma punktami przecina jakąkolwiek linię wody. */
function crossesWater(rings, aLat, aLon, bLat, bLon) {
  const latMin = Math.min(aLat, bLat), latMax = Math.max(aLat, bLat);
  const lonMin = Math.min(aLon, bLon), lonMax = Math.max(aLon, bLon);
  for (const r of rings) {
    if (latMin > r.latN || latMax < r.latS || lonMin > r.lonE || lonMax < r.lonW) continue;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const [pLat, pLon] = r.pts[k], [qLat, qLon] = r.pts[k + 1];
      if (segmentsCross(aLat, aLon, bLat, bLon, pLat, pLon, qLat, qLon)) return true;
    }
  }
  return false;
}

/**
 * Pary przystanków w zasięgu przesiadki pieszej: [i, j, sekundy].
 *
 * Kandydaci wybierani jak dotąd po linii prostej (≤TRANSFER_MAX_M), ale CZAS
 * liczony po grafie dróg z OSM — inaczej dwa brzegi kanału oddalone o 300 m
 * są przesiadką, choć realnie dzieli je kilometrowy objazd mostem. Para bez
 * trasy w budżecie TRANSFER_MAX_NET_S jest odrzucana; to właśnie odcina
 * przesiadki „przez wodę".
 *
 * Linia prosta zostaje tam, gdzie graf nie ma nic do powiedzenia:
 *   - brak pliku walknet.json,
 *   - przystanek dalej niż SNAP_MAX_M od jakiejkolwiek drogi,
 *   - para bliższa niż COMPLEX_MAX_M (jeden węzeł w terenie), której NIE dzieli
 *     woda. Zmierzone na Trójmieście: przy twardym odrzucaniu wypadały pary
 *     w obrębie jednego węzła — dwa słupki „Węzeł Groddecka" 20 m od siebie
 *     (graf: 2000 m), stacja SKM Kamienny Potok i przystanek przy
 *     Niepodległości 100 m od siebie (graf: 1195 m), przystanki przy drodze
 *     krajowej, która jako `trunk` nie wchodzi do sieci pieszej (Gowino).
 *     Na takim dystansie dziura w OSM jest częstsza niż realny objazd, a strata
 *     boli podwójnie: te same pary budują `sameGroupAdj` (przesiadki w trybie
 *     bez spaceru). Wyjątek nie dotyczy par przedzielonych wodą — tam objazd
 *     jest realny i o to w całym mechanizmie chodzi.
 */
function buildTransfers() {
  const idx = stops.map((_, i) => i).sort((a, b) => stops[a].lat - stops[b].lat);
  const maxDLat = TRANSFER_MAX_M / EARTH_M_PER_DEG_LAT;
  const cand = new Map(); // i -> [[j, sekundyWLiniiProstej, metry], ...]
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a];
    const si = stops[i];
    for (let b = a + 1; b < idx.length; b++) {
      const j = idx[b];
      const sj = stops[j];
      if (sj.lat - si.lat > maxDLat) break;
      const dist = distMeters(si.lat, si.lon, sj.lat, sj.lon);
      if (dist <= TRANSFER_MAX_M) {
        if (!cand.has(i)) cand.set(i, []);
        cand.get(i).push([j, Math.round(dist / WALK_SPEED_MPS), dist]); // sekundy
      }
    }
  }

  const wnet = loadWalkNetFile();
  const transfers = [];
  if (!wnet) {
    for (const [i, list] of cand) for (const [j, sec] of list) transfers.push([i, j, sec]);
    console.log('Brak walknet.json — czasy przesiadek liczone w linii prostej.');
    return transfers;
  }
  const water = loadWaterRings();

  // przyłączenie przystanków do grafu (raz): rzut na krawędzie (lista
  // kandydatek) — ta sama reguła co w js/app.js (snapEdges/snapSeeds/snapTime)
  const snap = stops.map(s => snapEdges(wnet, s.lat, s.lon));

  let nNet = 0, nCrow = 0, nNear = 0, nDropped = 0;
  for (const [i, list] of cand) {
    if (!snap[i].length) {
      for (const [j, sec] of list) { transfers.push([i, j, sec]); nCrow++; }
      continue;
    }
    const t = computeNodeTimes(wnet, snapSeeds(snap[i], 0), TRANSFER_MAX_NET_S);
    for (const [j, sec, dist] of list) {
      if (!snap[j].length) { transfers.push([i, j, sec]); nCrow++; continue; }
      const via = snapTime(t, snap[j]); // <0 = poza budżetem marszu
      const netSec = Math.min(via < 0 ? Infinity : via, sameEdgeSec(snap[i], snap[j]));
      if (netSec <= TRANSFER_MAX_NET_S) {
        transfers.push([i, j, netSec]);
        nNet++;
      } else if (dist <= COMPLEX_MAX_M
          && !crossesWater(water, stops[i].lat, stops[i].lon, stops[j].lat, stops[j].lon)) {
        transfers.push([i, j, sec]); // jeden węzeł w terenie, wody między nimi nie ma
        nNear++;
      } else {
        nDropped++;
      }
    }
  }
  console.log(`Przesiadki po sieci ulic: ${nNet}, w linii prostej: ${nCrow} (przystanek poza siecią) + ${nNear} (≤${COMPLEX_MAX_M} m bez wody między nimi), odrzucone (brak dojścia ≤${TRANSFER_MAX_NET_S} s): ${nDropped}`);
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
    version: 3, // v3: czasy w sekundach + opcjonalne postoje (pole d); v2 = minuty, bez d
    day: dayTypes[d].key,
    date: dayTypes[d].date,
    routes: routeList,
    stops: stopsOut,
    transfers,
    patterns,
  };
  fs.writeFileSync(file, JSON.stringify(payload));
  const mb = (fs.statSync(file).size / 1e6).toFixed(2);
  console.log(`${dayTypes[d].key}: wzorce=${patterns.length}, kursy=${nTrips}, plik=${mb} MB`);
}

// typ dnia, którego nie dało się zbudować (feed za krótki na weekend), nie może
// zostać w katalogu z poprzedniego builda — frontend czyta meta.dates, ale stary
// plik i tak wprowadzałby w błąd (inny okres rozkładowy niż dzień roboczy)
for (const key of DAY_KEYS) {
  if (dayTypes.some(d => d.key === key)) continue;
  const stale = path.join(outDir, `${key}.json`);
  if (fs.existsSync(stale)) {
    fs.rmSync(stale);
    console.warn(`Usunięto nieaktualny ${key}.json — feed nie obejmuje tego typu dnia.`);
  }
}

fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({
  city: cityKey,
  generated: new Date().toISOString(),
  feedEndDate: commonMax,
  dates: Object.fromEntries(dayTypes.map(d => [d.key, d.date])),
  sources: cities[cityKey].credits.map(c => `${c.label} — ${c.url}`),
  routeNames, // route_id -> nazwa linii (dla kolektora opóźnień GTFS-RT)
}, null, 2));
console.log('Gotowe.');
