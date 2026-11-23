import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gateCity, hasDelayProfiles, run } from '../tools/check-data.mjs';

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

test('wyprzedzanie kursów: ostrzeżenie z liczbą, nigdy blokada', () => {
  const withOver = (m, n) => withDays(m, { workday: { ...m.counts.days.workday, overtaking: n } });
  const base = withOver(meta(), 0);
  const r = gate(withOver(meta(), 3), base);
  assert.equal(r.level, 'warn');
  assert.ok(r.findings.some(f => f.includes('3') && f.includes('wyprzedzaniem')), r.findings.join('\n'));
  // nawet ogromna liczba nie blokuje
  assert.equal(gate(withOver(meta(), 5000), base).level, 'warn');
  // 0 = ok
  assert.equal(gate(withOver(meta(), 0), base).level, 'ok');
});

test('wyprzedzanie kursów: niezmieniona liczba nie ostrzega (Z-052)', () => {
  const withOver = (m, n) => withDays(m, { workday: { ...m.counts.days.workday, overtaking: n } });
  // stała cecha feedu: tyle samo wzorców co poprzednio — cisza zamiast cotygodniowego alarmu
  assert.equal(gate(withOver(meta(), 1), withOver(meta(), 1)).level, 'ok');
  // spadek też nie jest zdarzeniem
  assert.equal(gate(withOver(meta(), 1), withOver(meta(), 4)).level, 'ok');
  // dopiero wzrost
  assert.equal(gate(withOver(meta(), 2), withOver(meta(), 1)).level, 'warn');
});

test('wyprzedzanie kursów: brak pola po którejkolwiek stronie = pominięcie', () => {
  const withOver = (m, n) => withDays(m, { workday: { ...m.counts.days.workday, overtaking: n } });
  assert.equal(gate(meta(), meta()).level, 'ok');
  assert.equal(gate(withOver(meta(), 3), meta()).level, 'ok'); // baseline sprzed Z-005
  assert.equal(gate(meta(), withOver(meta(), 0)).level, 'ok');
});

test('profile opóźnień bez meta.delays: ostrzeżenie z wskazaniem naprawy, także bez baseline', () => {
  for (const base of [meta(), null]) {
    const r = gate(meta(), base, { delaysProfiles: true });
    assert.equal(r.level, 'warn');
    assert.ok(r.findings.some(f => f.includes('x:') && f.includes('delays.json') && f.includes('build-delays.mjs')), r.findings.join('\n'));
  }
  assert.equal(gate(meta(), null, { delaysProfiles: true }).noBaseline, true);
});

test('profile opóźnień: meta.delays (nawet routes=0), brak profili albo brak meta = ok', () => {
  const withDelays = meta({ delays: { routes: 0, routesTotal: 100, keys: 0, updated: null, source: 'gtfsrt' } });
  assert.equal(gate(withDelays, meta(), { delaysProfiles: true }).level, 'ok');
  assert.equal(gate(meta(), meta(), { delaysProfiles: false }).level, 'ok');
  assert.equal(gate(meta(), meta()).level, 'ok');
  assert.equal(gate(null, meta(), { delaysProfiles: true }).level, 'ok');
});

test('profile opóźnień: nigdy blokada, także z innym ostrzeżeniem lub blokującym spadkiem', () => {
  const base = meta();
  const r = gate(withDays(base, { workday: day(8500) }), base, { delaysProfiles: true });
  assert.equal(r.level, 'warn');
  assert.equal(r.findings.length, 2);
  assert.ok(r.findings.every(f => f.startsWith('OSTRZEŻENIE')));
  // przy prawdziwej blokadzie notatka o delays pozostaje ostrzeżeniem
  const b = gate(withDays(base, { workday: day(6500) }), base, { delaysProfiles: true });
  assert.equal(b.level, 'block');
  assert.ok(b.findings.some(f => f.startsWith('OSTRZEŻENIE') && f.includes('build-delays.mjs')));
});

