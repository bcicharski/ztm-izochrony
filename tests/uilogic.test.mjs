/**
 * Logika interfejsu bez DOM (Z-034): js/uilogic.js importujemy wprost —
 * moduł nie dotyka document/window/location, więc działa w node.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeStopQuery, buildStopIndex, searchStops, mergeSearchResults,
  warsawNow, dayTypeOf, HHMM, fmtClock, fmtDate, parseUrlState, wantsMainEngine,
  buildQuery, reducedMotionFrom, accessIcons, statusLine, dayInfoView, createLatestQueue,
  geoErrorMessage, nearestCity, shouldVibrate, loadErrorMessage, inBbox, zoneSummaryText, NEAREST_CITY_MAX_KM,
} from '../js/uilogic.js';

const CITIES = { trojmiasto: {}, gzm: {} };
const REAL_CITIES = JSON.parse(fs.readFileSync(new URL('../data/cities.json', import.meta.url), 'utf8'));

// --- czas ---------------------------------------------------------------------

test('warsawNow: lato (UTC+2) i zima (UTC+1)', () => {
  assert.deepEqual(warsawNow(new Date('2026-07-15T10:30:00Z')), { ymd: '20260715', minutes: 12 * 60 + 30, weekday: 3 });
  assert.deepEqual(warsawNow(new Date('2026-01-15T10:30:00Z')), { ymd: '20260115', minutes: 11 * 60 + 30, weekday: 4 });
});

test('warsawNow: przejście przez północ liczone w Warszawie, nie w UTC', () => {
  // 22:30 UTC w lecie = 00:30 następnego dnia w Warszawie
  const r = warsawNow(new Date('2026-07-14T22:30:00Z'));
  assert.equal(r.ymd, '20260715');
  assert.equal(r.minutes, 30);
  assert.equal(r.weekday, 3);
  // 23:30 UTC zimą = 00:30 następnego dnia; sylwester → Nowy Rok
  const ny = warsawNow(new Date('2026-12-31T23:30:00Z'));
  assert.equal(ny.ymd, '20270101');
  assert.equal(ny.minutes, 30);
});

test('warsawNow: zmiana czasu — 2026-03-29 02:00 CET → 03:00 CEST', () => {
  assert.equal(warsawNow(new Date('2026-03-29T00:59:00Z')).minutes, 1 * 60 + 59); // CET
  assert.equal(warsawNow(new Date('2026-03-29T01:00:00Z')).minutes, 3 * 60);      // CEST
});

test('warsawNow: niezależny od strefy procesu (TZ innej niż polska)', () => {
  const prev = process.env.TZ;
  try {
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      assert.deepEqual(warsawNow(new Date('2026-07-15T10:30:00Z')), { ymd: '20260715', minutes: 750, weekday: 3 }, tz);
    }
  } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
});

test('dayTypeOf: niedziela, sobota, reszta', () => {
  assert.equal(dayTypeOf(0), 'sunday');
  assert.equal(dayTypeOf(6), 'saturday');
  for (const d of [1, 2, 3, 4, 5]) assert.equal(dayTypeOf(d), 'workday');
});

test('HHMM: północ, koniec doby, zawijanie wartości ujemnych i >24h', () => {
  assert.equal(HHMM(0), '00:00');
  assert.equal(HHMM(86399), '23:59');
  assert.equal(HHMM(86400), '00:00');
  assert.equal(HHMM(-60), '23:59');
  assert.equal(HHMM(-1), '23:59');
  assert.equal(HHMM(25 * 3600 + 5 * 60), '01:05');
  assert.equal(HHMM(8 * 3600 + 30 * 60 + 59.9), '08:30'); // ułamek sekundy nie przeskakuje minuty
});

test('fmtClock i fmtDate', () => {
  assert.equal(fmtClock(0), '00:00');
  assert.equal(fmtClock(8 * 60 + 5), '08:05');
  assert.equal(fmtClock(23 * 60 + 59), '23:59');
  assert.equal(fmtDate('20261116'), '16.11.2026');
  for (const bad of [null, undefined, '', '2026-11-16', '2026111', '202611161', 'abcdefgh']) {
    assert.equal(fmtDate(bad), null, String(bad));
  }
});

// --- adres URL -------------------------------------------------------------------

test('parseUrlState: pusty adres nie ustawia niczego', () => {
  assert.deepEqual(parseUrlState('', CITIES), { dayFromUrl: false, pointFromUrl: false, veh: null });
  assert.deepEqual(parseUrlState('?', CITIES), { dayFromUrl: false, pointFromUrl: false, veh: null });
});

test('parseUrlState: pełny adres', () => {
  const u = parseUrlState('?city=gzm&p=50.25,19.02&p2=50.3,19.1&cmp=1&dir=to&walk=0&acc=bike&mode=general&t=07:45&day=sunday&st=1&safe=1&veh=tram,bus', CITIES);
  assert.equal(u.city, 'gzm');
  assert.deepEqual(u.point, { lat: 50.25, lng: 19.02 });
  assert.deepEqual(u.point2, { lat: 50.3, lng: 19.1 });
  assert.equal(u.pointFromUrl, true);
  assert.equal(u.compare, true);
  assert.equal(u.direction, 'to');
  assert.equal(u.walk, false);
  assert.equal(u.access, 'bike');
  assert.equal(u.mode, 'general');
  assert.equal(u.timeMin, 7 * 60 + 45);
  assert.equal(u.day, 'sunday');
  assert.equal(u.dayFromUrl, true);
  assert.equal(u.stats, true);
  assert.equal(u.safe, true);
  assert.deepEqual([...u.veh].sort(), ['bus', 'tram']);
});

test('parseUrlState: wartości nieprawidłowe są ignorowane', () => {
  const u = parseUrlState('?city=atlantyda&p=abc&p2=1,2,3&cmp=0&dir=sideways&walk=1&acc=jetpack&mode=x&t=25:99x&day=holiday&st=0&safe=2', CITIES);
  assert.deepEqual(u, { dayFromUrl: false, pointFromUrl: false, veh: null });
  assert.equal(parseUrlState('?p=54.3', CITIES).point, undefined);       // jedno pole
  assert.equal(parseUrlState('?p=54.3,NaN', CITIES).point, undefined);   // NaN
  assert.equal(parseUrlState('?p=54.3,Infinity', CITIES).point, undefined);
});

test('parseUrlState: godzina obcinana do 23:59, format ścisły', () => {
  assert.equal(parseUrlState('?t=99:99', CITIES).timeMin, 23 * 60 + 59);
  assert.equal(parseUrlState('?t=7:05', CITIES).timeMin, 7 * 60 + 5);
  assert.equal(parseUrlState('?t=00:00', CITIES).timeMin, 0);
  assert.equal(parseUrlState('?t=0705', CITIES).timeMin, undefined);
  assert.equal(parseUrlState('?t=07:5', CITIES).timeMin, undefined);
});

test('parseUrlState: acc=foot i inne wartości nie zmieniają dostępu; ujemne współrzędne działają', () => {
  assert.equal(parseUrlState('?acc=foot', CITIES).access, undefined);
  assert.equal(parseUrlState('?acc=bike-onboard', CITIES).access, 'bike-onboard');
  assert.deepEqual(parseUrlState('?p=-33.9,-70.6', CITIES).point, { lat: -33.9, lng: -70.6 });
});

test('parseUrlState: veh puste („?veh=") to zbiór z pustym kluczem, brak veh to null', () => {
  assert.equal(parseUrlState('', CITIES).veh, null);
  const e = parseUrlState('?veh=', CITIES).veh;
  assert.ok(e instanceof Set);
  assert.deepEqual([...e], ['']); // żaden prawdziwy klucz nie pasuje → wszystkie pojazdy wyłączone
});

test('parseUrlState: przyjmuje URLSearchParams i string z „?" lub bez', () => {
  const a = parseUrlState(new URLSearchParams('city=gzm'), CITIES);
  const b = parseUrlState('city=gzm', CITIES);
  const c = parseUrlState('?city=gzm', CITIES);
  assert.equal(a.city, 'gzm');
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test('wantsMainEngine', () => {
  assert.equal(wantsMainEngine('?engine=main'), true);
  assert.equal(wantsMainEngine('?engine=worker'), false);
  assert.equal(wantsMainEngine(''), false);
  assert.equal(wantsMainEngine(new URLSearchParams('engine=main')), true);
});

const baseState = () => ({
  city: 'trojmiasto',
  point: { lat: 54.352, lng: 18.6466 },
  point2: { lat: 54.4, lng: 18.5 },
  compare: false, direction: 'from', walk: true, access: 'foot',
  mode: 'time', timeMin: 8 * 60 + 5, day: 'workday', stats: false, safe: false,
  veh: { tram: true, bus: true },
});

test('buildQuery: stan domyślny — krótki adres', () => {
  assert.equal(buildQuery(baseState()),
    '?city=trojmiasto&p=54.35200%2C18.64660&dir=from&walk=1&mode=time&t=08%3A05&day=workday');
});

test('buildQuery: tryb ogólny pomija t i day; parametry opcjonalne pojawiają się tylko po włączeniu', () => {
  const q = new URLSearchParams(buildQuery({ ...baseState(), mode: 'general', safe: true, access: 'bike-onboard', walk: false, direction: 'to' }));
  assert.equal(q.get('mode'), 'general');
  assert.equal(q.has('t'), false);
  assert.equal(q.has('day'), false);
  assert.equal(q.get('safe'), '1');
  assert.equal(q.get('acc'), 'bike-onboard');
  assert.equal(q.get('walk'), '0');
  assert.equal(q.get('dir'), 'to');
  assert.equal(q.has('cmp'), false);
});

test('buildQuery: porównanie dodaje p2, a statystyki są w nim pomijane', () => {
  const q = new URLSearchParams(buildQuery({ ...baseState(), compare: true, stats: true }));
  assert.equal(q.get('cmp'), '1');
  assert.equal(q.get('p2'), '54.40000,18.50000');
  assert.equal(q.has('st'), false);
  assert.equal(new URLSearchParams(buildQuery({ ...baseState(), stats: true })).get('st'), '1');
});

test('buildQuery: veh tylko gdy coś wyłączono; wszystkie wyłączone → puste veh=', () => {
  assert.equal(new URLSearchParams(buildQuery(baseState())).has('veh'), false);
  assert.equal(new URLSearchParams(buildQuery({ ...baseState(), veh: { tram: true, bus: false } })).get('veh'), 'tram');
  assert.equal(new URLSearchParams(buildQuery({ ...baseState(), veh: { tram: false, bus: false } })).get('veh'), '');
});

test('buildQuery → parseUrlState: pełna rundka zachowuje stan', () => {
  const st = { ...baseState(), compare: true, direction: 'to', walk: false, access: 'bike', safe: true, day: 'saturday', timeMin: 23 * 60 + 59, veh: { tram: false, bus: true } };
  const u = parseUrlState(buildQuery(st), CITIES);
  assert.deepEqual(u.point, st.point);
  assert.deepEqual(u.point2, st.point2);
  assert.equal(u.compare, true);
  assert.equal(u.direction, 'to');
  assert.equal(u.walk, false);
  assert.equal(u.access, 'bike');
  assert.equal(u.safe, true);
  assert.equal(u.day, 'saturday');
  assert.equal(u.timeMin, 23 * 60 + 59);
  assert.deepEqual([...u.veh], ['bus']);
});

test('buildQuery: współrzędne zaokrąglane do 5 miejsc', () => {
  const q = new URLSearchParams(buildQuery({ ...baseState(), point: { lat: 54.123456789, lng: 18.987654321 } }));
  assert.equal(q.get('p'), '54.12346,18.98765');
});

// --- teksty interfejsu ----------------------------------------------------------------

test('reducedMotionFrom: brak matchMedia → fałsz', () => {
  assert.equal(reducedMotionFrom(undefined), false);
  assert.equal(reducedMotionFrom(null), false);
  assert.equal(reducedMotionFrom({}), false);
  assert.equal(reducedMotionFrom({ matches: false }), false);
  assert.equal(reducedMotionFrom({ matches: true }), true);
});

test('accessIcons: rower ma ten, kto zaczyna podróż', () => {
  assert.deepEqual(accessIcons('foot', 'from'), { atPoint: '🚶', atTarget: '🚶' });
  assert.deepEqual(accessIcons('bike', 'from'), { atPoint: '🚲', atTarget: '🚶' });
  assert.deepEqual(accessIcons('bike', 'to'), { atPoint: '🚶', atTarget: '🚲' });
  assert.deepEqual(accessIcons('bike-onboard', 'from'), { atPoint: '🚲', atTarget: '🚲' });
  assert.deepEqual(accessIcons('bike-onboard', 'to'), { atPoint: '🚲', atTarget: '🚲' });
});

test('statusLine: tryb pieszy ignoruje czas i margines', () => {
  const base = { walkOnly: true, compare: false, direction: 'from', mode: 'time', safe: true, whenTime: 'X' };
  assert.equal(statusLine(base), 'Zasięg pieszo z punktu.');
  assert.equal(statusLine({ ...base, direction: 'to' }), 'Obszar z dojściem pieszo do punktu.');
  assert.equal(statusLine({ ...base, compare: true }), 'Wspólny zasięg pieszo dwóch punktów.');
});

test('statusLine: dojazd — czas, tryb ogólny, margines', () => {
  const base = { walkOnly: false, compare: false, direction: 'from', mode: 'time', safe: false, whenTime: 'Dzień roboczy, 08:30' };
  assert.equal(statusLine(base), 'Zasięg z punktu · Dzień roboczy, 08:30.');
  assert.equal(statusLine({ ...base, mode: 'general' }), 'Zasięg z punktu · tryb ogólny (bez oczekiwania).');
  assert.equal(statusLine({ ...base, safe: true }), 'Zasięg z punktu · Dzień roboczy, 08:30 · z marginesem na opóźnienia.');
  assert.equal(statusLine({ ...base, direction: 'to' }), 'Obszar z dojazdem do punktu · Dzień roboczy, 08:30.');
  assert.equal(statusLine({ ...base, compare: true }), 'Wspólny zasięg dwóch punktów · Dzień roboczy, 08:30.');
  assert.equal(statusLine({ ...base, compare: true, direction: 'to' }), 'Obszar z dojazdem do obu punktów · Dzień roboczy, 08:30.');
});

const noNotice = { date: '20261116', regime: null, regimeMismatch: false, holiday: null, todayHoliday: null, todayShortened: false };
const ctx = { dayFromUrl: false, day: 'workday', todayDay: 'workday' };

test('dayInfoView: brak uwag → pusty tekst; brak daty → „—"', () => {
  const v = dayInfoView(noNotice, ctx);
  assert.deepEqual(v, { feedDate: '16.11.2026', feedDateNote: '', text: '', offerSunday: false });
  assert.equal(dayInfoView({ ...noNotice, date: null }, ctx).feedDate, '—');
});

test('dayInfoView: święto — propozycja niedzieli tylko gdy wybór nie był świadomy', () => {
  const n = { ...noNotice, todayHoliday: 'Wszystkich Świętych' };
  const v = dayInfoView(n, ctx);
  assert.equal(v.offerSunday, true);
  assert.equal(v.text, 'Dziś święto (Wszystkich Świętych) — komunikacja jedzie zwykle rozkładem niedzielnym.');
  assert.equal(dayInfoView(n, { ...ctx, dayFromUrl: true }).offerSunday, false);
  assert.equal(dayInfoView(n, { ...ctx, day: 'saturday' }).text, '');
  assert.equal(dayInfoView(n, { ...ctx, todayDay: 'saturday' }).text, '');
});

test('dayInfoView: rozkład skrócony nie proponuje niedzieli', () => {
  const v = dayInfoView({ ...noNotice, todayHoliday: 'Wigilia', todayShortened: true }, ctx);
  assert.equal(v.offerSunday, false);
  assert.match(v.text, /^Dziś Wigilia — komunikacja jedzie rozkładem skróconym/);
});

test('dayInfoView: rozbieżność reżimu — wakacyjny i szkolny, z datą lub bez', () => {
  const summer = dayInfoView({ ...noNotice, regime: 'summer', regimeMismatch: true, date: '20260715' }, ctx);
  assert.equal(summer.feedDateNote, ' (rozkład wakacyjny)');
  assert.equal(summer.text, 'Rozkład pochodzi z okresu wakacyjnego (15.07) — w ciągu roku szkolnego kursów jest więcej.');
  const school = dayInfoView({ ...noNotice, regime: 'school', regimeMismatch: true, date: null }, ctx);
  assert.equal(school.text, 'Rozkład pochodzi z roku szkolnego — w wakacje kursów jest mniej.');
  assert.equal(school.feedDateNote, '');
});

test('dayInfoView: kilka uwag łączone spacją, w ustalonej kolejności', () => {
  const v = dayInfoView({ ...noNotice, todayHoliday: 'X', regime: 'school', regimeMismatch: true, holiday: 'Y' }, ctx);
  const [a, b, c] = [v.text.indexOf('Dziś święto'), v.text.indexOf('Rozkład pochodzi'), v.text.indexOf('Rozkład z dnia świątecznego (Y)')];
  assert.ok(a === 0 && b > a && c > b);
});

// --- kolejka workera ---------------------------------------------------------------------

test('createLatestQueue: pojedyncze zadanie wykonuje się raz', async () => {
  const seen = [];
  const q = createLatestQueue(async j => { seen.push(j); });
  await q.push('a');
  assert.deepEqual(seen, ['a']);
});

test('createLatestQueue: w trakcie pracy wygrywa tylko najnowsze, starsze odpadają', async () => {
  const seen = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const q = createLatestQueue(async j => { if (j === 1) await gate; seen.push(j); });
  const done = q.push(1);
  q.push(2);
  q.push(3);
  q.push(4);
  release();
  await done;
  assert.deepEqual(seen, [1, 4]);
});

test('createLatestQueue: błąd idzie do onError z zadaniem, kolejka żyje dalej', async () => {
  const errors = [];
  const seen = [];
  const q = createLatestQueue(async j => {
    if (j === 'zle') throw new Error('boom');
    seen.push(j);
  }, (err, job) => errors.push([err.message, job]));
  await q.push('zle');
  await q.push('dobre');
  assert.deepEqual(errors, [['boom', 'zle']]);
  assert.deepEqual(seen, ['dobre']);
});

test('createLatestQueue: bez onError błąd nie zatrzymuje pętli ani nie rzuca', async () => {
  const q = createLatestQueue(async () => { throw new Error('x'); });
  await q.push(1);
  await q.push(2);
});

test('createLatestQueue: po opróżnieniu przyjmuje kolejne zadania', async () => {
  const seen = [];
  const q = createLatestQueue(async j => { seen.push(j); });
  await q.push(1);
  await q.push(2);
  assert.deepEqual(seen, [1, 2]);
});

// --- geolokalizacja, wibracja, offline (Z-002 etap 2) -----------------------------

test('geoErrorMessage: kody 1, 2, 3 i nieznany', () => {
  assert.match(geoErrorMessage(1), /Odmówiono zgody/);
  assert.match(geoErrorMessage(1), /przywrócić w ustawieniach strony/);
  assert.match(geoErrorMessage(2), /Brak sygnału/);
  assert.match(geoErrorMessage(3), /zbyt długo/);
  assert.equal(geoErrorMessage(undefined), 'Nie udało się pobrać lokalizacji.');
  assert.equal(geoErrorMessage(99), geoErrorMessage(undefined));
});

test('shouldVibrate: tylko przy wsparciu, bez reduced-motion i po >= 1,5 s', () => {
  const ok = { supported: true, reduceMotion: false, elapsedMs: 1500 };
  assert.equal(shouldVibrate(ok), true);
  assert.equal(shouldVibrate({ ...ok, supported: false }), false);
  assert.equal(shouldVibrate({ ...ok, reduceMotion: true }), false);
  assert.equal(shouldVibrate({ ...ok, elapsedMs: 1499 }), false);
});

test('shouldVibrate (Z-048): userActivated:false blokuje, true i brak informacji nie', () => {
  const ok = { supported: true, reduceMotion: false, elapsedMs: 2000 };
  assert.equal(shouldVibrate({ ...ok, userActivated: false }), false);
  assert.equal(shouldVibrate({ ...ok, userActivated: true }), true);
  // brak navigator.userActivation -> undefined: nie blokuje
  assert.equal(shouldVibrate({ ...ok, userActivated: undefined }), true);
  assert.equal(shouldVibrate(ok), true);
});

test('nearestCity: Gdańsk, Kraków, poza wszystkim (Bałtyk)', () => {
  assert.equal(nearestCity(54.35, 18.65, REAL_CITIES), 'trojmiasto');
  assert.equal(nearestCity(50.06, 19.94, REAL_CITIES), 'krakow');
  assert.equal(nearestCity(55.5, 18.5, REAL_CITIES), null);
  assert.equal(inBbox(54.35, 18.65, REAL_CITIES.trojmiasto.bbox), true);
});

// Z-049: próg liczony od krawędzi bbox, nie od środka.
const BOX = { a: { bbox: [50, 20, 51, 21], center: [50.5, 20.5] } };
const LAT_KM = 111.32;

test('nearestCity (Z-049): tuż za granicą miasta dostaje propozycję', () => {
  assert.equal(nearestCity(50.5, 21 + 0.01, BOX), 'a');
  assert.equal(nearestCity(51 + 5 / LAT_KM, 20.5, BOX), 'a');
  // rzeczywiste dane: 6 km za północną krawędzią Trójmiasta
  const [, , n, e] = REAL_CITIES.trojmiasto.bbox;
  assert.equal(nearestCity(n + 6 / LAT_KM, (REAL_CITIES.trojmiasto.bbox[1] + e) / 2, REAL_CITIES), 'trojmiasto');
});

test('nearestCity (Z-049): daleko od wszystkiego -> null', () => {
  assert.equal(nearestCity(51 + 40 / LAT_KM, 20.5, BOX), null);
  assert.equal(nearestCity(50.5, 25, BOX), null);
});

test('nearestCity (Z-049): granica progu jest włączna i jednoznaczna', () => {
  assert.equal(NEAREST_CITY_MAX_KM, 15);
  assert.equal(nearestCity(51 + (NEAREST_CITY_MAX_KM - 0.05) / LAT_KM, 20.5, BOX), 'a');
  assert.equal(nearestCity(51 + (NEAREST_CITY_MAX_KM + 0.05) / LAT_KM, 20.5, BOX), null);
});

test('nearestCity (Z-049): miasto bez bbox liczone od center; wybiera bliższe', () => {
  const cs = { x: { center: [50, 20] }, y: { bbox: [50, 20.5, 50.1, 20.6], center: [50.05, 20.55] } };
  assert.equal(nearestCity(50.05, 20.05, cs), 'x');
  assert.equal(nearestCity(50.05, 20.45, cs), 'y');
  assert.equal(nearestCity(50, 21, {}), null);
});

test('loadErrorMessage: offline wprost, online zostaje stary komunikat', () => {
  assert.match(loadErrorMessage(false, 'x'), /offline/);
  assert.equal(loadErrorMessage(true, 'x'), 'x');
});

// --- komunikat dla czytników ekranu (Z-045) ----------------------------------------

const ZS_ROWS = [
  { label: 'do 10 min', maxKm: 1.25, areaPct: 0.5 },
  { label: '10–20 min', maxKm: 0, areaPct: 0 },
  { label: '20–30 min', maxKm: null, areaPct: null },
  { label: '30–45 min', maxKm: 12.34, areaPct: 12.4 },
];
const ZS = { statusText: 'Zasięg z punktu · tryb ogólny.', city: 'Kraków', reachable: 42, walkOnly: false, compare: false, stats: null, showArea: false };

test('zoneSummaryText A: zasięgi pasm, bez zerowych, przecinek dziesiętny', () => {
  const t = zoneSummaryText({ ...ZS, stats: ZS_ROWS });
  assert.equal(t, 'Zasięg z punktu · tryb ogólny. Miasto: Kraków. Zasięg w linii prostej od punktu: '
    + 'do 10 min — 1,3 km, 30–45 min — 12,3 km. Przystanków w zasięgu: 42.');
  assert.ok(!t.includes('10–20'));
  assert.ok(!t.includes('20–30'));
  assert.ok(!/\d\.\d/.test(t.replace('tryb ogólny.', '')));
});

test('zoneSummaryText A: kolumna „% miasta" dopisana po zasięgu pasma', () => {
  const t = zoneSummaryText({ ...ZS, stats: ZS_ROWS, showArea: true });
  assert.match(t, /do 10 min — 1,3 km, 0,5% miasta/);
  assert.match(t, /30–45 min — 12,3 km, 12% miasta/);
});

test('zoneSummaryText B: bez statystyk — liczba przystanków i podpowiedź', () => {
  assert.equal(zoneSummaryText(ZS),
    'Zasięg z punktu · tryb ogólny. Miasto: Kraków. Przystanków w zasięgu: 42. '
    + 'Włącz „Pokaż statystyki", aby usłyszeć zasięgi w kilometrach.');
});

test('zoneSummaryText B: porównanie — bez dopisku o statystykach', () => {
  const t = zoneSummaryText({ ...ZS, compare: true });
  assert.equal(t, 'Zasięg z punktu · tryb ogólny. Miasto: Kraków. Przystanków w zasięgu: 42.');
  assert.ok(!t.includes('statystyki'));
});

test('zoneSummaryText: tylko pieszo — sam status i miasto, bez przystanków', () => {
  const t = zoneSummaryText({ ...ZS, walkOnly: true, reachable: 0, statusText: 'Zasięg pieszo z punktu.' });
  assert.equal(t, 'Zasięg pieszo z punktu. Miasto: Kraków.');
});

test('zoneSummaryText C: brak przystanków — istniejący komunikat', () => {
  assert.equal(zoneSummaryText({ ...ZS, reachable: 0 }),
    'Brak przystanków w zasięgu — wybierz punkt bliżej miasta.');
});

test('index.html i css: region #zoneSummary, legenda z rolami, .sr-only (Z-045)', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(html, /<p[^>]*id="zoneSummary"[^>]*role="status"/);
  assert.match(html, /<p[^>]*id="zoneSummary"[^>]*aria-live="polite"/);
  assert.match(html, /<p[^>]*id="status"[^>]*aria-live="off"/);
  assert.match(html, /class="legend" role="group" aria-labelledby="legendTitle"/);
  assert.match(html, /id="legendTitle"/);
  assert.match(html, /id="legendBar" role="list"/);
  assert.match(css, /\.sr-only\s*\{[^}]*clip-path/);
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /setAttribute\('role', 'listitem'\)/);
  assert.match(app, /setAttribute\('aria-label', band\.label\)/);
  assert.equal((app.match(/sw\.setAttribute\('aria-hidden', 'true'\)/g) || []).length, 2);
});

// --- ostatnie punkty (Z-015) ------------------------------------------------------

import {
  parseRecentPoints, pushRecentPoint, recentForCity, serializeRecentPoints,
  zonesToGeoJSON, exportFileName, shouldShowIntro, EXPORT_SOURCE,
} from '../js/uilogic.js';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const DAYMS = 86400000;
const pt = (label, lat, lng, city = 'trojmiasto', ts = NOW - 1000) => ({ label, lat, lng, city, ts });
const raw = items => JSON.stringify({ v: 1, items });

test('parseRecentPoints: pusty tekst, zły JSON, zła wersja, brak items -> []', () => {
  assert.deepEqual(parseRecentPoints('', { nowMs: NOW }), []);
  assert.deepEqual(parseRecentPoints(null, { nowMs: NOW }), []);
  assert.deepEqual(parseRecentPoints('{nie json', { nowMs: NOW }), []);
  assert.deepEqual(parseRecentPoints(JSON.stringify({ v: 2, items: [pt('A', 1, 2)] }), { nowMs: NOW }), []);
  assert.deepEqual(parseRecentPoints(JSON.stringify({ v: 1 }), { nowMs: NOW }), []);
  assert.deepEqual(parseRecentPoints('[]', { nowMs: NOW }), []);
});

test('parseRecentPoints: odrzuca wpisy z brakującymi polami', () => {
  const items = [
    pt('ok', 54.35, 18.64),
    { label: 'bez lat', lng: 1, city: 'x', ts: NOW - 5 },
    { label: '', lat: 1, lng: 2, city: 'x', ts: NOW - 5 },
    { lat: 1, lng: 2, city: 'x', ts: NOW - 5 },
    { label: 'bez miasta', lat: 1, lng: 2, ts: NOW - 5 },
    { label: 'tekst zamiast liczby', lat: '1', lng: 2, city: 'x', ts: NOW - 5 },
    null,
  ];
  const out = parseRecentPoints(raw(items), { nowMs: NOW });
  assert.deepEqual(out.map(e => e.label), ['ok']);
});

test('parseRecentPoints: 90 dni — granica włącznie, starszy odpada; ts z przyszłości odpada', () => {
  const items = [
    pt('świeży', 1, 2, 'c', NOW - 10),
    pt('równo 90 dni', 3, 4, 'c', NOW - 90 * DAYMS),
    pt('91 dni', 5, 6, 'c', NOW - 91 * DAYMS),
    pt('z przyszłości', 7, 8, 'c', NOW + DAYMS),
  ];
  assert.deepEqual(parseRecentPoints(raw(items), { nowMs: NOW }).map(e => e.label), ['świeży', 'równo 90 dni']);
  assert.deepEqual(parseRecentPoints(raw(items), { nowMs: NOW, maxAgeDays: 30 }).map(e => e.label), ['świeży']);
});

test('pushRecentPoint: nowy na górze, nie mutuje wejścia', () => {
  const list = Object.freeze([pt('A', 54.1, 18.1)]);
  const out = pushRecentPoint(list, pt('B', 54.2, 18.2));
  assert.deepEqual(out.map(e => e.label), ['B', 'A']);
  assert.equal(list.length, 1);
});

test('pushRecentPoint: dublet po zaokrągleniu do 5 miejsc wędruje na górę i nie zwiększa długości', () => {
  const list = [pt('B', 54.2, 18.2), pt('A', 54.123456, 18.654321)];
  const out = pushRecentPoint(list, pt('A nowa nazwa', 54.1234561, 18.6543209));
  assert.equal(out.length, 2);
  assert.equal(out[0].label, 'A nowa nazwa');
  // różnica w 5. miejscu to już inny punkt
  assert.equal(pushRecentPoint(list, pt('X', 54.12347, 18.654321)).length, 3);
});

test('pushRecentPoint: przekroczenie limitu obcina najstarszy', () => {
  let list = [];
  for (let i = 0; i < 14; i++) list = pushRecentPoint(list, pt(`P${i}`, 50 + i * 0.01, 20));
  assert.equal(list.length, 12);
  assert.equal(list[0].label, 'P13');
  assert.equal(list[11].label, 'P2');
  assert.equal(pushRecentPoint(list, pt('Z', 1, 1), { max: 3 }).length, 3);
});

test('recentForCity: filtr po mieście, kolejność listy, limit 5', () => {
  const list = [
    pt('g1', 1, 1, 'gzm'), pt('t1', 2, 2), pt('t2', 3, 3), pt('g2', 4, 4, 'gzm'),
    pt('t3', 5, 5), pt('t4', 6, 6), pt('t5', 7, 7), pt('t6', 8, 8),
  ];
  assert.deepEqual(recentForCity(list, 'trojmiasto').map(e => e.label), ['t1', 't2', 't3', 't4', 't5']);
  assert.deepEqual(recentForCity(list, 'gzm', { limit: 1 }).map(e => e.label), ['g1']);
  assert.deepEqual(recentForCity(list, 'brak'), []);
});

test('serializeRecentPoints -> parseRecentPoints: round-trip', () => {
  const list = [pt('Gdańsk, Długa 1', 54.35, 18.65), pt('B', 54.4, 18.5, 'gzm')];
  assert.deepEqual(parseRecentPoints(serializeRecentPoints(list), { nowMs: NOW }), list);
  assert.deepEqual(parseRecentPoints(serializeRecentPoints([]), { nowMs: NOW }), []);
});

// --- GeoJSON (Z-008) ----------------------------------------------------------------

/** Pierścień [lat, lon, …] z listy [lon, lat]. */
const flatRing = lonlat => Float64Array.from(lonlat.flatMap(([lon, lat]) => [lat, lon]));
const area = ring => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
};
// zewnętrzny: CW w (lon, lat); dziura: CCW — odwrotnie niż wymaga RFC 7946
const OUTER_CW = [[20, 50], [20, 50.1], [20.1, 50.1], [20.1, 50]];
const HOLE_CCW = [[20.04, 50.04], [20.06, 50.04], [20.06, 50.06], [20.04, 50.06]];
const band = (limit, color, rings, poly) => ({ limit, color, rings, bbox: rings.map(() => new Float64Array(4)), poly: Int32Array.from(poly) });
const META = { city: 'trojmiasto', city_name: 'Trójmiasto', point: [50.05, 20.05], compare: false, walk: true };

