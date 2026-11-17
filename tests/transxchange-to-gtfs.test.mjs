import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  LIMITS, convertFile, convertDir, parseRunTime, secToGtfsTime, dayFlagsFromDaysOfWeek,
  operatingDates, visitFlags,
} from '../tools/transxchange-to-gtfs.mjs';
import { forEachElement } from '../tools/xmlstream.mjs';
import { parseCsvText, addFeedServices, parseStopTimeRow, buildDayPatterns } from '../tools/build-lib.mjs';

const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'transxchange-min.xml'), 'utf8');
// fixture ma 5 przystanków i 3 kursy pasażerskie — progi dla dużego feedu są tu nierealne
const RELAXED = { minBoardableVisitShare: 0.5, minAlightableVisitShare: 0.5, minUsedStops: 3 };

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tx2gtfs-'));

/** Zamienia pierwsze wystąpienie `from` po znaczniku `after`. */
function patch(xml, after, from, to) {
  const i = xml.indexOf(after);
  assert.ok(i >= 0, `brak znacznika ${after}`);
  const j = xml.indexOf(from, i);
  assert.ok(j >= 0, `brak ${from} po ${after}`);
  return xml.slice(0, j) + to + xml.slice(j + from.length);
}

async function run(xml, opts = {}) {
  const dir = tmpDir();
  const src = path.join(dir, 'in.xml');
  fs.writeFileSync(src, xml);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  try {
    const rep = await convertFile(src, out, { ...opts, limits: { ...RELAXED, ...(opts.limits ?? {}) } });
    return { rep, out };
  } catch (err) {
    err.out = out;
    throw err;
  }
}

const read = (out, f) => parseCsvText(fs.readFileSync(path.join(out, f), 'utf8'));

async function assertAborts(xml, opts, pattern) {
  await assert.rejects(run(xml, opts), (err) => {
    assert.match(err.message, pattern);
    assert.ok(!fs.existsSync(path.join(err.out, 'stop_times.txt')), 'stop_times.txt nie może powstać po awarii');
    assert.deepEqual(fs.readdirSync(err.out), [], 'katalog feedu ma zostać pusty, a tymczasowy zniknąć');
    return true;
  });
}

// --- czyste funkcje ------------------------------------------------------------

test('parseRunTime: PT0HxM, sekundy i nieznany wzorzec', () => {
  assert.equal(parseRunTime('PT0H12M'), 720);
  assert.equal(parseRunTime('PT1H02M30S'), 3750);
  assert.equal(parseRunTime('PT45S'), 45);
  for (const bad of ['', 'PT', 'P1D', '12:00', 'PT-5M']) assert.throws(() => parseRunTime(bad), /czasu/, bad);
});

test('secToGtfsTime: przekroczenie północy daje 24+', () => {
  assert.equal(secToGtfsTime(86700), '24:05:00');
  assert.equal(secToGtfsTime(0), '00:00:00');
  assert.equal(secToGtfsTime(45296), '12:34:56');
});

test('dayFlagsFromDaysOfWeek: grupy dni i nieznane dziecko', () => {
  const node = (...names) => ({ name: 'DaysOfWeek', kids: names.map(name => ({ name, kids: [] })) });
  assert.deepEqual(dayFlagsFromDaysOfWeek(node('MondayToFriday', 'Sunday')), [true, true, true, true, true, true, false]);
  assert.deepEqual(dayFlagsFromDaysOfWeek(node('Saturday')), [false, false, false, false, false, false, true]);
  assert.throws(() => dayFlagsFromDaysOfWeek(node('HolidaysOnly')), /HolidaysOnly/);
});

async function parseNode(xml, p) {
  let got;
  await forEachElement(Readable.from([Buffer.from(xml)]), [p], n => { got = n; });
  return got;
}