test('hasDelayProfiles: {} i brak pliku = false, profile = true (mały i duży plik)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delays-'));
  const f = (name, txt) => { const p = path.join(dir, name); fs.writeFileSync(p, txt); return p; };
  assert.equal(hasDelayProfiles(path.join(dir, 'nie-ma.json')), false);
  assert.equal(hasDelayProfiles(f('a.json', '{}')), false);
  assert.equal(hasDelayProfiles(f('b.json', '{ }\n')), false);
  assert.equal(hasDelayProfiles(f('c.json', '{"100|0|16":900}')), true);
  assert.equal(hasDelayProfiles(f('d.json', JSON.stringify(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`${i}|0|16`, 60]))))), true);
  assert.equal(hasDelayProfiles(f('e.json', 'nie json')), false);
});

test('run: miasto z delays.json i meta bez delays trafia do warned także bez baseline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delays-run-'));
  fs.mkdirSync(path.join(dir, 'data', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'cities.json'), JSON.stringify({ x: { name: 'Xowo' } }));
  fs.writeFileSync(path.join(dir, 'data', 'x', 'meta.json'), JSON.stringify(meta()));
  fs.writeFileSync(path.join(dir, 'data', 'x', 'delays.json'), '{"100|0|16":900}');
  const r = run(['--baseline-dir', path.join(dir, 'nie-ma')], { root: dir, today: TODAY });
  assert.deepEqual(r.gate.warned, ['x']);
  assert.deepEqual(r.gate.noBaseline, []);
  assert.deepEqual(r.gate.blocked, []);
  assert.match(r.out, /build-delays\.mjs/);
  // pusty delays.json = brak ostrzeżenia
  fs.writeFileSync(path.join(dir, 'data', 'x', 'delays.json'), '{}');
  const r2 = run(['--baseline-dir', path.join(dir, 'nie-ma')], { root: dir, today: TODAY });
  assert.equal(r2.code, 0);
  assert.deepEqual(r2.gate.noBaseline, ['x']);
});

// Z-031: dane syntetyczne odwzorowujące stan data/ z 2026-11-16 (udział przystanków
// poza siatką policzony z day-json + gridBbox; stops/outsideStops to rzeczywiste liczby)
const REAL_GRID = {
  warszawa: [7737, 692], krakow: [4389, 258], trojmiasto: [3499, 193], torun: [897, 45],
  poznan: [3354, 106], bydgoszcz: [1182, 33], kielce: [1351, 35], gzm: [7254, 5],
  gorzow: [433, 0], lodz: [2384, 0],
};
const gridMeta = (stops, outside, km = 5) => meta({
  counts: { ...meta().counts, stops },
  grid: { outsideStops: outside, outsideShare: +(outside / stops).toFixed(4), maxOutsideKm: km },
});

test('Z-031: dzisiejszy, stały udział poza siatką (do 8,9%) nie zapala ostrzeżenia', () => {
  for (const [city, [stops, outside]] of Object.entries(REAL_GRID)) {
    const m = gridMeta(stops, outside, 134.7);
    const r = gateCity(city, {}, m, m, { today: TODAY });
    assert.equal(r.level, 'ok', `${city}: ${r.findings.join('; ')}`);
  }
});

test('Z-031: wzrost udziału poza siatką wobec poprzedniego buildu = ostrzeżenie (Warszawa +46 przystanków)', () => {
  const base = gridMeta(7737, 692);
  const r = gate(gridMeta(7737, 738), base); // 8,94% -> 9,54% (+0,6 pp, +46 szt.)
  assert.equal(r.level, 'warn');
  assert.match(r.findings.join('\n'), /poza siatką pieszą: 9[.,]5%/);
  assert.equal(gate(gridMeta(7737, 700), base).level, 'ok'); // +8 szt. = +0,1 pp
});

test('Z-031: wzrost o ≥0,5 pp, ale <5 przystanków (małe miasto) = ok; ≥5 przystanków = ostrzeżenie', () => {
  const base = gridMeta(433, 0);
  assert.equal(gate(gridMeta(433, 3), base).level, 'ok');   // 0,69 pp, +3 szt.
  assert.equal(gate(gridMeta(433, 5), base).level, 'warn'); // 1,15 pp, +5 szt.
});

