import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gateCity, run } from '../tools/check-data.mjs';

const TODAY = new Date('2026-11-16T12:00:00Z');
const day = (trips, patterns = 500, bytes = 900000) => ({ trips, patterns, bytes });
const meta = (over = {}) => ({
  city: 'x',
  generated: '2026-11-16T03:00:00.000Z',
  feedEndDate: '20270601',
  dates: { workday: '20261117', saturday: '20261121', sunday: '20261122' },
  counts: {
    stops: 1000, routes: 100, transfers: 5000,
    days: { workday: day(10000), saturday: day(7000), sunday: day(6000) },
  },
  grid: { outsideStops: 3, outsideShare: 0.003, maxOutsideKm: 1.2 },
  ...over,
});
const withDays = (m, days) => ({ ...m, counts: { ...m.counts, days: { ...m.counts.days, ...days } } });
const withCounts = (m, c) => ({ ...m, counts: { ...m.counts, ...c } });
const gate = (fresh, base, opts = {}) => gateCity('x', {}, fresh, base, { today: TODAY, ...opts });

test('kursy: −35% i ≥200 = blokada, −15% = ostrzeżenie, −8% = ok', () => {
  const base = meta();
  assert.equal(gate(withDays(base, { workday: day(6500) }), base).level, 'block');
  assert.equal(gate(withDays(base, { workday: day(8500) }), base).level, 'warn');
  assert.equal(gate(withDays(base, { workday: day(9200) }), base).level, 'ok');
});

test('podłoga bezwzględna: linie 8 → 7 (−12,5%) = ok, ale 100 → 70 = blokada', () => {
  const small = withCounts(meta(), { routes: 8 });
  assert.equal(gate(withCounts(small, { routes: 7 }), small).level, 'ok');
  assert.equal(gate(withCounts(meta(), { routes: 70 }), meta()).level, 'block');
});

test('zniknięcie typu dnia z baseline = blokada', () => {
  const base = meta();
  const fresh = meta();
  delete fresh.counts.days.saturday;
  const r = gate(fresh, base);
  assert.equal(r.level, 'block');
  assert.match(r.findings.join('\n'), /sobota/);
});

test('zawór: ten sam przypadek przy baseline wygasającym za 3 dni = ostrzeżenie awaryjne', () => {
  const base = meta({ feedEndDate: '20261119' });
  const fresh = meta();
  delete fresh.counts.days.saturday;
  const soft = withDays(base, {}); // spadek kursów (nie twardy) też schodzi do warn
  const r1 = gate(withDays(soft, { workday: day(5000) }), soft);
  assert.equal(r1.level, 'warn');
  assert.equal(r1.emergency, true);
  assert.match(r1.findings.join('\n'), /PRZEPUSZCZONE AWARYJNIE \(stary rozkład wygasa\)/);
  // zniknięcie typu dnia jest twarde — zawór go nie dotyczy
  assert.equal(gate(fresh, base).level, 'block');
});

test('zawór nie działa dla trips == 0', () => {
  const base = meta({ feedEndDate: '20261119' });
  const r = gate(withDays(base, { workday: day(0) }), base);
  assert.equal(r.level, 'block');
  assert.equal(r.emergency, false);
});

test('zawór działa też dla baseline już wygasłego', () => {
  const base = meta({ feedEndDate: '20261101' });
  assert.equal(gate(withDays(base, { workday: day(5000) }), base).level, 'warn');
});

test('force degraduje blokadę do ostrzeżenia tylko dla wskazanych miast', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const base = meta();
  const bad = withDays(base, { workday: day(5000) });
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'cities.json'), JSON.stringify({ gzm: { name: 'GZM' }, lodz: { name: 'Łódź' } }));
  for (const k of ['gzm', 'lodz']) {
    fs.mkdirSync(path.join(dir, 'data', k));
    fs.writeFileSync(path.join(dir, 'data', k, 'meta.json'), JSON.stringify(bad));
    fs.mkdirSync(path.join(dir, 'base'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'base', `${k}.json`), JSON.stringify(base));
  }
  const args = ['--baseline-dir', path.join(dir, 'base')];
  const plain = run(args, { root: dir, today: TODAY });
  assert.deepEqual(plain.gate.blocked.sort(), ['gzm', 'lodz']);
  const forced = run([...args, '--force', 'gzm'], { root: dir, today: TODAY });
  assert.deepEqual(forced.gate.blocked, ['lodz']);
  assert.deepEqual(forced.gate.warned, ['gzm']);
  const all = run([...args, '--force', 'all'], { root: dir, today: TODAY });
  assert.deepEqual(all.gate.blocked, []);
  assert.deepEqual(all.gate.warned.sort(), ['gzm', 'lodz']);
  assert.match(plain.out, /pole `force`: `gzm`/);
});