test('zonesToGeoJSON: puste contours -> FeatureCollection bez Feature', () => {
  const g = zonesToGeoJSON([], META);
  assert.equal(g.type, 'FeatureCollection');
  assert.deepEqual(g.features, []);
  assert.equal(g.metadata.city, 'trojmiasto');
  assert.equal(g.metadata.source, EXPORT_SOURCE);
});

test('zonesToGeoJSON: pasmo bez pierścieni jest pomijane', () => {
  const g = zonesToGeoJSON([band(10, '#fff', [], []), band(20, '#000', [flatRing(OUTER_CW)], [0])], META);
  assert.equal(g.features.length, 1);
  assert.equal(g.features[0].properties.minutes_max, 20);
  assert.equal(g.features[0].properties.minutes_min, 10);
});

test('zonesToGeoJSON: pasmo z dziurą -> jeden MultiPolygon, jeden wielokąt z dwoma pierścieniami', () => {
  const g = zonesToGeoJSON([band(10, '#fdc527', [flatRing(OUTER_CW), flatRing(HOLE_CCW)], [0, 0])], META);
  const geom = g.features[0].geometry;
  assert.equal(geom.type, 'MultiPolygon');
  assert.equal(geom.coordinates.length, 1);
  assert.equal(geom.coordinates[0].length, 2);
});

