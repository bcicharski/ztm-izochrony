#!/usr/bin/env node
/**
 * Konwerter TransXChange 2.5 -> GTFS (stops, routes, trips, stop_times,
 * calendar_dates, agency) na potrzeby tools/build-data.mjs. Napisany pod feed
 * MZK Opole; zasady, których wymaga ten feed:
 *   - jedyny filtr kursów to Extensions/VehicleJourneyKind == 0 (kursy 1-5 to
 *     dojazdy techniczne z dokładnie dwoma przystankami); Route/IsTechnical
 *     służy WYŁĄCZNIE do kontroli krzyżowej;
 *   - sekwencja przystanków = kolejność VehicleJourneyStopPoint w dokumencie
 *     (Sequence jest bezużyteczne), czasy = DepartureTime + RunTime/WaitTime;
 *   - linia kursu wynika z (ServiceRef, LineRef) -> Line/LineName; LineType
 *     NIE jest route_type;
 *   - Activity czytane WYŁĄCZNIE z VehicleJourneyTimingLink, brak flagi
 *     oznacza "dozwolone" (pickup_type/drop_off_type = 0);
 *   - kalendarz: calendar_dates z exception_type=1, service_id = kanoniczny
 *     identyfikator ZBIORU dat (C1, C2, ...).
 * Kontrola krzyżowa (każde ogniwo kursu zgodne z mapą ogniw) jest dowodem
 * poprawności; przekroczenie któregokolwiek progu LIMITS albo niezerowa
 * asercja przerywa konwersję. Pliki trafiają do katalogu feedu dopiero po
 * przejściu całej walidacji (zapis przez <dir>/.tx2gtfs-tmp/).
 *
 * Użycie: node tools/transxchange-to-gtfs.mjs <plik.xml|katalog> [katalog-wyjściowy]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forEachElement, kid, kids, txt, has } from './xmlstream.mjs';

export const LIMITS = {
  minPassengerShare: 0.25,       // kursy kind==0 / wszystkie w korzeniu; dziś 0,585
  minKeptOfPassenger: 0.98,      // zachowane / kind==0;                  dziś 1,000
  maxUnknownKindShare: 0.05,     // bez albo poza znanym VehicleJourneyKind; dziś 0
  max2StopKeptShare: 0.02,       // zachowane kursy o 2 przystankach;     dziś 0
  minBoardableVisitShare: 0.80,  // dziś 0,965
  minAlightableVisitShare: 0.80, // dziś 0,965
  minUsedStops: 450,             // dziś 520
};

const TMP_NAME = '.tx2gtfs-tmp';
const ACTIVITIES = new Set(['pickUp', 'setDown', 'pickUpAndSetDown', 'pass']);
const DAY_MS = 864e5;

// --- czyste funkcje ---------------------------------------------------------

/** 'PT0H12M' / 'PT90S' -> sekundy; nieznany wzorzec = wyjątek. */
export function parseRunTime(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso).trim());
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) {
    throw new Error(`tx2gtfs: nieznany format czasu ISO 8601 "${iso}"`);
  }
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

/** Sekundy od północy -> 'HH:MM:SS' (może przekraczać 24:00:00). */
export function secToGtfsTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function timeOfDay(str, what) {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(str).trim());
  if (!m) throw new Error(`tx2gtfs: błędny czas ${what} "${str}"`);
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

const DOW_GROUPS = {
  Sunday: [0], Monday: [1], Tuesday: [2], Wednesday: [3], Thursday: [4], Friday: [5], Saturday: [6],
  MondayToFriday: [1, 2, 3, 4, 5], MondayToSaturday: [1, 2, 3, 4, 5, 6], MondayToSunday: [0, 1, 2, 3, 4, 5, 6],
  Weekend: [0, 6],
};

/** Węzeł DaysOfWeek -> tablica 7 flag indeksowana jak Date#getUTCDay (0 = nd). Nieznane dziecko = wyjątek. */
export function dayFlagsFromDaysOfWeek(node) {
  const flags = [false, false, false, false, false, false, false];
  for (const k of node.kids) {
    const days = DOW_GROUPS[k.name];
    if (!days) throw new Error(`tx2gtfs: nieznany element DaysOfWeek/${k.name}`);
    for (const d of days) flags[d] = true;
  }
  return flags;
}

function isoToMs(s, what) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`tx2gtfs: błędna data ${what} "${s}"`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

