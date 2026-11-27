import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readState, writeState, normalizeState, recordAttempt, ageDays } from '../tools/osm-state.mjs';
import { selectCities, run } from '../tools/osm-rotate.mjs';

const TODAY = new Date('2026-11-27T12:00:00Z');
const state = cities => normalizeState({ cities });
const e = (lastAttempt, result = 'ok') => ({ lastAttempt, lastSuccess: result === 'ok' ? lastAttempt : undefined, result });
const keysOf = picks => picks.map(p => p.key);

test('stan: brak pliku i uszkodzony JSON dają pusty stan, nieznane klucze są ignorowane', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-state-'));
  assert.deepEqual(readState(path.join(dir, 'brak.json')), { version: 1, cities: {} });
  fs.writeFileSync(path.join(dir, 'zly.json'), '{ nie json');
  assert.deepEqual(readState(path.join(dir, 'zly.json')), { version: 1, cities: {} });
  const raw = { version: 9, inne: 1, cities: { a: { lastAttempt: '2026-01-01', result: 'ok', nieznany: 'x' }, b: 'śmieć', c: { lastAttempt: 'wczoraj' } } };
  assert.deepEqual(normalizeState(raw), { version: 1, cities: { a: { lastAttempt: '2026-01-01', result: 'ok' } } });
});

test('stan: zapis atomowy, posortowane klucze, odczyt zwraca to samo; recordAttempt przesuwa lastSuccess tylko przy ok', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osm-state-')), 'sub', 'osm-state.json');
  let s = recordAttempt(normalizeState(null), 'zz', { date: '2026-11-01', result: 'ok', note: 'pierwsze' });
  s = recordAttempt(s, 'aa', { date: '2026-11-02', result: 'gate', note: 'bramka' });
  s = recordAttempt(s, 'zz', { date: '2026-11-20', result: 'error' });
  assert.equal(s.cities.zz.lastSuccess, '2026-11-01'); // nieudana próba nie rusza powodzenia
  assert.equal(s.cities.zz.lastAttempt, '2026-11-20');
  assert.equal(s.cities.zz.note, undefined);
  assert.equal(s.cities.aa.lastSuccess, undefined);
  writeState(s, file);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).cities), ['aa', 'zz']);
  assert.deepEqual(readState(file), s);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['osm-state.json']);
  assert.throws(() => recordAttempt(s, 'x', { date: '2026-11-01', result: 'cokolwiek' }));
  assert.equal(ageDays('2026-11-17', TODAY), 10);
  assert.equal(ageDays('nie data', TODAY), null);
});

test('rotacja: kolejność po wieku ostatniej próby, najstarsze pierwsze', () => {
  const st = state({ a: e('2026-01-10'), b: e('2025-12-01'), c: e('2026-03-01') });
  assert.deepEqual(keysOf(selectCities(['a', 'b', 'c'], st, { today: TODAY })), ['b', 'a', 'c']);
});

test('rotacja: limit (domyślnie 3) i próg wieku (150 dni, ostro większy)', () => {
  const st = state({ a: e('2025-01-01'), b: e('2025-02-01'), c: e('2025-03-01'), d: e('2025-04-01'), f: e('2026-06-30') /* 150 dni */, g: e('2026-06-29') /* 151 */ });
  assert.deepEqual(keysOf(selectCities(['a', 'b', 'c', 'd', 'f', 'g'], st, { today: TODAY })), ['a', 'b', 'c']);
  assert.deepEqual(keysOf(selectCities(['a', 'b', 'c', 'd'], st, { today: TODAY, limit: 1 })), ['a']);
  assert.deepEqual(keysOf(selectCities(['f', 'g'], st, { today: TODAY })), ['g']);
  assert.deepEqual(selectCities(['a'], st, { today: TODAY, limit: 0 }), []);
});

test('rotacja: brak pliku stanu = wszystkie miasta nowe, w kolejności z cities.json, po trzy', () => {
  const picks = selectCities(['x', 'y', 'z', 'w'], normalizeState(null), { today: TODAY });
  assert.deepEqual(keysOf(picks), ['x', 'y', 'z']);
  assert.ok(picks.every(p => p.reason === 'nowe'));
});

test('rotacja: miasto nowo dodane (brak wpisu) wyprzedza nawet najstarsze', () => {
  const st = state({ a: e('2020-01-01'), b: e('2021-01-01') });
  assert.deepEqual(keysOf(selectCities(['a', 'b', 'nowe'], st, { today: TODAY, limit: 2 })), ['nowe', 'a']);
});

test('rotacja: miasto pominięte (bez wpisu o próbie) zachowuje starą datę i wraca na początek', () => {
  // przebieg 1: wybrano a, b, c; awaria przerwała po a — zapisano tylko a
  let st = state({ a: e('2025-01-01'), b: e('2025-01-02'), c: e('2025-01-03'), d: e('2026-01-01') });
  const first = keysOf(selectCities(['a', 'b', 'c', 'd'], st, { today: TODAY }));
  assert.deepEqual(first, ['a', 'b', 'c']);
  st = recordAttempt(st, 'a', { date: '2026-11-27', result: 'ok' });
  assert.deepEqual(keysOf(selectCities(['a', 'b', 'c', 'd'], st, { today: TODAY })), ['b', 'c', 'd']);
});