test('zonesToGeoJSON: osobne wielokąty wg poly[]', () => {
  const far = [[21, 51], [21, 51.1], [21.1, 51.1], [21.1, 51]];
  const g = zonesToGeoJSON([band(10, '#fdc527', [flatRing(OUTER_CW), flatRing(HOLE_CCW), flatRing(far)], [0, 0, 1])], META);
  assert.deepEqual(g.features[0].geometry.coordinates.map(p => p.length), [2, 1]);
});

test('zonesToGeoJSON: kolejność współrzędnych to [lon, lat]', () => {
  const g = zonesToGeoJSON([band(10, '#fdc527', [flatRing(OUTER_CW)], [0])], META);
  for (const [lon, lat] of g.features[0].geometry.coordinates[0][0]) {
    assert.ok(lon >= 20 && lon <= 20.1, `lon ${lon}`);
    assert.ok(lat >= 50 && lat <= 50.1, `lat ${lat}`);
  }
});

test('zonesToGeoJSON: zaokrąglenie do 5 miejsc', () => {
  const ring = flatRing([[20.123456789, 50.987654321], [20.2, 50.987654321], [20.2, 51.1], [20.123456789, 51.1]]);
  const g = zonesToGeoJSON([band(10, '#fdc527', [ring], [0])], META);
  const pts = g.features[0].geometry.coordinates[0][0];
  for (const v of pts.flat()) assert.equal(v, Math.round(v * 1e5) / 1e5);
  assert.ok(pts.some(([lon, lat]) => lon === 20.12346 && lat === 50.98765));
});

