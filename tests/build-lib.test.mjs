import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitCsv, parseCsvText, timeToSec, dateToWeekday, datesBetween, addFeedServices,
  commonDateRange, candidateDates, selectDayTypes, normalizeStopName, clusterStopGroups,
  parseStopTimeRow, tripTouchesBbox, dropUnusedStops, buildDayPatterns, parseWaterRings,
  segmentsCross, crossesWater, transferCandidates, gridCoverage, carryOverMeta,
} from '../tools/build-lib.mjs';

const M_PER_DEG_LAT = 111320;

// --- CSV i czas ---------------------------------------------------------

test('splitCsv: cudzysłowy, przecinki w polu i podwójny cudzysłów', () => {
  assert.deepEqual(splitCsv('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(splitCsv('1,"Rynek, Główny",3'), ['1', 'Rynek, Główny', '3']);
  assert.deepEqual(splitCsv('"a ""b"" c",x'), ['a "b" c', 'x']);
  assert.deepEqual(splitCsv('a,,'), ['a', '', '']);
});

test('parseCsvText: BOM, CRLF, brakujące komórki, pusty plik', () => {
  const rows = parseCsvText('﻿stop_id, stop_name\r\n1,Rynek\r\n2\r\n\r\n');
  assert.deepEqual(rows, [{ stop_id: '1', stop_name: 'Rynek' }, { stop_id: '2', stop_name: '' }]);
  assert.deepEqual(parseCsvText(''), []);
  assert.deepEqual(parseCsvText('a,b\n'), []);
});

test('timeToSec: czasy po północy (>24:00), brak sekund', () => {
  assert.equal(timeToSec('08:05:30'), 29130);
  assert.equal(timeToSec('24:00:00'), 86400);
  assert.equal(timeToSec('28:16:30'), 28 * 3600 + 16 * 60 + 30);
  assert.equal(timeToSec('7:30'), 27000);
});

test('dateToWeekday: 0=nd, 6=sob, przełom roku', () => {
  assert.equal(dateToWeekday('20261101'), 0);
  assert.equal(dateToWeekday('20261103'), 2);
  assert.equal(dateToWeekday('20261107'), 6);
  assert.equal(dateToWeekday('20271231'), 5);
});

// --- kalendarze ---------------------------------------------------------

test('datesBetween: włącznie z końcem, jedna data, odwrócony zakres, limit', () => {
  assert.deepEqual([...datesBetween('20261230', '20270102')], ['20261230', '20261231', '20270101', '20270102']);
  assert.deepEqual([...datesBetween('20261101', '20261101')], ['20261101']);
  assert.deepEqual([...datesBetween('20261105', '20261101')], []);
  assert.equal([...datesBetween('20260101', '20261231')].length, 120);
  assert.equal([...datesBetween('20260101', '20261231', 5)].length, 5);
});

test('addFeedServices: calendar + wyjątki (dodanie i usunięcie), zakres dat', () => {
  const map = new Map();
  const cal = [{
    service_id: 'S1', start_date: '20261102', end_date: '20261108',
    monday: '1', tuesday: '1', wednesday: '0', thursday: '0', friday: '0', saturday: '1', sunday: '0',
  }];
  const exc = [
    { service_id: 'S1', date: '20261103', exception_type: '2' }, // usuń wtorek
    { service_id: 'S2', date: '20261110', exception_type: '1' }, // dodaj poza zakresem calendar
    { service_id: 'S2', date: '20261111', exception_type: '9' }, // nieznany typ — ignoruj
  ];
  const range = addFeedServices(map, 3, cal, exc);
  assert.deepEqual([...map.keys()].sort(), ['20261102', '20261103', '20261107', '20261110']);
  assert.equal(map.get('20261103').size, 0);
  assert.ok(map.get('20261102').has('3:S1'));
  assert.ok(map.get('20261110').has('3:S2'));
  assert.deepEqual(range, { min: '20261102', max: '20261110' });
});

test('addFeedServices: calendar z samymi zerami (SKM) i pusty feed', () => {
  const map = new Map();
  const zeros = [{
    service_id: 'Z', start_date: '20261101', end_date: '20261130',
    monday: '0', tuesday: '0', wednesday: '0', thursday: '0', friday: '0', saturday: '0', sunday: '0',
  }];
  assert.deepEqual(addFeedServices(map, 0, zeros, []), { min: '99999999', max: '00000000' });
  assert.equal(map.size, 0);
  // usunięcie usługi, której nie ma — bez błędu
  assert.doesNotThrow(() => addFeedServices(map, 0, [], [{ service_id: 'X', date: '20261101', exception_type: '2' }]));
});

test('addFeedServices: dwa feedy nie mieszają identyfikatorów usług', () => {
  const map = new Map();
  const exc = [{ service_id: 'A', date: '20261105', exception_type: '1' }];
  addFeedServices(map, 0, [], exc);
  addFeedServices(map, 1, [], exc);
  assert.deepEqual([...map.get('20261105')].sort(), ['0:A', '1:A']);
});

test('commonDateRange: część wspólna; rozłączne feedy dają min > max', () => {
  assert.deepEqual(commonDateRange([{ min: '20261101', max: '20261130' }, { min: '20261110', max: '20261220' }]),
    { commonMin: '20261110', commonMax: '20261130' });
  const r = commonDateRange([{ min: '20261101', max: '20261105' }, { min: '20261110', max: '20261120' }]);
  assert.ok(r.commonMin > r.commonMax);
});

test('candidateDates: filtr od dziś, fallback na pełny zakres, pusty zbiór', () => {
  const dates = ['20261110', '20261101', '20261120', '20270101'];
  assert.deepEqual(candidateDates(dates, '20261101', '20261130', '20261105'),
    { dates: ['20261110', '20261120'], fallback: false });
  assert.deepEqual(candidateDates(dates, '20261101', '20261130', '20261201'),
    { dates: ['20261101', '20261110', '20261120'], fallback: true });
  assert.deepEqual(candidateDates(new Set(), '20261101', '20261130', '20261105'),
    { dates: [], fallback: true });
});

test('selectDayTypes: pomija święto, zapisuje avoidedHoliday', () => {
  // 2026-11-01 = niedziela i Wszystkich Świętych; 11-08 = zwykła niedziela
  const dates = [];
  for (let d = 1; d <= 10; d++) dates.push('202611' + String(d).padStart(2, '0'));
  const { dayTypes, dayInfo } = selectDayTypes(dates);
  assert.deepEqual(dayTypes.map(d => [d.key, d.date]),
    [['workday', '20261103'], ['saturday', '20261107'], ['sunday', '20261108']]);
  assert.equal(dayInfo.sunday.avoidedHoliday, 'Wszystkich Świętych');
  assert.equal(dayInfo.sunday.weekday, 0);
  assert.equal(dayInfo.workday.avoidedHoliday, undefined);
  assert.equal(dayInfo.workday.holiday, null);
});

test('selectDayTypes: brak wtorku-czwartku -> poniedziałek/piątek; brak weekendu -> pomija typ', () => {
  // 2026-11-09 pon, 2026-11-13 pt
  const only = selectDayTypes(['20261109', '20261113']);
  assert.deepEqual(only.dayTypes.map(d => [d.key, d.date]), [['workday', '20261109']]);
  assert.deepEqual(Object.keys(only.dayInfo), ['workday']);
  // zbiór pusty
  const none = selectDayTypes([]);
  assert.deepEqual(none.dayTypes, []);
  assert.deepEqual(none.dayInfo, {});
});

test('selectDayTypes: gdy jedyna niedziela jest świętem, bierze ją mimo to', () => {
  const { dayTypes, dayInfo } = selectDayTypes(['20261101']);
  assert.deepEqual(dayTypes.map(d => d.key), ['sunday']);
  assert.equal(dayInfo.sunday.date, '20261101');
  assert.equal(dayInfo.sunday.holiday, 'Wszystkich Świętych');
  assert.equal(dayInfo.sunday.avoidedHoliday, undefined);
});

// --- przystanki ---------------------------------------------------------

test('normalizeStopName: obcina końcowy numer słupka i białe znaki', () => {
  assert.equal(normalizeStopName('  Wrzeszcz PKP 03 '), 'Wrzeszcz PKP');
  assert.equal(normalizeStopName('Rynek'), 'Rynek');
  assert.equal(normalizeStopName('Aleja 3 Maja'), 'Aleja 3 Maja');
  assert.equal(normalizeStopName('Pl. 1'), 'Pl.');
});

test('clusterStopGroups: ta sama nazwa blisko = jedna grupa, daleko = osobne', () => {
  const stops = [
    { name: 'Rynek', lat: 54.0, lon: 18.0, group: -1 },
    { name: 'Rynek', lat: 54.001, lon: 18.0, group: -1 },   // ~111 m
    { name: 'Rynek', lat: 54.1, lon: 18.0, group: -1 },     // ~11 km — inne miasto
    { name: 'Dworzec', lat: 54.0, lon: 18.0, group: -1 },
  ];
  assert.equal(clusterStopGroups(stops), 3);
  assert.equal(stops[0].group, stops[1].group);
  assert.notEqual(stops[0].group, stops[2].group);
  assert.notEqual(stops[0].group, stops[3].group);
});

test('clusterStopGroups: łańcuch przechodni, pusty i pojedynczy przystanek', () => {
  // A-B 200 m, B-C 200 m, A-C 400 m (>300): union-find łączy wszystkie trzy
  const lat = m => 54 + m / M_PER_DEG_LAT;
  const chain = [0, 200, 400].map(m => ({ name: 'X', lat: lat(m), lon: 18, group: -1 }));
  assert.equal(clusterStopGroups(chain), 1);
  assert.ok(chain.every(s => s.group === 0));
  assert.equal(clusterStopGroups([]), 0);
  const one = [{ name: 'Sam', lat: 54, lon: 18, group: -1 }];
  assert.equal(clusterStopGroups(one), 1);
  assert.equal(one[0].group, 0);
  // próg: 600 m między skrajnymi przy maxM=300 bez środka = dwie grupy
  const far = [0, 600].map(m => ({ name: 'Y', lat: lat(m), lon: 18, group: -1 }));
  assert.equal(clusterStopGroups(far), 2);
});

test('parseStopTimeRow: flagi, czas po północy, brak arrival, nieznany przystanek', () => {
  const stopIdx = new Map([['0:S1', 5]]);
  const cols = { iDep: 1, iArr: 0, iStop: 2, iSeq: 3, iPickup: 4, iDrop: 5 };
  assert.deepEqual(parseStopTimeRow(['25:00:00', '25:00:30', 'S1', '7', '1', '1'], cols, stopIdx, 0),
    [7, 5, 90030, 90000, 3]);
  assert.deepEqual(parseStopTimeRow(['', '08:00:00', 'S1', '1', '0', '1'], cols, stopIdx, 0),
    [1, 5, 28800, 28800, 2]);
  assert.equal(parseStopTimeRow(['08:00:00', '08:00:00', 'NOPE', '1', '0', '0'], cols, stopIdx, 0), null);
  assert.equal(parseStopTimeRow(['08:00:00', '08:00:00', 'S1', '1', '0', '0'], cols, stopIdx, 1), null); // inny feed
  // brak kolumn arrival/pickup/drop w nagłówku (-1)
  const bare = { iDep: 0, iArr: -1, iStop: 1, iSeq: 2, iPickup: -1, iDrop: -1 };
  assert.deepEqual(parseStopTimeRow(['08:00:10', 'S1', '2'], bare, stopIdx, 0), [2, 5, 28810, 28810, 0]);
});

test('tripTouchesBbox: przystanek w środku, na brzegu i poza', () => {
  const stops = [{ lat: 54.0, lon: 18.0 }, { lat: 50.0, lon: 20.0 }];
  const bb = [53.9, 17.9, 54.1, 18.1];
  assert.equal(tripTouchesBbox([[1, 0]], stops, bb), true);
  assert.equal(tripTouchesBbox([[1, 1], [2, 0]], stops, bb), true);
  assert.equal(tripTouchesBbox([[1, 1]], stops, bb), false);
  assert.equal(tripTouchesBbox([[1, 0]], [{ lat: 54.1, lon: 18.1 }], bb), true); // brzeg włącznie
  assert.equal(tripTouchesBbox([], stops, bb), false);
  assert.equal(tripTouchesBbox([[1, 0]], [{ lat: 53.9, lon: 17.9 }], bb), true); // dolny róg włącznie
});

test('dropUnusedStops: przenumerowuje indeksy, czyści stopIdx, nic nie usuwa gdy wszystkie użyte', () => {
  const stops = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  const stopIdx = new Map([['0:a', 0], ['0:b', 1], ['0:c', 2]]);
  const tripStops = new Map([['0:t', [[1, 0, 0, 0, 0], [2, 2, 60, 60, 0]]]]);
  assert.equal(dropUnusedStops(stops, tripStops, stopIdx), 1);
  assert.deepEqual(stops.map(s => s.name), ['A', 'C']);
  assert.deepEqual(tripStops.get('0:t').map(r => r[1]), [0, 1]);
  assert.deepEqual([...stopIdx], [['0:a', 0], ['0:c', 1]]);
  // ponownie: wszystko użyte
  assert.equal(dropUnusedStops(stops, tripStops, stopIdx), 0);
  assert.equal(stops.length, 2);
  // brak kursów: znikają wszystkie
  const s2 = [{ name: 'X' }];
  assert.equal(dropUnusedStops(s2, new Map(), new Map([['0:x', 0]])), 1);
  assert.equal(s2.length, 0);
  // pusty zbiór przystanków
  assert.equal(dropUnusedStops([], new Map(), new Map()), 0);
});

// --- wzorce tras ----------------------------------------------------------

function ctx(tripRows, { frequencies = new Map(), dayMask = 1 } = {}) {
  const tripStops = new Map();
  const tripMeta = new Map();
  for (const [key, rows, routeKey = 'r1'] of tripRows) {
    tripStops.set(key, rows);
    tripMeta.set(key, { routeKey, dayMask });
  }
  const names = [];
  const routeNameIndex = rk => { if (!names.includes(rk)) names.push(rk); return names.indexOf(rk); };
  return { tripStops, tripMeta, frequencies, routeNameIndex };
}

test('buildDayPatterns: dwa kursy tego samego wzorca = jeden wpis z dwoma startami i wspólnym profilem', () => {
  const c = ctx([
    ['t1', [[1, 0, 3600, 3600, 0], [2, 1, 3720, 3720, 0], [3, 2, 3900, 3900, 0]]],
    ['t2', [[1, 0, 7200, 7200, 0], [2, 1, 7320, 7320, 0], [3, 2, 7500, 7500, 0]]],
  ]);
  const { patterns, stats } = buildDayPatterns(c, 0);
  assert.equal(patterns.length, 1);
  assert.deepEqual(patterns[0].s, [0, 1, 2]);
  assert.deepEqual(patterns[0].p, [[120, 180]]);
  assert.deepEqual(patterns[0].t, [[3600, 0], [7200, 0]]);
  assert.equal(patterns[0].f, 0);
  assert.equal(patterns[0].d, undefined);
  assert.deepEqual(stats, { overtaking: 0, extraEntries: 0 });
});

test('buildDayPatterns: sortuje po stop_sequence, liczy postoje i pomija d dla zer', () => {
  const c = ctx([['t', [
    [3, 2, 3900, 3900, 0],
    [1, 0, 3600, 3600, 0],
    [2, 1, 3750, 3720, 0], // postój 30 s
  ]]]);
  const { patterns } = buildDayPatterns(c, 0);
  assert.deepEqual(patterns[0].s, [0, 1, 2]);
  assert.deepEqual(patterns[0].p, [[150, 150]]);
  assert.deepEqual(patterns[0].d, [[0, 30, 0]]);
});

test('buildDayPatterns: kurs po północy (>24:00) zachowuje czasy bez zawijania', () => {
  const c = ctx([['t', [[1, 0, 86400 + 600, 86400 + 600, 0], [2, 1, 86400 + 900, 86400 + 900, 0]]]]);
  const { patterns } = buildDayPatterns(c, 0);
  assert.deepEqual(patterns[0].t, [[87000, 0]]);
  assert.deepEqual(patterns[0].p, [[300]]);
});

test('buildDayPatterns: maska dnia, malejące odjazdy, jeden przystanek i pusty zbiór', () => {
  const rows = [[1, 0, 100, 100, 0], [2, 1, 200, 200, 0]];
  const wrongDay = ctx([['t', rows]], { dayMask: 2 }); // tylko dzień 1
  assert.deepEqual(buildDayPatterns(wrongDay, 0).patterns, []);
  assert.equal(buildDayPatterns(wrongDay, 1).patterns.length, 1);
  const backwards = ctx([['t', [[1, 0, 500, 500, 0], [2, 1, 400, 400, 0]]]]);
  assert.deepEqual(buildDayPatterns(backwards, 0).patterns, []);
  const single = ctx([['t', [[1, 0, 500, 500, 0]]]]);
  assert.deepEqual(buildDayPatterns(single, 0).patterns, []);
  assert.deepEqual(buildDayPatterns(ctx([]), 0), { patterns: [], stats: { overtaking: 0, extraEntries: 0 } });
});

test('buildDayPatterns: kurs wyprzedzający rozbija wzorzec i liczy statystyki', () => {
  // wolny kurs wyjeżdża o 1000 i jedzie 600 s, szybki o 1100 i jedzie 100 s — wyprzedza
  const c = ctx([
    ['slow', [[1, 0, 1000, 1000, 0], [2, 1, 1600, 1600, 0]]],
    ['fast', [[1, 0, 1100, 1100, 0], [2, 1, 1200, 1200, 0]]],
  ]);
  const { patterns, stats } = buildDayPatterns(c, 0);
  assert.equal(patterns.length, 2);
  assert.deepEqual(stats, { overtaking: 1, extraEntries: 1 });
  assert.equal(patterns.reduce((s, p) => s + p.t.length, 0), 2);
});

test('buildDayPatterns: kursy częstotliwościowe generują starty co headway (koniec wyłączny)', () => {
  const c = ctx([['m', [[1, 0, 0, 0, 0], [2, 1, 120, 120, 0]]]],
    { frequencies: new Map([['m', [[3600, 4200, 300], [7200, 7200, 300]]]]) });
  const { patterns } = buildDayPatterns(c, 0);
  assert.deepEqual(patterns[0].t.map(x => x[0]), [3600, 3900]);
});

test('buildDayPatterns: różne flagi i trasy dają osobne wzorce; flagi trafiają do wpisu', () => {
  const c = ctx([
    ['a', [[1, 0, 0, 0, 1], [2, 1, 60, 60, 0]], 'r1'],
    ['b', [[1, 0, 100, 100, 0], [2, 1, 160, 160, 0]], 'r1'],
    ['c', [[1, 0, 200, 200, 0], [2, 1, 260, 260, 0]], 'r2'],
  ]);
  const { patterns } = buildDayPatterns(c, 0);
  assert.equal(patterns.length, 3);
  assert.deepEqual(patterns.find(p => p.f !== 0).f, [1, 0]);
  assert.deepEqual(patterns.map(p => p.r).sort(), [0, 0, 1]);
});

// --- woda i przesiadki ------------------------------------------------------

test('segmentsCross: przecięcie, rozłączne i równoległe odcinki', () => {
  assert.equal(segmentsCross(0, 0, 2, 2, 0, 2, 2, 0), true);
  assert.equal(segmentsCross(0, 0, 1, 0, 0, 1, 1, 1), false); // równoległe
  assert.equal(segmentsCross(0, 0, 1, 1, 2, 2, 3, 3), false); // współliniowe rozłączne
  assert.equal(segmentsCross(0, 0, 1, 0, 2, -1, 2, 1), false); // przecięcie prostych poza odcinkiem
});

test('parseWaterRings: skaluje ×1e5, liczy bbox, pomija pierścienie <2 punktów i brak pól', () => {
  const rings = parseWaterRings({
    polys: [[[5400000, 1800000], [5400100, 1800200]]],
    lines: [[[5400000, 1800000]], [[5410000, 1810000], [5410000, 1820000]]],
  });
  assert.equal(rings.length, 2);
  assert.deepEqual(rings[0].pts, [[54, 18], [54.001, 18.002]]);
  assert.equal(rings[0].latS, 54);
  assert.equal(rings[0].latN, 54.001);
  assert.equal(rings[0].lonE, 18.002);
  assert.deepEqual(parseWaterRings({}), []);
});

test('crossesWater: przecina rzekę, omija ją, bbox odsiewa, brak wody', () => {
  const rings = parseWaterRings({ lines: [[[5400000, 1800000], [5400000, 1810000]]] }); // równoleżnik 54, lon 18..18.1
  assert.equal(crossesWater(rings, 53.999, 18.05, 54.001, 18.05), true);
  assert.equal(crossesWater(rings, 54.001, 18.05, 54.002, 18.05), false); // ta sama strona
  assert.equal(crossesWater(rings, 53.999, 18.2, 54.001, 18.2), false);   // poza bboxem wzdłuż rzeki
  assert.equal(crossesWater([], 53.999, 18.05, 54.001, 18.05), false);
});

test('transferCandidates: pary w zasięgu, sekundy z tempa, brak par dla odległych/pojedynczego', () => {
  const lat = m => 54 + m / M_PER_DEG_LAT;
  const stops = [
    { lat: lat(0), lon: 18 },
    { lat: lat(100), lon: 18 },
    { lat: lat(700), lon: 18 }, // poza 500 m od obu poprzednich (od drugiego: 600 m)
  ];
  const cand = transferCandidates(stops, 500, 1, M_PER_DEG_LAT);
  assert.equal(cand.size, 1);
  const [[j, sec, dist]] = cand.get(0);
  assert.equal(j, 1);
  assert.ok(Math.abs(dist - 100) < 1);
  assert.equal(sec, Math.round(dist));
  // próg włącznie z dołu: para w odległości 450 m wchodzi, 550 m nie
  const edge = [0, 450, 1000].map(m => ({ lat: lat(m), lon: 18 }));
  const e = transferCandidates(edge, 500, 1, M_PER_DEG_LAT);
  assert.deepEqual(e.get(0).map(x => x[0]), [1]);
  assert.deepEqual(e.get(1), undefined);
  assert.equal(transferCandidates([stops[0]], 500, 1, M_PER_DEG_LAT).size, 0);
  assert.equal(transferCandidates([], 500, 1, M_PER_DEG_LAT).size, 0);
});

test('transferCandidates: para indeksowana od przystanku bardziej na południe, niezależnie od kolejności wejścia', () => {
  const lat = m => 54 + m / M_PER_DEG_LAT;
  const stops = [{ lat: lat(100), lon: 18 }, { lat: lat(0), lon: 18 }];
  const cand = transferCandidates(stops, 500, 1, M_PER_DEG_LAT);
  assert.deepEqual([...cand.keys()], [1]);
  assert.equal(cand.get(1)[0][0], 0);
});

test('gridCoverage: wszystkie w siatce, poza siatką, pusty zbiór', () => {
  const bbox = [54.0, 18.0, 54.2, 18.2];
  const inside = { lat: [5410000], lon: [1810000] };
  assert.deepEqual(gridCoverage(inside, bbox, M_PER_DEG_LAT), { outsideStops: 0, maxOutsideM: 0 });
  const out = { lat: [5410000, 5390000], lon: [1810000, 1810000] }; // drugi 0,1° na południe
  const r = gridCoverage(out, bbox, M_PER_DEG_LAT);
  assert.equal(r.outsideStops, 1);
  assert.ok(Math.abs(r.maxOutsideM - 0.1 * M_PER_DEG_LAT) < 1);
  assert.deepEqual(gridCoverage({ lat: [], lon: [] }, bbox, M_PER_DEG_LAT), { outsideStops: 0, maxOutsideM: 0 });
});

// --- carryOverMeta: pola dopisywane przez build-delays.mjs --------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Odtwarza ścieżkę zapisu meta.json z build-data.mjs na katalogu tymczasowym. */
function rebuildMeta(dir, fresh) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { /* brak */ }
  const carried = carryOverMeta(prev, { delaysFileExists: fs.existsSync(path.join(dir, 'delays.json')) });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ...fresh, ...carried }));
  return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
}

