import test from 'node:test';
import assert from 'node:assert/strict';
import {
  easterSunday, holidayName, specialDayName, dateRegime, pickRepresentativeDate, dayDataNotice,
} from '../js/calendar.js';

const weekdayOf = ymd => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay();

test('Wielkanoc: znane daty', () => {
  assert.equal(easterSunday(2024), '20240331');
  assert.equal(easterSunday(2025), '20250420');
  assert.equal(easterSunday(2026), '20260405');
  assert.equal(easterSunday(2027), '20270328');
});

test('święta: stałe i ruchome', () => {
  assert.equal(holidayName('20261111'), '11 listopada');
  assert.equal(holidayName('20260604'), 'Boże Ciało'); // Wielkanoc 5.04 + 60 dni
  assert.equal(holidayName('20260406'), 'Poniedziałek Wielkanocny');
  assert.equal(holidayName('20260524'), 'Zielone Świątki'); // + 49 dni
  assert.ok(holidayName('20261224'));
  assert.equal(holidayName('20261103'), null);
  assert.equal(specialDayName('20261231'), 'Sylwester');
  assert.equal(specialDayName('20261230'), null);
});

test('reżim: wakacje, przerwa świąteczna, rok szkolny', () => {
  assert.equal(dateRegime('20260715'), 'summer');
  assert.equal(dateRegime('20261229'), 'holiday-season');
  assert.equal(dateRegime('20260104'), 'holiday-season');
  assert.equal(dateRegime('20260401'), 'holiday-season'); // Wielkanoc − 4
  assert.equal(dateRegime('20260406'), 'holiday-season'); // Wielkanoc + 1
  assert.equal(dateRegime('20260407'), 'school');
  assert.equal(dateRegime('20261117'), 'school');
});

test('data reprezentatywna: omija święto, a bez alternatywy bierze pierwszą', () => {
  const wt = w => w >= 2 && w <= 4;
  assert.equal(pickRepresentativeDate(['20261110', '20261111', '20261112'], wt, weekdayOf), '20261110');
  // 11.11.2026 to środa; pierwsza pasująca data jest świąteczna
  assert.equal(pickRepresentativeDate(['20261111', '20261117'], wt, weekdayOf), '20261117');
  assert.equal(pickRepresentativeDate(['20261111'], wt, weekdayOf), '20261111');
  assert.equal(pickRepresentativeDate([], wt, weekdayOf), null);
  assert.equal(pickRepresentativeDate(['20261110'], w => w === 6, weekdayOf), null);
});

test('komunikat o danych: stare meta bez dayInfo', () => {
  const n = dayDataNotice({ dates: { workday: '20261117' } }, 'workday', '20261118');
  assert.equal(n.date, '20261117');
  assert.equal(n.regime, null);
  assert.equal(n.regimeMismatch, false);
  assert.equal(n.holiday, null);
  assert.equal(dayDataNotice(null, 'workday', '20261118').date, null);
});

test('komunikat o danych: niezgodność reżimu, święto dziś, święto w danych', () => {
  const meta = { dates: { workday: '20260814' }, dayInfo: { workday: { date: '20260814', regime: 'summer', holiday: null } } };
  assert.equal(dayDataNotice(meta, 'workday', '20260915').regimeMismatch, true);
  assert.equal(dayDataNotice(meta, 'workday', '20260720').regimeMismatch, false);
  assert.equal(dayDataNotice(meta, 'workday', '20261229').regimeMismatch, false); // przerwa świąteczna nie jest alarmem
  const h = dayDataNotice(meta, 'workday', '20261111');
  assert.equal(h.todayHoliday, '11 listopada');
  assert.equal(h.todayShortened, false);
  assert.equal(dayDataNotice(meta, 'workday', '20261224').todayShortened, true);
  const hm = { dayInfo: { sunday: { date: '20260106', regime: 'holiday-season', holiday: 'Trzech Króli' } } };
  assert.equal(dayDataNotice(hm, 'sunday', '20260301').holiday, 'Trzech Króli');
});