test('zonesToGeoJSON: RFC 7946 — zewnętrzny CCW, dziura CW, niezależnie od wejścia', () => {
  for (const [outer, hole] of [[OUTER_CW, HOLE_CCW], [[...OUTER_CW].reverse(), [...HOLE_CCW].reverse()]]) {
    const g = zonesToGeoJSON([band(10, '#fdc527', [flatRing(outer), flatRing(hole)], [0, 0])], META);
    const [o, h] = g.features[0].geometry.coordinates[0];
    assert.ok(area(o) > 0, 'zewnętrzny CCW');
    assert.ok(area(h) < 0, 'dziura CW');
  }
});

test('zonesToGeoJSON: każdy pierścień domknięty i ma >= 4 pozycje', () => {
  const g = zonesToGeoJSON([band(10, '#fdc527', [flatRing(OUTER_CW), flatRing(HOLE_CCW)], [0, 0])], META);
  for (const poly of g.features[0].geometry.coordinates) {
    for (const ring of poly) {
      assert.ok(ring.length >= 4);
      assert.deepEqual(ring[0], ring[ring.length - 1]);
    }
  }
});

test('zonesToGeoJSON: kolejność od najchłodniejszego, kumulatywne min/max, etykieta i kolor', () => {
  const g = zonesToGeoJSON([
    band(10, '#aa0000', [flatRing(OUTER_CW)], [0]),
    band(20, '#00aa00', [flatRing(OUTER_CW)], [0]),
    band(30, '#0000aa', [flatRing(OUTER_CW)], [0]),
  ], META);
  assert.deepEqual(g.features.map(f => f.properties.minutes_max), [30, 20, 10]);
  const p10 = g.features[2].properties, p20 = g.features[1].properties;
  assert.equal(p10.label, 'do 10 min');
  assert.equal(p20.label, '10–20 min');
  assert.equal(p20.minutes_min, 10);
  assert.equal(p20.color, '#00aa00');
  assert.equal(p20.fill, '#00aa00');
  assert.equal(typeof p20['fill-opacity'], 'number');
});

