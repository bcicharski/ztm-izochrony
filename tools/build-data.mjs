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
import { COMPLEX_MAX_M, WALK_MPS, M_PER_DEG_LAT, DAY_KEYS } from '../js/data.js';
import {
  splitCsv, parseCsvText, timeToSec, addFeedServices, commonDateRange,
  candidateDates, selectDayTypes, normalizeStopName, clusterStopGroups, parseStopTimeRow,
  tripTouchesBbox, dropUnusedStops, buildDayPatterns, parseWaterRings, crossesWater,
  transferCandidates, gridCoverage, carryOverMeta,
  assembleDayPayloads,
} from './build-lib.mjs';

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

// czyste funkcje (CSV, kalendarz, wzorce, woda…) — tools/build-lib.mjs;
// tu zostaje tylko I/O i orkiestracja

function readCsvSync(file) {
  if (!fs.existsSync(file)) return [];
  return parseCsvText(fs.readFileSync(file, 'utf8'));
}

// stałe geometryczne i tempo marszu wspólne z frontendem (js/data.js) —
// jedno źródło prawdy, żeby prekompilacja i silnik nie rozjechały się cicho
const EARTH_M_PER_DEG_LAT = M_PER_DEG_LAT;

// --- 1. kalendarze: daty wspólne dla wszystkich feedów -------------------
// Pełna semantyka GTFS: calendar.txt (zakres + flagi dni tygodnia),
// potem wyjątki z calendar_dates (1 = dodaje, 2 = usuwa).

const servicesByDate = new Map(); // date -> Set("feedIdx:service_id")
const feedRanges = [];
feedDirs.forEach((dir, f) => {
  const { min, max } = addFeedServices(
    servicesByDate, f,
    readCsvSync(path.join(dir, 'calendar.txt')),
    readCsvSync(path.join(dir, 'calendar_dates.txt')));
  feedRanges.push({ min, max });
  console.log(`Feed ${f} (${path.basename(dir)}): daty ${min}–${max}`);
});

const { commonMin, commonMax } = commonDateRange(feedRanges);
if (commonMin > commonMax) {
  console.error(`Feedy nie mają wspólnego zakresu dat (${commonMin} > ${commonMax}).`);
  process.exit(1);
}
// tylko daty od dziś — feedy z historią nie mogą podsuwać starych rozkładów
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' })
  .format(new Date()).replaceAll('-', '');
const cand = candidateDates(servicesByDate.keys(), commonMin, commonMax, today);
const allDates = cand.dates;
if (cand.fallback) {
  console.warn('Uwaga: brak dat od dziś we wspólnym zakresie — używam pełnego zakresu.');
}
// data reprezentatywna: najwcześniejsza BEZ święta i dnia specjalnego (święto to
// jednodniowa anomalia — omijamy); reżimu wakacyjnego nie omijamy, tylko
// etykietujemy w meta.dayInfo (rozkład wakacyjny bywa jedynym obowiązującym).
// dayInfo: reżim, święto wybranej daty i święto, które ominęliśmy
const { dayTypes, dayInfo } = selectDayTypes(allDates);
console.log('Wybrane daty:', dayTypes.map(d => {
  const i = dayInfo[d.key];
  return `${d.key}=${d.date} [${i.regime}${i.holiday ? `, święto: ${i.holiday}` : ''}${i.avoidedHoliday ? `, pominięto: ${i.avoidedHoliday}` : ''}]`;
}).join(', '));

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
    const name = normalizeStopName(r.stop_name); // "Wrzeszcz PKP 03" -> "Wrzeszcz PKP"
    stopIdx.set(`${f}:${r.stop_id}`, stops.length);
    stops.push({ name, lat, lon, group: -1 });
  }
});

// zespoły przystankowe: ta sama nazwa + odległość ≤300 m (klastrowanie,
// żeby identyczne nazwy w różnych miastach nie sklejały się w jeden zespół)
const groupCount = clusterStopGroups(stops);
console.log(`Przystanki: ${stops.length}, zespoły: ${groupCount}`);

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
      header = splitCsv(line.replace(/^\uFEFF/, '')).map(h => h.trim());
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
    const row = parseStopTimeRow(c, { iDep, iArr, iStop, iSeq, iPickup, iDrop }, stopIdx, f);
    if (!row) continue;
    let arr = tripStops.get(tripKey);
    if (!arr) { arr = []; tripStops.set(tripKey, arr); }
    arr.push(row);
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
  const prefix = `${f}:`;
  let dropped = 0, kept = 0;
  for (const [tripKey, arr] of tripStops) {
    if (!tripKey.startsWith(prefix)) continue;
    const inBox = tripTouchesBbox(arr, stops, bb);
    if (inBox) kept++;
    else { tripStops.delete(tripKey); tripMeta.delete(tripKey); dropped++; }
  }
  console.log(`Feed ${f} (${path.basename(feedDirs[f])}): filtr bbox — zostawiono ${kept}, usunięto ${dropped} kursów`);
}