test('operatingDates: dni tygodnia z okresu minus DaysOfNonOperation; nieznane dziecko = wyjątek', async () => {
  const period = await parseNode('<R><P><StartDate>2026-11-02</StartDate><EndDate>2026-11-08</EndDate></P></R>', 'R/P');
  const prof = await parseNode(`<R><O><DaysOfNonOperation><DateRange><StartDate>2026-11-04</StartDate><EndDate>2026-11-05</EndDate></DateRange></DaysOfNonOperation>
    <RegularDayType><DaysOfWeek><MondayToFriday/></DaysOfWeek></RegularDayType></O></R>`, 'R/O');
  assert.deepEqual(operatingDates(prof, period), ['20261102', '20261103', '20261106']);
  const bad = await parseNode('<R><O><DaysOfOperation/><RegularDayType><DaysOfWeek><Monday/></DaysOfWeek></RegularDayType></O></R>', 'R/O');
  assert.throws(() => operatingDates(bad, period), /DaysOfOperation/);
});

test('visitFlags: bez Activity pickup=1 tylko na ostatnim, drop_off=1 tylko na pierwszym', () => {
  const none = [{ from: null, to: null }, { from: null, to: null }, { from: null, to: null }];
  assert.deepEqual([0, 1, 2, 3].map(k => visitFlags(none, k)), [
    { pickup: 0, dropOff: 1 }, { pickup: 0, dropOff: 0 }, { pickup: 0, dropOff: 0 }, { pickup: 1, dropOff: 0 },
  ]);
});

test('visitFlags: Activity pass/setDown blokuje wsiadanie, pass/pickUp blokuje wysiadanie', () => {
  const act = [{ from: 'pickUp', to: 'pickUp' }, { from: 'setDown', to: 'pass' }, { from: 'pass', to: 'setDown' }];
  assert.deepEqual(visitFlags(act, 1), { pickup: 1, dropOff: 1 });
  assert.deepEqual(visitFlags(act, 2), { pickup: 1, dropOff: 1 });
  const ok = [{ from: 'pickUp', to: 'setDown' }, { from: 'pickUpAndSetDown', to: 'pickUpAndSetDown' }];
  assert.deepEqual(visitFlags(ok, 1), { pickup: 0, dropOff: 0 });
});

// --- konwersja fixture ---------------------------------------------------------

test('konwersja: linia z LineRef własnej usługi, kurs kind!=0 pominięty, 2 trasy', async () => {
  const { rep, out } = await run(FIXTURE);
  assert.equal(rep.journeys.total, 4);
  assert.equal(rep.counts.trips, 3);
  const trips = read(out, 'trips.txt');
  assert.deepEqual(trips.map(t => t.trip_id).sort(), ['V1', 'V2', 'V4']);
  assert.equal(trips.find(t => t.trip_id === 'V1').route_id, 'L-10');
  assert.equal(trips.find(t => t.trip_id === 'V2').route_id, 'L-N1'); // ten sam Line@id=1, inna nazwa
  assert.equal(trips.find(t => t.trip_id === 'V4').route_id, 'L-10');
  assert.deepEqual(rep.routeNames, ['10', 'N1']);
  assert.equal(read(out, 'routes.txt').length, 2);
});

test('konwersja: LineType nigdy nie wpływa na route_type', async () => {
  const xml = FIXTURE.replaceAll('<LineType>3</LineType>', '<LineType>1</LineType>');
  const { out } = await run(xml, { routeType: 3 });
  assert.deepEqual([...new Set(read(out, 'routes.txt').map(r => r.route_type))], ['3']);
  const { out: out2 } = await run(xml, { routeType: 700 });
  assert.deepEqual([...new Set(read(out2, 'routes.txt').map(r => r.route_type))], ['700']);
});