test('zonesToGeoJSON: metadane w metadata i w properties każdego Feature; undefined znika', () => {
  const g = zonesToGeoJSON([band(10, '#fdc527', [flatRing(OUTER_CW)], [0])], { ...META, point2: undefined });
  assert.deepEqual(g.metadata.point, [50.05, 20.05]);
  assert.ok(!('point2' in g.metadata));
  for (const f of g.features) {
    assert.equal(f.properties.city_name, 'Trójmiasto');
    assert.equal(f.properties.walk, true);
    assert.equal(f.properties.source, EXPORT_SOURCE);
  }
  const cmp = zonesToGeoJSON([band(10, '#fdc527', [flatRing(OUTER_CW)], [0])], { ...META, compare: true, point2: [51, 21] });
  assert.deepEqual(cmp.features[0].properties.point2, [51, 21]);
  assert.doesNotThrow(() => JSON.stringify(g));
});

test('exportFileName: pojedynczy i porównanie, zero-padding, bezpieczne znaki', () => {
  assert.equal(exportFileName({ city: 'trojmiasto', compare: false, timeMin: 8 * 60 + 5 }, '20261116'),
    'izochrona-trojmiasto-20261116-0805.geojson');
  assert.equal(exportFileName({ city: 'gzm', compare: true, timeMin: 0 }, '20261116'),
    'izochrona-gzm-2pkt-20261116-0000.geojson');
  const odd = exportFileName({ city: 'a/b:c*?"<>| ..\\x', compare: false, timeMin: 23 * 60 + 59 }, '20261116');
  assert.match(odd, /^[A-Za-z0-9_.-]+$/);
  assert.ok(odd.endsWith('-2359.geojson'));
});