// --- 4c. przystanki bez kursów --------------------------------------------
// Feedy zbiorcze (polish_trains.zip) wnoszą ~3000 stacji z całej Polski, które
// żaden zachowany kurs nie odwiedza; puchły w JSON i w każdej pętli po
// przystankach (dojścia, seedy fali, dymek). Zostają tylko odwiedzane, indeksy
// w kursach są przenumerowane; grupy zespołów zachowują numery (mogą mieć luki).
{
  const before = stops.length;
  const removed = dropUnusedStops(stops, tripStops, stopIdx);
  if (removed) console.log(`Przystanki bez kursów usunięte: ${removed} (zostaje ${before - removed})`);
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

// statystyki rozbijania wyprzedzających się kursów z ostatniego buildDay
let overtakeStats = { overtaking: 0, extraEntries: 0, ms: 0 };

function buildDay(dayIdx) {
  const t0 = Date.now();
  const { patterns, stats } = buildDayPatterns({ tripStops, tripMeta, frequencies, routeNameIndex }, dayIdx);
  overtakeStats = { ...stats, ms: Date.now() - t0 };
  return patterns;
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
  return parseWaterRings(JSON.parse(fs.readFileSync(file, 'utf8')));
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
  const cand = transferCandidates(stops, TRANSFER_MAX_M, WALK_SPEED_MPS, EARTH_M_PER_DEG_LAT);

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

const dayCounts = {}; // metryki dla bramki jakości (tools/check-data.mjs)
// listę linii uzupełnia leniwie buildDay, więc budujemy wszystkie dni przed zapisem
// pierwszego pliku — każdy plik dnia niesie wtedy pełną listę (Z-080)
const overtakeByDay = [];
const dayPayloads = assembleDayPayloads({
  dayTypes,
  buildDay: d => { const p = buildDay(d); overtakeByDay[d] = overtakeStats; return p; },
  routeList, stopsOut, transfers,
  version: 3, // v3: czasy w sekundach + opcjonalne postoje (pole d); v2 = minuty, bez d
});
for (let d = 0; d < dayTypes.length; d++) {
  const { payload, patterns } = dayPayloads[d];
  const nTrips = patterns.reduce((s, p) => s + p.t.length, 0);
  const file = path.join(outDir, `${dayTypes[d].key}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));
  const bytes = fs.statSync(file).size;
  overtakeStats = overtakeByDay[d];
  dayCounts[dayTypes[d].key] = { patterns: patterns.length, trips: nTrips, bytes, overtaking: overtakeStats.overtaking };
  console.log(`${dayTypes[d].key}: wzorce=${patterns.length}, kursy=${nTrips}, plik=${(bytes / 1e6).toFixed(2)} MB, wyprzedzanie: rozbito ${overtakeStats.overtaking} wzorców (+${overtakeStats.extraEntries} wpisów, ${overtakeStats.ms} ms)`);
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

// pokrycie siatki pieszej: przystanki poza gridBbox/bbox to znany tryb degradacji
// (router nie ma dla nich dojść pieszych)
const { outsideStops, maxOutsideM } = gridCoverage(
  stopsOut, cities[cityKey].gridBbox ?? cities[cityKey].bbox, M_PER_DEG_LAT);

// pola dopisywane przez inne skrypty (delays z build-delays.mjs) przenosimy z poprzedniego
// meta.json — przebudowa od zera inaczej gubi je po każdym odświeżeniu danych
let prevMeta = null;
try { prevMeta = JSON.parse(fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8')); } catch { /* brak lub uszkodzony */ }
const carried = carryOverMeta(prevMeta, { delaysFileExists: fs.existsSync(path.join(outDir, 'delays.json')) });

fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({
  city: cityKey,
  generated: new Date().toISOString(),
  feedEndDate: commonMax,
  dates: Object.fromEntries(dayTypes.map(d => [d.key, d.date])),
  dayInfo, // reżim (szkolny/wakacje/przerwa świąteczna) i święta wybranych dat
  sources: cities[cityKey].credits.map(c => `${c.label} — ${c.url}`),
  routeNames, // route_id -> nazwa linii (dla kolektora opóźnień GTFS-RT)
  counts: { stops: stopsOut.name.length, routes: routeList.length, transfers: transfers.length, days: dayCounts },
  grid: {
    outsideStops,
    outsideShare: +(outsideStops / Math.max(1, stopsOut.name.length)).toFixed(4),
    maxOutsideKm: +(maxOutsideM / 1000).toFixed(1),
  },
  ...carried,
}, null, 2));
console.log('Gotowe.');
