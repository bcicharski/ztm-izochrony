import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { profileSummary, run } from '../tools/build-delays.mjs';

test('profileSummary: liczy unikalne linie i klucze', () => {
  assert.deepEqual(profileSummary({ '5|0|7': 120, '5|0|8': 60, 'A|1|9': 90 }, 10),
    { routes: 2, routesTotal: 10, keys: 3 });
  assert.deepEqual(profileSummary({}), { routes: 0, routesTotal: null, keys: 0 });
});

test('run: dopisuje meta.delays i nie rusza pozostałych pól', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-'));
  try {
    const w = (rel, obj) => {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), JSON.stringify(obj, null, 2));
    };
    w('data/cities.json', { a: { rt: { type: 'gtfsrt' } }, b: {}, c: {} });
    const meta = {
      city: 'a', generated: 'g', feedEndDate: '20270101', dates: { workday: '20261117' },
      sources: ['s'], routeNames: { 5: '5' }, counts: { routes: 2, days: { workday: { overtaking: 1 } } },
      grid: { outsideStops: 0 }, dayInfo: { workday: 'x' },
    };
    w('data/a/meta.json', meta);
    w('data/a/workday.json', { routes: [{ n: '5' }, { n: 'A' }] });
    w('data/b/meta.json', { city: 'b' });
    fs.mkdirSync(path.join(tmp, 'data/c'), { recursive: true }); // brak meta.json — pominięte
    // 30 obserwacji, wszystkie w kubełku 600 s → p80 = 600
    w('data/agg/a.json', { '5|0|7': [30, 0, 0, 0, 0, 0, 30, 0], _seen: {} });
    run({ root: tmp, srcDir: path.join(tmp, 'data/agg'), today: new Date('2026-11-16T12:00:00Z') });
    const out = JSON.parse(fs.readFileSync(path.join(tmp, 'data/a/meta.json'), 'utf8'));
    const { delays, ...rest } = out;
    assert.deepEqual(rest, meta);
    assert.deepEqual(Object.keys(out), [...Object.keys(meta), 'delays']);
    assert.deepEqual(delays, { routes: 1, routesTotal: 2, keys: 1, updated: '20261116', source: 'gtfsrt' });
    const b = JSON.parse(fs.readFileSync(path.join(tmp, 'data/b/meta.json'), 'utf8'));
    assert.deepEqual(b.delays, { routes: 0, routesTotal: null, keys: 0, updated: '20261116', source: null });
    assert.equal(fs.existsSync(path.join(tmp, 'data/c/meta.json')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
