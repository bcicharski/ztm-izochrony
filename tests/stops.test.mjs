import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../js/engine.js';
import { createAsyncCache } from '../js/uilogic.js';
import { makeRaw } from './helpers.mjs';

/*
 * Ścieżka `stops` (Z-056/Z-057/Z-061): Engine.stopIndex — to, co robi worker —
 * oraz cache po stronie UI (createAsyncCache). Wzorzec jak w engine.test.mjs:
 * podmieniony `fetch`, bez przeglądarki i bez prawdziwego workera.
 */
const raw = makeRaw({
  stops: [
    { name: 'Wrzeszcz PKP', lat: 54.496208191, lon: 18.5 },
    { name: 'Wrzeszcz PKP', lat: 54.4962, lon: 18.5001 }, // ten sam zespół
    { name: 'Dworzec Główny', lat: 54.36, lon: 18.64 },
  ],
  routes: [{ n: '1', t: 3 }],
  patterns: [{ r: 0, s: [0, 2], p: [[600]], t: [[28800, 0]] }],
});

const fetched = [];
let gate = null; // Promise wstrzymujący odpowiedź workday.json
let failDay = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  const m = String(url).match(/\/data\/([^/]+)\/(.+)$/);
  if (m && /^(workday|saturday|sunday)\.json$/.test(m[2])) {
    fetched.push(`${m[1]}/${m[2]}`);
    if (gate) await gate;
    if (failDay) return { ok: false, status: 500, json: async () => null };
    return { ok: true, status: 200, json: async () => raw };
  }
  return { ok: false, status: 404, json: async () => null };
};
after(() => { globalThis.fetch = realFetch; });

const CFG = { gridBbox: [54, 18, 55, 19] };
async function makeEngine(city) {
  const engine = new Engine({ createCanvas: () => { throw new Error('canvas niepotrzebny'); } });
  await engine.setCity(city, CFG);
  return engine;
}

test('Engine.stopIndex: indeks załadowanego miasta, współrzędne w Float64 bez utraty dokładności', async () => {
  const e = await makeEngine('tstStopsA');
  const ix = await e.stopIndex('workday');
  assert.deepEqual(ix.names, ['Wrzeszcz PKP', 'Dworzec Główny'], 'zespół o tej samej nazwie to jeden wpis');
  assert.ok(ix.lat instanceof Float64Array && ix.lon instanceof Float64Array);
  assert.equal(ix.lat[0], 54.49621, 'wartość z danych (1e-5), nie zaokrąglenie Float32');
});

test('Engine.stopIndex: null, gdy miasto nie jest załadowane', async () => {
  const e = new Engine({ createCanvas: () => null });
  assert.equal(await e.stopIndex('workday'), null);
});

test('Engine.stopIndex: zmiana miasta w trakcie budowy daje null', async () => {
  const e = await makeEngine('tstStopsB');
  let release;
  gate = new Promise(r => { release = r; });
  const pending = e.stopIndex('saturday'); // nowy dzień → fetch wstrzymany
  await e.setCity('tstStopsC', CFG).catch(() => {});
  release();
  gate = null;
  assert.equal(await pending, null);
});

test('Engine.stopIndex: błąd pobrania odrzuca obietnicę (worker zamienia to na komunikat error)', async () => {
  const e = await makeEngine('tstStopsD');
  failDay = true;
  try { await assert.rejects(e.stopIndex('sunday'), /Nie udało się pobrać/); } finally { failDay = false; }
});

test('createAsyncCache: drugie wywołanie dla tego samego klucza nie przelicza', async () => {
  const c = createAsyncCache(3);
  let calls = 0;
  const load = async () => { calls++; return { n: calls }; };
  const [a, b] = await Promise.all([c.get('k', load), c.get('k', load)]);
  assert.equal(a, b);
  assert.equal(await c.get('k', load), a);
  assert.equal(calls, 1);
  assert.equal(c.peek('k'), a);
  assert.equal(c.peek('inny'), null);
});

test('createAsyncCache: dwa dni/miasta obok siebie — powrót nie przelicza; limit wyrzuca najstarszy', async () => {
  const c = createAsyncCache(3);
  let calls = 0;
  const load = async () => ({ n: ++calls });
  await c.get('m/workday', load); await c.get('m/saturday', load);
  await c.get('m/workday', load); // powrót
  assert.equal(calls, 2);
  await c.get('m/sunday', load); await c.get('x/workday', load); // 4. wpis wypycha najstarszy
  assert.equal(c.peek('m/workday'), null);
  assert.ok(c.peek('x/workday'));
});

test('createAsyncCache: błąd kończy się null i nie zostaje w cache', async () => {
  const c = createAsyncCache(3);
  const origErr = console.error; console.error = () => {};
  try {
    let calls = 0;
    const load = async () => { if (++calls === 1) throw new Error('boom'); return { ok: 1 }; };
    assert.equal(await c.get('k', load), null);
    assert.deepEqual(await c.get('k', load), { ok: 1 }, 'kolejna próba ponawia');
    assert.equal(calls, 2);
  } finally { console.error = origErr; }
});

test('createAsyncCache: wynik null (miasto zmienione) nie jest zapamiętywany', async () => {
  const c = createAsyncCache(3);
  let calls = 0;
  const load = async () => (++calls === 1 ? null : { ok: 1 });
  assert.equal(await c.get('k', load), null);
  assert.deepEqual(await c.get('k', load), { ok: 1 });
});
