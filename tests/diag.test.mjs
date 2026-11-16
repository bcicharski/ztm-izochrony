import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { report, records, clear, setSink, formatReport, installHandlers, redact, locate } from '../js/diag.js';

beforeEach(() => { clear(); setSink(null); });

test('bufor trzyma max 20 rekordów, najstarsze wypadają', () => {
  for (let i = 0; i < 25; i++) report({ src: 'app', msg: `blad ${i}`, at: 'a.js:1:1' });
  const r = records();
  assert.equal(r.length, 20);
  assert.equal(r[0].msg, 'blad 5');
  assert.equal(r[19].msg, 'blad 24');
});

test('deduplikacja po src|msg|at zwiększa n i nie dodaje wpisu', () => {
  for (let i = 0; i < 3; i++) report({ src: 'data', msg: 'x', at: 'data.js:1:1' });
  report({ src: 'app', msg: 'x', at: 'data.js:1:1' });
  const r = records();
  assert.equal(r.length, 2);
  assert.equal(r[0].n, 3);
  assert.equal(r[1].n, 1);
});

test('redakcja: samo app.js, bez query, hosta i współrzędnych', () => {
  const url = 'https://host.example/js/app.js?lat=54.3521&lon=18.6464#x';
  report({ src: 'window', msg: `Błąd w ${url} dla 54.3521, 18.6464`, at: locate(url, 12, 3) });
  const [r] = records();
  assert.equal(r.at, 'app.js:12:3');
  assert.doesNotMatch(r.msg, /host|lat=|lon=|#x|\?|\d{2}\.\d{4,}/);
  assert.match(r.msg, /app\.js/);
  assert.equal(redact('C:\\Users\\ktos\\js\\worker.js'), 'worker.js');
});

test('ctx: tylko dozwolone klucze i bezpieczne wartości', () => {
  report({ src: 'app', msg: 'm', ctx: { city: 'gdansk', day: 'workday', lat: '54.35', phase: '54.3521', foo: 'x' } });
  assert.deepEqual(records()[0].ctx, { city: 'gdansk', day: 'workday' });
});

test('msg obcięty do 200 znaków, nieznane src -> app', () => {
  report({ src: 'zly', msg: 'a'.repeat(500) });
  const [r] = records();
  assert.equal(r.msg.length, 200);
  assert.equal(r.src, 'app');
});

test('report nie rzuca, gdy sink rzuca; nie rekuruje, gdy sink woła report', () => {
  setSink(() => { throw new Error('boom'); });
  assert.doesNotThrow(() => report({ src: 'app', msg: 'a' }));
  let calls = 0;
  setSink(() => { calls++; report({ src: 'app', msg: 'z sinka' }); });
  assert.doesNotThrow(() => report({ src: 'app', msg: 'b' }));
  assert.equal(calls, 1);
  assert.equal(records().some(r => r.msg === 'z sinka'), false);
  assert.doesNotThrow(() => report(null));
});

test('formatReport: miasto, tryb, silnik, liczba rekordów; bez współrzędnych i URL-a', () => {
  report({ src: 'window', msg: 'https://h/x/app.js?lat=54.3521&lon=18.6464 padl', at: 'app.js:1:1' });
  const t = formatReport({ city: 'gdansk', day: 'workday', mode: 'walk', engine: 'worker' });
  assert.match(t, /gdansk/);
  assert.match(t, /walk/);
  assert.match(t, /worker/);
  assert.match(t, /rekordów: 1/);
  assert.doesNotMatch(t, /\d{2}\.\d{4,}/);
  assert.doesNotMatch(t, /https?:|lat=|\?/);
});

test('installHandlers: błędy i odrzucone obietnice trafiają do bufora', () => {
  const h = {};
  const scope = { addEventListener: (n, f) => { h[n] = f; } };
  installHandlers(scope);
  installHandlers(scope);
  h.error({ message: 'oops', filename: 'https://h/js/worker.js?lat=54.3521', lineno: 51, colno: 7 });
  h.unhandledrejection({ reason: new Error('odrzucone') });
  const r = records();
  assert.equal(r[0].src, 'worker');
  assert.equal(r[0].at, 'worker.js:51:7');
  assert.equal(r[1].msg, 'odrzucone');
});

test('import data.js w Node bez DOM działa, a ślad bez ujścia nic nie rzuca', async () => {
  const data = await import('../js/data.js');
  assert.equal(typeof data.loadMeta, 'function');
  assert.doesNotThrow(() => report({ src: 'data', msg: 'x', phase: 'asset' }));
});