const msToKey = ms => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');

/**
 * OperatingProfile + OperatingPeriod -> posortowana lista dat 'YYYYMMDD':
 * dni tygodnia z RegularDayType przecięte z okresem, minus DaysOfNonOperation.
 * Nieznane dziecko OperatingProfile albo brak RegularDayType = wyjątek.
 */
export function operatingDates(profileNode, periodNode, opts = {}) {
  const maxDays = opts.maxDays ?? 400;
  if (!periodNode || !has(periodNode, 'StartDate') || !has(periodNode, 'EndDate')) {
    throw new Error('tx2gtfs: usługa bez pełnego OperatingPeriod (StartDate/EndDate)');
  }
  if (!profileNode) throw new Error('tx2gtfs: usługa bez OperatingProfile');
  let flags = null;
  const excluded = [];
  for (const k of profileNode.kids) {
    if (k.name === 'RegularDayType') {
      const dows = kids(k, 'DaysOfWeek');
      if (!dows.length || dows.length !== k.kids.length) {
        throw new Error('tx2gtfs: RegularDayType z nieobsługiwaną zawartością');
      }
      flags = flags ?? [false, false, false, false, false, false, false];
      for (const d of dows) dayFlagsFromDaysOfWeek(d).forEach((v, i) => { if (v) flags[i] = true; });
    } else if (k.name === 'DaysOfNonOperation') {
      for (const r of k.kids) {
        if (r.name !== 'DateRange') throw new Error(`tx2gtfs: nieznany element DaysOfNonOperation/${r.name}`);
        const s = isoToMs(txt(r, 'StartDate'), 'StartDate');
        excluded.push([s, has(r, 'EndDate') ? isoToMs(txt(r, 'EndDate'), 'EndDate') : s]);
      }
    } else {
      throw new Error(`tx2gtfs: nieznany element OperatingProfile/${k.name}`);
    }
  }
  if (!flags) throw new Error('tx2gtfs: OperatingProfile bez RegularDayType');
  const start = isoToMs(txt(periodNode, 'StartDate'), 'StartDate');
  const end = isoToMs(txt(periodNode, 'EndDate'), 'EndDate');
  const out = [];
  for (let ms = start, i = 0; ms <= end && i < maxDays; ms += DAY_MS, i++) {
    if (!flags[new Date(ms).getUTCDay()]) continue;
    if (excluded.some(([a, b]) => ms >= a && ms <= b)) continue;
    out.push(msToKey(ms));
  }
  return out;
}

/**
 * Flagi wizyty k (0..n) w kursie o n ogniwach. `links[i] = {from, to}` to
 * Activity z VehicleJourneyTimingLink (albo null). pickup=1 na ostatnim
 * przystanku albo gdy From ogniwa k to pass/setDown; dropOff=1 na pierwszym
 * albo gdy To ogniwa k-1 to pass/pickUp. Brak flagi = dozwolone (0).
 */
export function visitFlags(links, k) {
  const n = links.length;
  const from = k < n ? links[k].from : null;
  const to = k > 0 ? links[k - 1].to : null;
  return {
    pickup: (k === n || from === 'pass' || from === 'setDown') ? 1 : 0,
    dropOff: (k === 0 || to === 'pass' || to === 'pickUp') ? 1 : 0,
  };
}

function readActivity(side, where) {
  const a = txt(side, 'Activity', '') || null;
  if (a !== null && !ACTIVITIES.has(a)) throw new Error(`tx2gtfs: nieznana wartość Activity "${a}" (${where})`);
  return a;
}

/**
 * Kurs (węzeł VehicleJourney) -> przystanki i czasy. ctx = {linkMap, stats}.
 * Sprawdza VJSP == VJTL + 1, brak powtórzeń przystanku pod rząd i zgodność
 * każdego ogniwa z mapą ogniw. Zwraca {code, stopIds, rows}, gdzie
 * rows[k] = {stopId, arr, dep, seq, pickup, dropOff}.
 */
