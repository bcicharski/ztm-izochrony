/**
 * Logika interfejsu bez DOM (Z-034): js/uilogic.js importujemy wprost —
 * moduł nie dotyka document/window/location, więc działa w node.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
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