test('carryOverMeta: delays przetrwa przebudowę, gdy delays.json istnieje', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-'));
  const delays = { routes: 5, routesTotal: 40, keys: 99, updated: '20261116', source: 'gtfs-rt' };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ city: 'x', generated: 'stare', delays }));
  fs.writeFileSync(path.join(dir, 'delays.json'), '{}');
  const meta = rebuildMeta(dir, { city: 'x', generated: 'nowe' });
  assert.equal(meta.generated, 'nowe');
  assert.deepEqual(meta.delays, delays);
});

test('carryOverMeta: bez delays.json pole delays znika (nie kłamiemy)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ city: 'x', delays: { routes: 5 } }));
  const meta = rebuildMeta(dir, { city: 'x', generated: 'nowe' });
  assert.equal('delays' in meta, false);
});

test('carryOverMeta: meta bez delays, brak lub uszkodzony poprzedni meta — bez zmian', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-'));
  fs.writeFileSync(path.join(dir, 'delays.json'), '{}');
  assert.deepEqual(rebuildMeta(dir, { city: 'x' }), { city: 'x' }); // brak pliku
  fs.writeFileSync(path.join(dir, 'meta.json'), '{niepoprawny');
  assert.deepEqual(rebuildMeta(dir, { city: 'x' }), { city: 'x' });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ city: 'x' }));
  assert.deepEqual(rebuildMeta(dir, { city: 'x' }), { city: 'x' });
  assert.deepEqual(carryOverMeta(null, { delaysFileExists: true }), {});
});