export function journeyStopTimes(journey, ctx) {
  const code = txt(journey, 'VehicleJourneyCode');
  const stopIds = kids(kid(kid(journey, 'Extensions'), 'VehicleJourneyStopPoints'), 'VehicleJourneyStopPoint')
    .map(p => txt(p, 'StopPointRef'));
  const vjtl = kids(journey, 'VehicleJourneyTimingLink');
  if (stopIds.length !== vjtl.length + 1) {
    throw new Error(`tx2gtfs: kurs ${code}: ${stopIds.length} przystanków, ${vjtl.length} ogniw (oczekiwano n+1)`);
  }
  const links = vjtl.map(l => ({
    from: readActivity(kid(l, 'From'), `kurs ${code}`),
    to: readActivity(kid(l, 'To'), `kurs ${code}`),
  }));
  let t = timeOfDay(txt(journey, 'DepartureTime'), `DepartureTime kursu ${code}`);
  const rows = [];
  for (let k = 0; k <= vjtl.length; k++) {
    if (k > 0 && stopIds[k] === stopIds[k - 1]) {
      throw new Error(`tx2gtfs: kurs ${code}: przystanek ${stopIds[k]} powtórzony pod rząd`);
    }
    const arr = t;
    let dep = arr;
    if (k < vjtl.length) {
      const l = vjtl[k];
      const wait = txt(l, 'From/WaitTime');
      if (wait) dep += parseRunTime(wait);
      const linkId = txt(l, 'JourneyPatternTimingLinkRef') || l.attrs.id;
      const m = ctx.linkMap.get(linkId);
      ctx.stats.checkedLinks++;
      if (!m || m.from !== stopIds[k] || m.to !== stopIds[k + 1]) ctx.stats.linkMismatches++;
      if (m?.pass) ctx.stats.passLinksInKeptTrips++;
      const run = txt(l, 'RunTime');
      const runSec = run ? parseRunTime(run) : m?.runTime;
      if (runSec === undefined || runSec === null) throw new Error(`tx2gtfs: kurs ${code}: ogniwo ${linkId} bez RunTime`);
      t = dep + runSec;
    }
    const f = visitFlags(links, k);
    rows.push({ stopId: stopIds[k], arr, dep, seq: k + 1, pickup: f.pickup, dropOff: f.dropOff });
  }
  return { code, stopIds, rows };
}

// --- CSV ---------------------------------------------------------------------

const csvCell = v => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csvLine = arr => arr.map(csvCell).join(',') + '\n';

// --- konwersja ---------------------------------------------------------------

function newReport() {
  return {
    counts: { trips: 0, stops: 0, usedStops: 0, routes: 0, stopTimes: 0, services: 0, calendarSets: 0 },
    dates: { start: '', end: '' },
    journeys: { total: 0, passenger: 0, kept: 0, keptTwoStop: 0, unknownKind: 0 },
    checks: {
      checkedLinks: 0, linkMismatches: 0, linkConflicts: 0, kindRouteDisagreements: 0,
      passLinksInKeptTrips: 0, technicalLinks: 0,
    },
    shares: {},
    routeNames: [],
  };
}