test('Z-031: brak outsideStops w baseline = decyduje próg względny (kompatybilność ze starym meta)', () => {
  const base = gridMeta(1000, 3); delete base.grid.outsideStops;
  assert.equal(gate(gridMeta(1000, 9), base).level, 'warn'); // +0,6 pp
  assert.equal(gate(gridMeta(1000, 5), base).level, 'ok');   // +0,2 pp
});

test('Z-031: pułap awaryjny 25% łapie błędny gridBbox nawet bez wzrostu', () => {
  const broken = gridMeta(1000, 300, 40);
  const r = gate(broken, broken);
  assert.equal(r.level, 'warn');
  assert.match(r.findings.join('\n'), /30%/);
  assert.equal(gate(gridMeta(1000, 249), gridMeta(1000, 249)).level, 'ok');
});

test('cofnięcie rozkładu: nowy feed kończy się wcześniej niż poprzedni = twarda blokada z obiema datami', () => {
  const r = gate(meta({ feedEndDate: '20261110' }), meta({ feedEndDate: '20261230' }));
  assert.equal(r.level, 'block');
  assert.match(r.findings.join('\n'), /BLOKADA: rozkład cofnięty: nowy feed kończy się 10\.11\.2026, a obecny jest ważny do 30\.12\.2026/);
});

test('cofnięcie rozkładu: daty równe i późniejszy koniec nie blokują', () => {
  assert.equal(gate(meta({ feedEndDate: '20261230' }), meta({ feedEndDate: '20261230' })).level, 'ok');
  assert.equal(gate(meta({ feedEndDate: '20270131' }), meta({ feedEndDate: '20261230' })).level, 'ok');
});

test('cofnięcie rozkładu: brak baseline albo brak feedEndDate po którejkolwiek stronie = brak blokady', () => {
  assert.equal(gate(meta({ feedEndDate: '20261110' }), null).level, 'ok');
  const noEnd = meta();
  delete noEnd.feedEndDate;
  assert.equal(gate(noEnd, meta({ feedEndDate: '20261230' })).level, 'ok');
  assert.equal(gate(meta({ feedEndDate: '20261110' }), noEnd).level, 'ok');
});

test('cofnięcie rozkładu: zawór go nie przepuszcza (stary wygasa w ≤ valveDays)', () => {
  const base = meta({ feedEndDate: '20261119' }); // wygasa za 3 dni — zawór otwarty
  // sam spadek kursów zawór przepuszcza awaryjnie (kontrola)
  assert.equal(gate(withDays(base, { workday: day(5000) }), base).emergency, true);
  // ten sam spadek + cofnięta data = blokada, bez przepuszczenia awaryjnego
  const r = gate(withDays(meta({ feedEndDate: '20261110' }), { workday: day(5000) }), base);
  assert.equal(r.level, 'block');
  assert.equal(r.emergency, false);
  // sama cofnięta data też blokuje
  assert.equal(gate(meta({ feedEndDate: '20261110' }), base).level, 'block');
});

test('cofnięcie rozkładu: force przepuszcza je jak inne twarde znaleziska', () => {
  const r = gate(meta({ feedEndDate: '20261110' }), meta({ feedEndDate: '20261230' }), { force: true });
  assert.equal(r.level, 'warn');
  assert.match(r.findings.join('\n'), /przepuszczone \(force\)/);
});

test('cofnięcie rozkładu: blokuje także bez counts po obu stronach (stary format meta)', () => {
  const old = { city: 'x', feedEndDate: '20261230' };
  const fresh = { city: 'x', feedEndDate: '20261110' };
  const r = gate(fresh, old);
  assert.equal(r.level, 'block');
  assert.equal(r.noBaseline, false);
  assert.match(r.findings.join('\n'), /BLOKADA: rozkład cofnięty: nowy feed kończy się 10\.11\.2026, a obecny jest ważny do 30\.12\.2026/);
  assert.equal(gate(fresh, old, { force: true }).level, 'warn');
  // bez cofnięcia (równe daty, brak daty, brak baseline) wczesne wyjście działa jak dotąd
  assert.equal(gate(old, old).level, 'ok');
  assert.equal(gate(old, old).noBaseline, true);
  assert.equal(gate({ city: 'x' }, old).level, 'ok');
  assert.equal(gate(fresh, null).noBaseline, true);
  assert.equal(gate(null, old).noBaseline, true);
});