test('brak baseline (null) i stary format bez counts = ok + noBaseline', () => {
  assert.deepEqual([gate(meta(), null).level, gate(meta(), null).noBaseline], ['ok', true]);
  const old = meta(); delete old.counts;
  const r = gate(meta(), old);
  assert.equal(r.level, 'ok');
  assert.equal(r.noBaseline, true);
  assert.equal(gate(old, meta()).level, 'ok'); // świeże bez counts: nic do porównania
});

test('siatka: udział przystanków poza siatką 0,3% → 2,8% = ostrzeżenie, nigdy blokada', () => {
  const base = meta();
  const fresh = meta({ grid: { outsideStops: 28, outsideShare: 0.028, maxOutsideKm: 23 } });
  const r = gate(fresh, base);
  assert.equal(r.level, 'warn');
  assert.match(r.findings.join('\n'), /poza siatką/);
  const rise = meta({ grid: { outsideStops: 9, outsideShare: 0.009, maxOutsideKm: 3 } });
  assert.equal(gate(rise, base).level, 'warn'); // wzrost ≥0,5 pp
});

test('wzrost ≥150% to tylko ostrzeżenie', () => {
  const base = meta();
  assert.equal(gate(withCounts(base, { stops: 2600 }), base).level, 'warn');
});

test('--gate-out: kształt JSON i rozłączne listy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const base = meta();
  const cases = {
    a: withDays(base, { workday: day(5000) }),                 // block
    b: withDays(base, { workday: day(8500) }),                 // warn
    c: base,                                                   // ok
    d: (() => { const m = meta(); delete m.counts; return m; })(), // noBaseline
  };
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'base'));
  fs.writeFileSync(path.join(dir, 'data', 'cities.json'), JSON.stringify(Object.fromEntries(Object.keys(cases).map(k => [k, { name: k }]))));
  for (const [k, m] of Object.entries(cases)) {
    fs.mkdirSync(path.join(dir, 'data', k));
    fs.writeFileSync(path.join(dir, 'data', k, 'meta.json'), JSON.stringify(m));
    fs.writeFileSync(path.join(dir, 'base', `${k}.json`), JSON.stringify(base));
  }
  const { gate: g, code } = run(['--baseline-dir', path.join(dir, 'base')], { root: dir, today: TODAY });
  assert.equal(code, 1);
  assert.deepEqual(Object.keys(g).sort(), ['blocked', 'noBaseline', 'ok', 'warned']);
  assert.deepEqual([g.blocked, g.warned, g.ok, g.noBaseline], [['a'], ['b'], ['c'], ['d']]);
  const all = [...g.blocked, ...g.warned, ...g.ok, ...g.noBaseline];
  assert.equal(new Set(all).size, all.length);
});

test('regresja: stare komunikaty (nieaktualny rozkład, brak typów dnia) i kod 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.mkdirSync(path.join(dir, 'data', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'cities.json'), JSON.stringify({ x: { name: 'Iks' } }));
  const old = { generated: '2026-09-18T00:00:00Z', feedEndDate: '20261001', dates: { workday: '20260929' } };
  fs.writeFileSync(path.join(dir, 'data', 'x', 'meta.json'), JSON.stringify(old));
  const r = run(['--skipped', 'x', '--baseline-dir', path.join(dir, 'nie-ma')], { root: dir, today: TODAY });
  assert.equal(r.code, 1);
  assert.match(r.out, /pominięte przez workflow/);
  assert.match(r.out, /brak typów dnia: saturday, sunday/);
  assert.match(r.out, /rozkład NIEAKTUALNY \(ważny do 01\.10\.2026\)/);
  assert.deepEqual(r.gate.noBaseline, ['x']);
  // zdrowe dane: kod 0 i dotychczasowy komunikat
  const ok = { ...old, feedEndDate: '20270101', dates: { workday: 'a', saturday: 'b', sunday: 'c' } };
  fs.writeFileSync(path.join(dir, 'data', 'x', 'meta.json'), JSON.stringify(ok));
  const r2 = run(['--baseline-dir', path.join(dir, 'nie-ma')], { root: dir, today: TODAY });
  assert.equal(r2.code, 0);
  assert.match(r2.out, /Wszystkie 1 miasta w porządku/);
});