function validate(rep, limits) {
  const j = rep.journeys, c = rep.checks, n = rep.counts;
  const bad = [];
  const sh = rep.shares = {
    passenger: j.total ? j.passenger / j.total : 0,
    keptOfPassenger: j.passenger ? j.kept / j.passenger : 0,
    unknownKind: j.total ? j.unknownKind / j.total : 0,
    twoStopKept: j.kept ? j.keptTwoStop / j.kept : 0,
    boardable: n.stopTimes ? rep.boardable / n.stopTimes : 0,
    alightable: n.stopTimes ? rep.alightable / n.stopTimes : 0,
  };
  if (!(sh.passenger >= limits.minPassengerShare)) bad.push(`udział kursów kind=0 ${sh.passenger.toFixed(3)} < ${limits.minPassengerShare}`);
  if (!(sh.keptOfPassenger >= limits.minKeptOfPassenger)) bad.push(`zachowane/kind=0 ${sh.keptOfPassenger.toFixed(3)} < ${limits.minKeptOfPassenger}`);
  if (!(sh.unknownKind <= limits.maxUnknownKindShare)) bad.push(`kursy bez znanego VehicleJourneyKind ${sh.unknownKind.toFixed(3)} > ${limits.maxUnknownKindShare}`);
  if (!(sh.twoStopKept <= limits.max2StopKeptShare)) bad.push(`zachowane kursy 2-przystankowe ${sh.twoStopKept.toFixed(3)} > ${limits.max2StopKeptShare}`);
  if (!(sh.boardable >= limits.minBoardableVisitShare)) bad.push(`wizyty z wsiadaniem ${sh.boardable.toFixed(3)} < ${limits.minBoardableVisitShare}`);
  if (!(sh.alightable >= limits.minAlightableVisitShare)) bad.push(`wizyty z wysiadaniem ${sh.alightable.toFixed(3)} < ${limits.minAlightableVisitShare}`);
  if (!(n.usedStops >= limits.minUsedStops)) bad.push(`użyte przystanki ${n.usedStops} < ${limits.minUsedStops}`);
  if (c.linkMismatches !== 0) bad.push(`${c.linkMismatches} ogniw kursów niezgodnych z mapą ogniw (z ${c.checkedLinks})`);
  if (c.linkConflicts !== 0) bad.push(`${c.linkConflicts} konfliktów definicji ogniw`);
  if (c.kindRouteDisagreements !== 0) bad.push(`${c.kindRouteDisagreements} kursów, w których VehicleJourneyKind nie zgadza się z Route/IsTechnical`);
  if (c.passLinksInKeptTrips !== 0) {
    bad.push(`w zachowanych kursach pojawiły się ogniwa z Activity=pass (${c.passLinksInKeptTrips}) — semantyka feedu wymaga ponownego przyjrzenia się, zanim te przejazdy zostaną policzone jako zwykłe`);
  }
  if (c.checkedLinks + j.kept !== n.stopTimes) {
    bad.push(`tożsamość ogniwa + kursy = wiersze stop_times nie zachodzi: ${c.checkedLinks} + ${j.kept} != ${n.stopTimes}`);
  }
  if (bad.length) {
    const err = new Error(`tx2gtfs: walidacja nie przeszła:\n  - ${bad.join('\n  - ')}`);
    err.report = rep;
    throw err;
  }
}