// --- wskazówka pierwszej wizyty (Z-009) ----------------------------------------------

test('shouldShowIntro: tablica prawdy 2x2x2 — tylko !seen && !consentPending && !pointFromUrl', () => {
  for (const seen of [null, '1']) {
    for (const consentPending of [false, true]) {
      for (const pointFromUrl of [false, true]) {
        const want = seen === null && !consentPending && !pointFromUrl;
        assert.equal(shouldShowIntro({ seen, consentPending, pointFromUrl }), want,
          `seen=${seen} consent=${consentPending} url=${pointFromUrl}`);
      }
    }
  }
});

test('shouldShowIntro: seen — null, "1", true i śmieci', () => {
  const base = { consentPending: false, pointFromUrl: false };
  assert.equal(shouldShowIntro({ ...base, seen: null }), true);
  assert.equal(shouldShowIntro({ ...base, seen: '1' }), false);
  assert.equal(shouldShowIntro({ ...base, seen: true }), false);
  assert.equal(shouldShowIntro({ ...base, seen: 'śmieci' }), true);
  assert.equal(shouldShowIntro({ ...base, seen: undefined }), true);
});

// --- znaczniki HTML (Z-008, Z-009, Z-015) --------------------------------------------

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('index.html: #intro ukryty w znaczniku, przyciski type=button', () => {
  assert.match(indexHtml, /<section class="intro" id="intro"[^>]*\shidden>/);
  assert.match(indexHtml, /<button type="button" id="introOk">/);
  assert.match(indexHtml, /<button type="button" class="intro-link" id="introHelp">/);
  assert.ok(indexHtml.indexOf('id="hint"') < indexHtml.indexOf('id="intro"'));
  assert.ok(indexHtml.indexOf('id="intro"') < indexHtml.indexOf('<fieldset class="control">'));
});

test('index.html: #exportBtn stoi między #shareBtn a .coffee-btn i startuje wyłączony', () => {
  const a = indexHtml.indexOf('id="shareBtn"'), b = indexHtml.indexOf('id="exportBtn"'), c = indexHtml.indexOf('class="coffee-btn"');
  assert.ok(a > 0 && a < b && b < c);
  assert.match(indexHtml, /id="exportBtn" type="button" disabled/);
});

// --- wyszukiwanie przystanków (Z-056) ---------------------------------------------

test('normalizeStopQuery: diakrytyki, ł, separatory, spacje, pusty', () => {
  assert.equal(normalizeStopQuery('Żabianka-AWFiS'), 'zabianka awfis');
  assert.equal(normalizeStopQuery('Łąkowa'), 'lakowa');
  assert.equal(normalizeStopQuery('  Gdańsk   Wrzeszcz  PKP '), 'gdansk wrzeszcz pkp');
  assert.equal(normalizeStopQuery(''), '');
  assert.equal(normalizeStopQuery(null), '');
});

const mkNet = rows => ({
  nStops: rows.length,
  stopName: rows.map(r => r[0]),
  lat: Float64Array.from(rows.map(r => r[1])),
  lon: Float64Array.from(rows.map(r => r[2])),
});

test('buildStopIndex: 6 słupków zespołu = 1 wpis, ta sama nazwa 20 km dalej = 2', () => {
  const pole = i => ['Dworzec Główny', 54.3560 + i * 0.0003, 18.6430 + i * 0.0003];
  const net = mkNet([0, 1, 2, 3, 4, 5].map(pole).concat([['Dworzec Główny', 54.5360, 18.6430]]));
  const ix = buildStopIndex(net);
  assert.equal(ix.names.length, 2);
  assert.ok(ix.lat instanceof Float64Array && ix.lon instanceof Float64Array);
  assert.equal(ix.lat.length, 2);
});

test('buildStopIndex: zespół na granicy komórki siatki nadal daje jeden wpis (Z-056)', () => {
  // 54.3499/54.3501 leżą po dwóch stronach granicy 0,01 stopnia, a dzieli je 22 m.
  // Klucz siatkowy dawał tu dwa identyczne wiersze w podpowiedziach.
  const ix = buildStopIndex(mkNet([
    ['Wrzeszcz PKP', 54.3499, 18.6099],
    ['Wrzeszcz PKP', 54.3501, 18.6101],
  ]));
  assert.deepEqual(ix.names, ['Wrzeszcz PKP']);
});