test('konwersja: brak Activity w kursie = wnętrze 0/0, flagi tylko na krańcach', async () => {
  const { out } = await run(FIXTURE);
  const all = read(out, 'stop_times.txt');
  const v4 = all.filter(r => r.trip_id === 'V4'); // zero Activity w VJTL
  assert.deepEqual(v4.map(r => [r.pickup_type, r.drop_off_type]), [['0', '1'], ['0', '0'], ['1', '0']]);
  const v1 = all.filter(r => r.trip_id === 'V1');
  assert.deepEqual(v1.map(r => r.pickup_type), ['0', '0', '0', '1']);
  assert.deepEqual(v1.map(r => r.drop_off_type), ['1', '0', '0', '0']);
});

test('konwersja: WaitTime daje arrival != departure, północ daje 24:xx', async () => {
  const { out } = await run(FIXTURE);
  const v1 = read(out, 'stop_times.txt').filter(r => r.trip_id === 'V1');
  assert.deepEqual(v1.map(r => r.arrival_time), ['23:50:00', '23:55:00', '24:08:00', '24:09:00']);
  assert.deepEqual(v1.map(r => r.departure_time), ['23:50:00', '23:58:00', '24:08:00', '24:09:00']);
  assert.deepEqual(v1.map(r => r.stop_sequence), ['1', '2', '3', '4']);
});

test('konwersja: kanoniczny service_id wspólny dla usług o tym samym zbiorze dat', async () => {
  const { out, rep } = await run(FIXTURE);
  const trips = Object.fromEntries(read(out, 'trips.txt').map(t => [t.trip_id, t.service_id]));
  assert.equal(trips.V1, trips.V2);
  assert.notEqual(trips.V1, trips.V4);
  const cal = read(out, 'calendar_dates.txt');
  assert.deepEqual(cal.filter(r => r.service_id === trips.V1).map(r => r.date), ['20261102', '20261103', '20261106']);
  assert.deepEqual(cal.filter(r => r.service_id === trips.V4).map(r => r.date), ['20261107']);
  assert.ok(cal.every(r => r.exception_type === '1'));
  assert.equal(fs.existsSync(path.join(out, 'calendar.txt')), false);
  assert.deepEqual(rep.dates, { start: '20261102', end: '20261107' });
  assert.equal(rep.counts.calendarSets, 2);
});

test('konwersja: kontrola krzyżowa i tożsamość ogniwa + kursy = wiersze stop_times', async () => {
  const { rep } = await run(FIXTURE);
  assert.equal(rep.checks.checkedLinks, 3 + 2 + 2);
  assert.equal(rep.checks.linkMismatches, 0);
  assert.equal(rep.counts.stopTimes, 10);
  assert.equal(rep.checks.checkedLinks + rep.journeys.kept, rep.counts.stopTimes);
  assert.equal(rep.counts.stops, 5);
  assert.equal(rep.counts.usedStops, 5);
});

test('konwersja: kursy spoza korzeniowego VehicleJourneys (Garages) nie trafiają do wyniku', async () => {
  const { out } = await run(FIXTURE);
  assert.ok(!read(out, 'trips.txt').some(t => t.trip_id === 'GHOST'));
});

test('konwersja: domyślne LIMITS odrzucają mały fixture, a stop_times.txt nie powstaje', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'in.xml'), FIXTURE);
  await assert.rejects(convertFile(path.join(dir, 'in.xml'), dir), /użyte przystanki/);
  assert.ok(!fs.existsSync(path.join(dir, 'stop_times.txt')));
});

test('convertDir: znajduje jedyny .xml w katalogu i zapisuje feed w miejscu', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'TransXChange.xml'), FIXTURE);
  const rep = await convertDir(dir, { limits: RELAXED });
  assert.equal(rep.counts.trips, 3);
  assert.ok(fs.existsSync(path.join(dir, 'stop_times.txt')));
  assert.ok(!fs.existsSync(path.join(dir, '.tx2gtfs-tmp')));
  fs.writeFileSync(path.join(dir, 'drugi.xml'), FIXTURE);
  await assert.rejects(convertDir(dir), /dokładnie jednego/);
});