/** Konwertuje jeden plik TransXChange do <outDir>; zwraca raport. */
export async function convertFile(xmlPath, outDir, opts = {}) {
  const limits = { ...LIMITS, ...(opts.limits ?? {}) };
  const routeType = opts.routeType ?? 3;
  const tmp = path.join(outDir, TMP_NAME);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const rep = newReport();
  let fd = null;
  try {
    const linkMap = new Map();      // linkId -> {from, to, runTime, pass}
    const stopsOut = new Map();     // stopId -> [name, lat, lon]
    const routeTech = new Map();    // Route@id -> IsTechnical
    const services = new Map();     // ServiceCode -> {lines: Map, setId}
    const dateSets = new Map();     // klucz zbioru dat -> {id, dates}
    const usedSets = new Set();
    const usedStopIds = new Set();
    const tripCodes = new Set();
    const trips = [];               // [trip_id, route_id, service_id]
    const usedLines = new Set();
    let operator = null;
    rep.boardable = 0;
    rep.alightable = 0;
    const stats = rep.checks;
    const ctx = { linkMap, stats };

    fd = fs.openSync(path.join(tmp, 'stop_times.txt'), 'w');
    let pending = [csvLine(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'pickup_type', 'drop_off_type'])];
    let pendingLen = 0;
    const flush = (force) => {
      if (!force && pendingLen < 1 << 20) return;
      fs.writeSync(fd, pending.join(''));
      pending = []; pendingLen = 0;
    };

    const addLink = (id, from, to, runTime, pass, tech) => {
      const prev = linkMap.get(id);
      if (!prev) { linkMap.set(id, { from, to, runTime, pass, tech }); return; }
      if (prev.from !== from || prev.to !== to || (runTime !== null && prev.runTime !== null && prev.runTime !== runTime)) {
        stats.linkConflicts++;
      }
      if (prev.runTime === null) prev.runTime = runTime;
      prev.pass ||= pass;
      prev.tech ||= tech;
    };

    const P = 'TransXChange/';
    const paths = [
      `${P}JourneyPatternSections/JourneyPatternSection/JourneyPatternTimingLink`,
      `${P}StopPoints/StopPoint`,
      `${P}RouteSections/RouteSection/RouteLink`,
      `${P}Routes/Route`,
      `${P}Services/Service`,
      `${P}VehicleJourneys/VehicleJourney`,
      `${P}Operators/LicensedOperator`,
      `${P}Operators/Operator`,
    ];

    const onElement = (node, p) => {
      switch (p.slice(P.length)) {
        case 'JourneyPatternSections/JourneyPatternSection/JourneyPatternTimingLink': {
          const from = kid(node, 'From'), to = kid(node, 'To');
          const id = txt(node, 'RouteLinkRef') || node.attrs.id;
          const rt = txt(node, 'RunTime');
          const pass = txt(from, 'Activity') === 'pass' || txt(to, 'Activity') === 'pass';
          addLink(id, txt(from, 'StopPointRef'), txt(to, 'StopPointRef'), rt ? parseRunTime(rt) : null, pass,
            txt(from, 'Extensions/IsTechnical') === 'true');
          break;
        }
        case 'RouteSections/RouteSection/RouteLink':
          addLink(node.attrs.id, txt(node, 'From/StopPointRef'), txt(node, 'To/StopPointRef'), null, false, false);
          break;
        case 'StopPoints/StopPoint': {
          const id = txt(node, 'AtcoCode');
          const lat = +txt(node, 'Place/Location/Latitude'), lon = +txt(node, 'Place/Location/Longitude');
          if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`tx2gtfs: przystanek ${id || '(bez AtcoCode)'} bez współrzędnych`);
          stopsOut.set(id, [txt(node, 'Descriptor/CommonName'), lat, lon]);
          break;
        }
        case 'Routes/Route':
          routeTech.set(node.attrs.id, txt(node, 'Extensions/IsTechnical') === 'true');
          break;
        case 'Services/Service': {
          const code = txt(node, 'ServiceCode');
          if (!code || services.has(code)) throw new Error(`tx2gtfs: ServiceCode "${code}" pusty albo zduplikowany`);
          const lines = new Map();
          for (const l of kids(kid(node, 'Lines'), 'Line')) {
            const name = txt(l, 'LineName');
            if (lines.has(l.attrs.id) && lines.get(l.attrs.id) !== name) {
              throw new Error(`tx2gtfs: usługa ${code}: Line@id=${l.attrs.id} ma dwie nazwy`);
            }
            lines.set(l.attrs.id, name);
          }
          const dates = operatingDates(kid(node, 'OperatingProfile'), kid(node, 'OperatingPeriod'), opts);
          const key = dates.join(',');
          if (!dateSets.has(key)) dateSets.set(key, { id: `C${dateSets.size + 1}`, dates });
          services.set(code, { lines, setId: dateSets.get(key).id });
          rep.counts.services++;
          break;
        }
        case 'VehicleJourneys/VehicleJourney':
          handleJourney(node);
          break;
        default:
          operator ??= node;
      }
    };

    const handleJourney = (node) => {
      const j = rep.journeys;
      const code = txt(node, 'VehicleJourneyCode');
      if (!code) throw new Error('tx2gtfs: kurs bez VehicleJourneyCode');
      j.total++;
      const kindTxt = txt(node, 'Extensions/VehicleJourneyKind');
      const kind = /^[0-5]$/.test(kindTxt) ? +kindTxt : null;
      const tech = routeTech.get(txt(node, 'JourneyPatternRef'));
      let keep;
      if (kind === null) {
        j.unknownKind++;
        keep = tech === false;
      } else {
        keep = kind === 0;
        if (kind === 0) j.passenger++;
      }
      if (tech !== undefined && kind !== null && (kind === 0) === tech) stats.kindRouteDisagreements++;
      if (!keep) return;
      if (tripCodes.has(code)) throw new Error(`tx2gtfs: zduplikowany VehicleJourneyCode ${code}`);
      tripCodes.add(code);
      const svcRef = txt(node, 'ServiceRef');
      const svc = services.get(svcRef);
      if (!svc) throw new Error(`tx2gtfs: kurs ${code}: nierozwiązany ServiceRef "${svcRef}"`);
      const lineName = svc.lines.get(txt(node, 'LineRef'));
      if (!lineName) throw new Error(`tx2gtfs: kurs ${code}: nierozwiązany LineRef "${txt(node, 'LineRef')}" w usłudze ${svcRef}`);
      const jt = journeyStopTimes(node, ctx);
      for (const r of jt.rows) {
        if (!stopsOut.has(r.stopId)) throw new Error(`tx2gtfs: kurs ${code}: nieznany przystanek ${r.stopId}`);
        usedStopIds.add(r.stopId);
        if (!r.pickup) rep.boardable++;
        if (!r.dropOff) rep.alightable++;
        const line = csvLine([code, secToGtfsTime(r.arr), secToGtfsTime(r.dep), r.stopId, r.seq, r.pickup, r.dropOff]);
        pending.push(line); pendingLen += line.length;
      }
      flush(false);
      rep.counts.stopTimes += jt.rows.length;
      j.kept++;
      if (jt.rows.length === 2) j.keptTwoStop++;
      usedLines.add(lineName);
      usedSets.add(svc.setId);
      trips.push([code, `L-${lineName}`, svc.setId]);
    };

    await forEachElement(fs.createReadStream(xmlPath, { highWaterMark: 1 << 20 }), paths, onElement,
      { skip: new Set(['Track', 'StandardService']) });
    flush(true);
    fs.closeSync(fd); fd = null;

    rep.counts.trips = trips.length;
    rep.counts.stops = stopsOut.size;
    rep.counts.usedStops = usedStopIds.size;
    rep.counts.routes = usedLines.size;
    rep.checks.technicalLinks = [...linkMap.values()].filter(l => l.tech).length;
    validate(rep, limits);

    // --- pliki pomocnicze ---
    const w = (name, header, rows) => fs.writeFileSync(path.join(tmp, name), csvLine(header) + rows.map(csvLine).join(''));
    w('stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type'],
      [...stopsOut].map(([id, [name, lat, lon]]) => [id, name, lat, lon, 0]));
    const agencyId = opts.agencyId ?? txt(operator, 'OperatorCode', 'agency');
    const agencyName = opts.agencyName ?? txt(operator, 'OperatorShortName', agencyId);
    const names = [...usedLines].sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }));
    rep.routeNames = names;
    w('routes.txt', ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
      names.map(n => [`L-${n}`, agencyId, n, '', routeType]));
    w('trips.txt', ['route_id', 'service_id', 'trip_id'], trips.map(([code, route, svc]) => [route, svc, code]));
    const calRows = [];
    let dmin = '99999999', dmax = '00000000';
    for (const s of dateSets.values()) {
      if (!usedSets.has(s.id)) continue;
      rep.counts.calendarSets++;
      for (const d of s.dates) {
        calRows.push([s.id, d, 1]);
        if (d < dmin) dmin = d;
        if (d > dmax) dmax = d;
      }
    }
    rep.dates = { start: dmin, end: dmax };
    w('calendar_dates.txt', ['service_id', 'date', 'exception_type'], calRows);
    w('agency.txt', ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
      [[agencyId, agencyName, opts.agencyUrl ?? '', 'Europe/Warsaw']]);

    // --- atomowe przeniesienie: stop_times.txt jako ostatni ---
    fs.mkdirSync(outDir, { recursive: true });
    const files = fs.readdirSync(tmp).sort((a, b) => (a === 'stop_times.txt') - (b === 'stop_times.txt'));
    for (const f of files) fs.renameSync(path.join(tmp, f), path.join(outDir, f));
    delete rep.boardable; delete rep.alightable;
    return rep;
  } finally {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Znajduje jedyny plik .xml w katalogu feedu i konwertuje go w miejscu. */
export async function convertDir(dir, opts = {}) {
  const xml = fs.readdirSync(dir).filter(f => /\.xml$/i.test(f));
  if (xml.length !== 1) throw new Error(`tx2gtfs: w ${dir} oczekiwano dokładnie jednego pliku .xml, jest ${xml.length}`);
  return convertFile(path.join(dir, xml[0]), dir, opts);
}

async function main() {
  const [src, out] = process.argv.slice(2);
  if (!src) {
    console.error('Użycie: node tools/transxchange-to-gtfs.mjs <plik.xml|katalog> [katalog-wyjściowy]');
    process.exit(1);
  }
  const t0 = Date.now();
  let peak = 0;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 250);
  try {
    const isDir = fs.statSync(src).isDirectory();
    const xml = isDir ? path.join(src, fs.readdirSync(src).find(f => /\.xml$/i.test(f)) ?? '') : src;
    const rep = await convertFile(xml, out ?? (isDir ? src : path.dirname(src)));
    peak = Math.max(peak, process.memoryUsage().rss);
    console.log(JSON.stringify(rep, null, 2));
    console.log(`czas: ${((Date.now() - t0) / 1000).toFixed(1)} s, szczyt RSS: ${(peak / 1048576).toFixed(0)} MB`);
  } catch (err) {
    console.error(err.message);
    if (err.report) console.error(JSON.stringify(err.report, null, 2));
    process.exitCode = 1;
  } finally {
    clearInterval(timer);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