test('buildStopIndex: ta sama nazwa tuż za progiem skupiska = dwa wpisy', () => {
  // 0,02 stopnia szerokości to ok. 2,2 km, czyli powyżej STOP_CLUSTER_KM.
  const ix = buildStopIndex(mkNet([
    ['Ratuszowa', 52.2300, 21.0100],
    ['Ratuszowa', 52.2500, 21.0100],
  ]));
  assert.equal(ix.names.length, 2);
});

test('buildStopIndex: pusta sieć i puste nazwy', () => {
  assert.deepEqual(buildStopIndex(mkNet([])).names, []);
  assert.equal(buildStopIndex(mkNet([['', 54, 18], ['A', 54, 18]])).names.length, 1);
});

test('searchStops: prefiks nazwy < prefiks słowa < podciąg; limit; brak trafień; 1 znak', () => {
  const ix = buildStopIndex(mkNet([
    ['Stary Wrzeszcz', 54.1, 18.1],       // podciąg w słowie? nie — prefiks słowa
    ['Gdańsk Wrzeszcz PKP', 54.2, 18.2],  // prefiks słowa
    ['Wrzeszcz', 54.3, 18.3],             // prefiks nazwy
    ['Nowowrzeszczyn', 54.4, 18.4],       // podciąg
  ]));
  const r = searchStops(ix, 'wrzesz');
  assert.deepEqual(r.map(x => x.rank), [0, 1, 1, 2]);
  assert.equal(r[0].name, 'Wrzeszcz');
  assert.equal(r[3].name, 'Nowowrzeszczyn');
  assert.equal(searchStops(ix, 'wrzesz', { limit: 2 }).length, 2);
  assert.deepEqual(searchStops(ix, 'xyz'), []);
  assert.deepEqual(searchStops(ix, 'w'), []);
  assert.deepEqual(searchStops(null, 'wrzesz'), []);
  assert.equal(searchStops(ix, 'WRZEŚZ').length, 4); // wielkość liter i diakrytyki bez znaczenia
  assert.ok(Array.isArray(ix._norm));
});

test('mergeSearchResults: przystanki przed adresami, limit, puste wejścia, stabilność', () => {
  const stops = [{ name: 'A', lat: 1, lon: 2 }, { name: 'B', lat: 3, lon: 4 }];
  const places = [{ label: 'ul. X', lat: 5, lng: 6 }];
  const m = mergeSearchResults(stops, places);
  assert.deepEqual(m.map(x => [x.label, x.source]), [['A', 'stop'], ['B', 'stop'], ['ul. X', 'place']]);
  assert.deepEqual(m[0], { label: 'A', lat: 1, lng: 2, source: 'stop' });
  assert.equal(mergeSearchResults(stops, places, { limit: 2 }).length, 2);
  assert.deepEqual(mergeSearchResults([], []), []);
  assert.equal(mergeSearchResults(null, places).length, 1);
  assert.deepEqual(mergeSearchResults(stops, places), m);
});

// --- zwijane sekcje panelu (Z-059) -----------------------------------------------

import {
  PANEL_SECTION_IDS, parseSectionState, serializeSectionState,
  timeSectionSummary, accessSectionSummary, delaySectionSummary, dataSectionSummary, fmtIsoDate,
} from '../js/uilogic.js';

const DEF = { timeMin: 8 * 60 + 15, day: 'workday' };
const GROUPS5 = [
  { key: 'tram', label: '🚋 Tramwaj' }, { key: 'bus', label: '🚌 Autobus' },
  { key: 'trol', label: '🚎 Trolejbus' }, { key: 'rail', label: '🚆 Kolej' }, { key: 'metro', label: '🚇 Metro' },
];
const allOn = gs => Object.fromEntries(gs.map(g => [g.key, true]));

test('timeSectionSummary: wartości domyślne nie są „zmienione"', () => {
  assert.deepEqual(timeSectionSummary({ mode: 'time', timeMin: 495, day: 'workday', direction: 'from' }, DEF),
    { text: '08:15 · dzień roboczy · z miejsca', changed: false });
});

test('timeSectionSummary: tryb ogólny bez godziny, kierunek „do miejsca", inny dzień i godzina', () => {
  assert.deepEqual(timeSectionSummary({ mode: 'general', timeMin: 495, day: 'workday', direction: 'from' }, DEF),
    { text: 'ogólnie · z miejsca', changed: true });
  assert.deepEqual(timeSectionSummary({ mode: 'time', timeMin: 18 * 60 + 30, day: 'saturday', direction: 'to' }, DEF),
    { text: '18:30 · sobota · do miejsca', changed: true });
  assert.equal(timeSectionSummary({ mode: 'time', timeMin: 500, day: 'workday', direction: 'from' }, DEF).changed, true);
  assert.equal(timeSectionSummary({ mode: 'time', timeMin: 495, day: 'sunday', direction: 'from' }, DEF).changed, true);
});

test('accessSectionSummary: domyślnie „pieszo · wszystkie środki"', () => {
  assert.deepEqual(accessSectionSummary({ walk: true, access: 'foot', groups: GROUPS5, veh: allOn(GROUPS5) }),
    { text: 'pieszo · wszystkie środki', changed: false });
});

test('accessSectionSummary: rower, brak spaceru, lista do trzech nazw bez emoji', () => {
  const veh = { ...allOn(GROUPS5), trol: false, rail: false, metro: false };
  assert.deepEqual(accessSectionSummary({ walk: true, access: 'bike', groups: GROUPS5, veh }),
    { text: 'rowerem · tramwaj, autobus', changed: true });
  assert.deepEqual(accessSectionSummary({ walk: false, access: 'foot', groups: GROUPS5, veh: allOn(GROUPS5) }),
    { text: 'bez spaceru · wszystkie środki', changed: true });
  assert.equal(accessSectionSummary({ walk: true, access: 'bike-onboard', groups: GROUPS5, veh: allOn(GROUPS5) }).text,
    'rowerem w pojeździe · wszystkie środki');
});

test('accessSectionSummary: trzy nazwy wprost, powyżej „N z M środków", wszystkie odznaczone = tylko pieszo', () => {
  const three = { ...allOn(GROUPS5), rail: false, metro: false };
  assert.equal(accessSectionSummary({ walk: true, access: 'foot', groups: GROUPS5, veh: three }).text,
    'pieszo · tramwaj, autobus, trolejbus');
  const four = { ...allOn(GROUPS5), metro: false };
  assert.deepEqual(accessSectionSummary({ walk: true, access: 'foot', groups: GROUPS5, veh: four }),
    { text: 'pieszo · 4 z 5 środków', changed: true });
  const none = Object.fromEntries(GROUPS5.map(g => [g.key, false]));
  assert.deepEqual(accessSectionSummary({ walk: true, access: 'foot', groups: GROUPS5, veh: none }),
    { text: 'tylko pieszo', changed: true });
});

test('accessSectionSummary: jeden środek (filtr ukryty) — tylko o dojściu', () => {
  const one = [{ key: 'bus', label: '🚌 Autobus' }];
  assert.deepEqual(accessSectionSummary({ walk: true, access: 'foot', groups: one, veh: { bus: true } }),
    { text: 'pieszo', changed: false });
});