// --- progi (każdy osobno) ------------------------------------------------------

const noKind = FIXTURE.replace('<VehicleJourneyKind>5</VehicleJourneyKind>', '');
const twoStopKept = patch(FIXTURE.replace('<VehicleJourneyKind>5</VehicleJourneyKind>', '<VehicleJourneyKind>0</VehicleJourneyKind>'),
  '<VehicleJourneyCode>V3<', '<JourneyPatternRef>R2<', '<JourneyPatternRef>R1<');

for (const [name, xml, limits, pattern] of [
  ['minPassengerShare', FIXTURE, { minPassengerShare: 0.9 }, /udział kursów kind=0/],
  ['minKeptOfPassenger', FIXTURE, { minKeptOfPassenger: 1.1 }, /zachowane\/kind=0/],
  ['maxUnknownKindShare', noKind, { maxUnknownKindShare: 0.1 }, /bez znanego VehicleJourneyKind/],
  ['max2StopKeptShare', twoStopKept, {}, /2-przystankowe/],
  ['minBoardableVisitShare', FIXTURE, { minBoardableVisitShare: 0.95 }, /z wsiadaniem/],
  ['minAlightableVisitShare', FIXTURE, { minAlightableVisitShare: 0.95 }, /z wysiadaniem/],
  ['minUsedStops', FIXTURE, { minUsedStops: 6 }, /użyte przystanki/],
]) {
  test(`próg ${name}: przekroczenie przerywa konwersję bez stop_times.txt`, async () => {
    assert.ok(name in LIMITS);
    await assertAborts(xml, { limits }, pattern);
  });
}

test('kurs bez VehicleJourneyKind: decyzja z Route/IsTechnical (techniczna -> pominięty), liczony jako nieznany', async () => {
  const { rep } = await run(noKind, { limits: { maxUnknownKindShare: 0.5 } });
  assert.equal(rep.journeys.unknownKind, 1);
  assert.equal(rep.counts.trips, 3);
});

// --- asercje ----------------------------------------------------------------------

test('niezgodność kontroli krzyżowej: przystanek kursu inny niż w mapie ogniw -> wyjątek', async () => {
  const xml = patch(FIXTURE, '<VehicleJourneyCode>V2<', '<StopPointRef>A3</StopPointRef>', '<StopPointRef>A4</StopPointRef>');
  await assertAborts(xml, {}, /niezgodnych z mapą ogniw/);
});

test('konflikt definicji ogniwa (JPTL kontra RouteLink) -> wyjątek', async () => {
  const xml = patch(FIXTURE, '<JourneyPatternTimingLink id="L1">', '<To><StopPointRef>A2<', '<To><StopPointRef>A3<');
  await assertAborts(xml, {}, /konfliktów definicji ogniw/);
});

test('Route/IsTechnical niezgodne z VehicleJourneyKind -> wyjątek', async () => {
  const xml = FIXTURE.replace('<VehicleJourneyKind>5</VehicleJourneyKind>', '<VehicleJourneyKind>0</VehicleJourneyKind>');
  await assertAborts(xml, { limits: { max2StopKeptShare: 1 } }, /nie zgadza się z Route\/IsTechnical/);
});

test('ogniwo z Activity=pass w zachowanym kursie -> wyjątek', async () => {
  const xml = patch(FIXTURE, '<JourneyPatternTimingLink id="L2">', '<From><StopPointRef>A2</StopPointRef></From>',
    '<From><Activity>pass</Activity><StopPointRef>A2</StopPointRef></From>');
  await assertAborts(xml, {}, /Activity=pass/);
});

test('nieznana wartość Activity w VJTL -> wyjątek', async () => {
  const xml = patch(FIXTURE, '<VehicleJourneyCode>V4<', '<From></From>', '<From><Activity>dance</Activity></From>');
  await assertAborts(xml, {}, /Activity "dance"/);
});