test('rotacja: miasto stale nieudane nie zagładza pozostałych', () => {
  // „bad" pada za każdym razem; trzy przebiegi co tydzień, pozostałe są stare i czekają
  const keys = ['bad', 'a', 'b', 'c', 'd'];
  let st = state({ bad: e('2020-01-01'), a: e('2025-01-01'), b: e('2025-01-02'), c: e('2025-01-03'), d: e('2025-01-04') });
  const seen = new Set();
  for (let day = 0; day < 6; day++) {
    const today = new Date(Date.UTC(2026, 10, 27 + day * 7, 12));
    const iso = today.toISOString().slice(0, 10);
    for (const { key } of selectCities(keys, st, { today })) {
      seen.add(key);
      st = recordAttempt(st, key, { date: iso, result: key === 'bad' ? 'error' : 'ok' });
    }
  }
  assert.deepEqual([...seen].sort(), ['a', 'b', 'bad', 'c', 'd']); // wszystkie dostały swoją kolej
  // świeżo nieudane miasto nie zajmuje miejsca przed starszymi ani nowymi
  const st2 = state({ bad: e('2026-11-27', 'error'), a: e('2025-01-01'), b: e('2025-01-02') });
  assert.deepEqual(keysOf(selectCities(['bad', 'a', 'b', 'c', 'd'], st2, { today: new Date('2026-12-04T12:00:00Z') })), ['c', 'd', 'a']);
});

test('rotacja: nieudane miasto jest ponawiane po retryDays, ale za starszymi', () => {
  const st = state({ bad: e('2026-11-01', 'gate'), a: e('2025-01-01'), ok: e('2026-11-10') });
  const picks = selectCities(['bad', 'a', 'ok'], st, { today: TODAY });
  assert.deepEqual(keysOf(picks), ['a', 'bad']);
  assert.equal(picks[1].reason, 'ponowienie');
  assert.deepEqual(keysOf(selectCities(['bad'], state({ bad: e('2026-11-20', 'error') }), { today: TODAY })), []); // 7 dni — za wcześnie
});

test('rotacja: klucz w stanie, którego nie ma w cities.json, jest ignorowany', () => {
  const st = state({ duch: e('2000-01-01'), a: e('2025-01-01') });
  assert.deepEqual(keysOf(selectCities(['a'], st, { today: TODAY })), ['a']);
});

test('CLI: pusty stan, formaty wyjścia, jawna lista pomija rotację, nieznane miasto to błąd', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-rot-'));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'cities.json'), JSON.stringify({ a: {}, b: {}, c: {}, d: {} }));
  const r = run([], { root, today: TODAY });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'a\nb\nc\n');
  assert.equal(run(['--limit', '2', '--format', 'csv'], { root, today: TODAY }).out, 'a,b\n');
  assert.deepEqual(JSON.parse(run(['--limit', '1', '--format', 'json'], { root, today: TODAY }).out), ['a']);
  assert.equal(run(['--cities', 'd,b'], { root, today: TODAY }).out, 'd\nb\n');
  assert.equal(run(['--cities', 'd,zzz'], { root, today: TODAY }).code, 1);
  assert.equal(run(['--limit', 'x'], { root, today: TODAY }).code, 1);
  writeState(state({ a: e('2026-11-26'), b: e('2026-11-26'), c: e('2026-11-26'), d: e('2026-11-26') }), path.join(root, 'data', 'osm-state.json'));
  assert.equal(run([], { root, today: TODAY }).out, '');
});

test('rozmiar: trzy duże czekające dają jedno duże plus dwa mniejsze', () => {
  const st = state({ w: e('2020-01-01'), g: e('2020-01-02'), t: e('2020-01-03'), s1: e('2025-01-01'), s2: e('2025-01-02'), s3: e('2025-01-03') });
  const sizes = { w: 6e6, g: 7e6, t: 3.1e6, s1: 4e5, s2: 4e5, s3: 4e5 };
  const picks = keysOf(selectCities(['w', 'g', 't', 's1', 's2', 's3'], st, { today: TODAY, sizes }));
  assert.deepEqual(picks, ['w', 's1', 's2']); // najstarsze duże, potem małe w kolejności
  assert.deepEqual(keysOf(selectCities(['w', 'g', 't', 's1', 's2', 's3'], st, { today: TODAY, sizes, maxBig: 2 })), ['w', 'g', 's1']);
});

test('rozmiar: same duże czekają — przebieg bierze jedno, nie nic', () => {
  const st = state({ w: e('2020-01-01'), g: e('2020-01-02'), t: e('2020-01-03') });
  assert.deepEqual(keysOf(selectCities(['w', 'g', 't'], st, { today: TODAY, sizes: { w: 6e6, g: 7e6, t: 3.1e6 } })), ['w']);
});

test('rozmiar: jawna lista omija ograniczenie; CLI czyta rozmiar z walknet.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-rot-'));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'cities.json'), JSON.stringify({ a: {}, b: {}, c: {}, d: {} }));
  for (const k of ['a', 'b', 'c']) { fs.mkdirSync(path.join(root, 'data', k)); fs.writeFileSync(path.join(root, 'data', k, 'walknet.json'), 'x'.repeat(3_100_000)); }
  assert.equal(run([], { root, today: TODAY }).out, 'a\nd\n'); // jedno duże + brak pliku (d) = małe
  assert.equal(run(['--cities', 'a,b,c'], { root, today: TODAY }).out, 'a\nb\nc\n');
});