test('delaySectionSummary: standardowo / ostrożny / statystyki; w porównaniu statystyk nie ma', () => {
  assert.deepEqual(delaySectionSummary({ safe: false, stats: false, compare: false }), { text: 'standardowo', changed: false });
  assert.deepEqual(delaySectionSummary({ safe: true, stats: true, compare: false }), { text: 'ostrożny · statystyki', changed: true });
  assert.deepEqual(delaySectionSummary({ safe: false, stats: true, compare: false }), { text: 'standardowo · statystyki', changed: true });
  assert.deepEqual(delaySectionSummary({ safe: false, stats: true, compare: true }), { text: 'standardowo', changed: false });
});

test('dataSectionSummary: data ISO, rozkład nieaktualny, brak danych', () => {
  assert.equal(fmtIsoDate('20261110'), '2026-11-10');
  assert.equal(fmtIsoDate(null), null);
  assert.equal(fmtIsoDate('2026-11-10'), null);
  assert.deepEqual(dataSectionSummary({ feedDate: '20261110', stale: false }), { text: 'rozkład z 2026-11-10', changed: false });
  assert.deepEqual(dataSectionSummary({ feedDate: '20261110', stale: true }), { text: 'rozkład nieaktualny', changed: true });
  assert.deepEqual(dataSectionSummary({ feedDate: null, stale: false }), { text: 'źródła i kontakt', changed: false });
});

test('parseSectionState: pusty tekst, zły JSON, nie-obiekt, nieznane id, złe typy, brakujące', () => {
  assert.deepEqual(parseSectionState(''), {});
  assert.deepEqual(parseSectionState(null), {});
  assert.deepEqual(parseSectionState('{zepsuty'), {});
  assert.deepEqual(parseSectionState('[true]'), {});
  assert.deepEqual(parseSectionState('42'), {});
  assert.deepEqual(parseSectionState('{"secTime":true,"obcy":true,"secAccess":"tak","secData":false}'),
    { secTime: true, secData: false });
});

test('serializeSectionState: tylko znane id i bool, odczyt oddaje to samo', () => {
  const map = { secTime: true, secDelay: false, obcy: true, secData: 'x' };
  const raw = serializeSectionState(map);
  assert.deepEqual(parseSectionState(raw), { secTime: true, secDelay: false });
  assert.equal(serializeSectionState(undefined), '{}');
});

// --- znaczniki i CSS sekcji (Z-059) --------------------------------------------------

const sectionsCss = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

test('index.html: każda sekcja to <details> z <summary>, id zgodne z PANEL_SECTION_IDS', () => {
  for (const id of PANEL_SECTION_IDS) {
    assert.match(indexHtml, new RegExp(`<details class="sec[^"]*" id="${id}">\\s*<summary>`), id);
    assert.match(indexHtml, new RegExp(`id="${id}Sum"`));
    assert.match(indexHtml, new RegExp(`<span class="sr-only" id="${id}Flag" hidden>— zmienione ustawienia</span>`));
  }
  assert.ok(!/<details[^>]*\sopen[\s>]/.test(indexHtml), 'żadna sekcja nie startuje otwarta');
});

/** Fragment HTML sekcji `<details id=...>` do jej zamknięcia. */
const sectionHtml = id => {
  const at = indexHtml.indexOf(`id="${id}"`);
  return indexHtml.slice(at, indexHtml.indexOf('</details>', at));
};

test('index.html: #status, #diagBox, #dataWarn i legenda nie są w żadnej sekcji', () => {
  for (const id of ['status', 'diagBox', 'dataWarn', 'legendBar', 'zoneSummary']) {
    for (const sec of PANEL_SECTION_IDS) assert.ok(!sectionHtml(sec).includes(`id="${id}"`), `${id} w ${sec}`);
  }
});

test('index.html: zawartość sekcji — Czas, Kierunek, Dojście, Środki, Opóźnienia, statystyki, stopka', () => {
  const t = sectionHtml('secTime'), a = sectionHtml('secAccess'), d = sectionHtml('secDelay'), p = sectionHtml('secData');
  for (const id of ['modeTime', 'timeInput', 'daySelect', 'dayNote', 'dirFrom', 'dirTo']) assert.ok(t.includes(`id="${id}"`), id);
  for (const id of ['walkToggle', 'accessSelect', 'vehGrid']) assert.ok(a.includes(`id="${id}"`), id);
  for (const id of ['safeToggle', 'safeNote', 'statsToggle', 'statsBox']) assert.ok(d.includes(`id="${id}"`), id);
  assert.ok(p.includes('class="credits"') && p.includes('class="coffee-btn"'));
  for (const sec of [t, a, d, p]) assert.ok(!/<h2/.test(sec), 'drugi <h2> obok summary');
});

test('index.html: „Dane i kontakt" jest dzieckiem .panel (po #panelBody), nie #panelBody', () => {
  const bodyStart = indexHtml.indexOf('id="panelBody"');
  const secAt = indexHtml.indexOf('id="secData"');
  assert.ok(secAt > bodyStart && secAt < indexHtml.indexOf('</main>'));
  // tuż przed sekcją zamyka się #panelBody (wcięcie 4 spacji = wcięcie <div class="panel-body">)
  assert.match(indexHtml.slice(bodyStart, secAt), /\n {4}<\/div>\s*<details class="sec sec-pinned"\s*$/);
});

test('index.html: rząd dwóch przycisków, #exportBtn z pełnym aria-label, krok 3 wskazówki kieruje do sekcji', () => {
  assert.match(indexHtml, /<div class="action-row">\s*<button class="share-btn" id="shareBtn" type="button">Kopiuj link<\/button>\s*<button class="share-btn" id="exportBtn"/);
  assert.match(indexHtml, /id="exportBtn"[^>]*aria-label="Pobierz strefy \(GeoJSON\)"[^>]*>Pobierz strefy<\/button>/);
  assert.match(indexHtml, /<li>W sekcji „Czas i kierunek” ustaw/);
});

test('style.css: summary min-height var(--tap), focus z offsetem -2px, marker domyślny usunięty', () => {
  assert.match(sectionsCss, /\.sec > summary \{[^}]*min-height: var\(--tap\)/);
  assert.match(sectionsCss, /\.sec > summary \{[^}]*list-style: none/);
  assert.ok(sectionsCss.includes('.sec > summary::-webkit-details-marker { display: none; }'));
  assert.match(sectionsCss, /\.sec > summary:focus-visible \{[^}]*outline: 2px solid var\(--accent\);[^}]*outline-offset: -2px/);
  assert.match(sectionsCss, /\.sec-pinned \.sec-body \{[^}]*max-height: 28vh;[^}]*overflow-y: auto/);
  assert.match(sectionsCss, /\.sec-pinned \{[^}]*flex: none/);
});

test('style.css: .ad-box:has(unfilled) ukryty, bez rezerwacji wysokości reklamy', () => {
  assert.ok(sectionsCss.includes('.ad-box:has(ins[data-ad-status="unfilled"]) { display: none; }'));
  assert.ok(!/\.ad-box\s*\{[^}]*min-height/.test(sectionsCss));
});

test('app.js: stan sekcji w jednym kluczu localStorage, nie w adresie URL', () => {
  const appSrc = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(appSrc.includes('PANEL_SECTIONS_KEY') && appSrc.includes("addEventListener('toggle'"));
  const src = fs.readFileSync(new URL('../js/uilogic.js', import.meta.url), 'utf8');
  const build = src.slice(src.indexOf('export function buildQuery'), src.indexOf('export const reducedMotionFrom'));
  assert.ok(!/sec[A-Z]|panel-sections/.test(build), 'buildQuery nie może znać sekcji');
});