test('nierozwiązany ServiceRef albo LineRef -> wyjątek', async () => {
  await assertAborts(patch(FIXTURE, '<VehicleJourneyCode>V2<', '<ServiceRef>200<', '<ServiceRef>999<'), {}, /ServiceRef "999"/);
  await assertAborts(patch(FIXTURE, '<VehicleJourneyCode>V2<', '<LineRef>1<', '<LineRef>77<'), {}, /LineRef "77"/);
});

test('kurs: liczba przystanków != ogniwa + 1 -> wyjątek', async () => {
  const xml = patch(FIXTURE, '<VehicleJourneyCode>V2<',
    '<VehicleJourneyStopPoint><Sequence>0</Sequence><StopPointRef>A3</StopPointRef></VehicleJourneyStopPoint>', '');
  await assertAborts(xml, {}, /oczekiwano n\+1/);
});

// --- zgodność z build-lib (dowód, że build-data.mjs nie wymaga zmian) -------------

test('wynik konwertera przechodzi przez parseCsvText, addFeedServices, parseStopTimeRow i buildDayPatterns', async () => {
  const { out } = await run(FIXTURE);
  const servicesByDate = new Map();
  addFeedServices(servicesByDate, '0', [], read(out, 'calendar_dates.txt'));
  const day = '20261102'; // poniedziałek: usługi 100 i 200
  assert.equal(servicesByDate.get(day).size, 1);

  const stopIdx = new Map();
  read(out, 'stops.txt').forEach((s, i) => stopIdx.set(`0:${s.stop_id}`, i));
  const routes = new Map(read(out, 'routes.txt').map(r => [r.route_id, r]));
  const tripMeta = new Map();
  for (const t of read(out, 'trips.txt')) {
    assert.ok(routes.has(t.route_id));
    if (servicesByDate.get(day).has(`0:${t.service_id}`)) tripMeta.set(`0:${t.trip_id}`, { routeKey: `0:${t.route_id}`, dayMask: 1 });
  }
  assert.deepEqual([...tripMeta.keys()].sort(), ['0:V1', '0:V2']);

  const lines = fs.readFileSync(path.join(out, 'stop_times.txt'), 'utf8').split('\n').filter(Boolean);
  const header = lines[0].split(',');
  const cols = {
    iDep: header.indexOf('departure_time'), iArr: header.indexOf('arrival_time'), iStop: header.indexOf('stop_id'),
    iSeq: header.indexOf('stop_sequence'), iPickup: header.indexOf('pickup_type'), iDrop: header.indexOf('drop_off_type'),
  };
  const tripStops = new Map();
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    const key = `0:${c[0]}`;
    if (!tripMeta.has(key)) continue;
    const row = parseStopTimeRow(c, cols, stopIdx, '0');
    assert.ok(row, `nieznany przystanek w ${l}`);
    if (!tripStops.has(key)) tripStops.set(key, []);
    tripStops.get(key).push(row);
  }
  const names = [];
  const routeNameIndex = rk => { if (!names.includes(rk)) names.push(rk); return names.indexOf(rk); };
  const { patterns } = buildDayPatterns({ tripStops, tripMeta, frequencies: new Map(), routeNameIndex }, 0);
  assert.equal(patterns.length, 2); // V1 (L-10, 4 przystanki) i V2 (L-N1, 3 przystanki)
  const v1 = patterns.find(p => p.s.length === 4);
  assert.deepEqual(v1.t, [[23 * 3600 + 50 * 60, 0]]);
  assert.deepEqual(v1.p, [[480, 600, 60]]);
  assert.deepEqual(v1.d, [[0, 180, 0, 0]]);
  assert.deepEqual(v1.f, [2, 0, 0, 1]); // bit1 = brak wysiadania (pierwszy), bit0 = brak wsiadania (ostatni)
});
