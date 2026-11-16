/**
 * Bramki tekstowe dla frontu diagnostyki i pokrycia profilami opóźnień
 * (Z-025, Z-017). Bez DOM: pliki czytane jako tekst — pilnują kolejności
 * skryptów, obecności elementów i tego, że do GA nic nie wychodzi przed zgodą.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('index.html');
const app = read('js/app.js');
const worker = read('js/worker.js');

test('index.html: skrypt przechwytujący błędy jest przed pierwszym modułem i przed app.js', () => {
  const capture = html.indexOf('window.__diag = []');
  const firstModule = html.indexOf('<script type="module"');
  assert.ok(capture > 0, 'brak window.__diag');
  assert.ok(firstModule > 0);
  assert.ok(capture < firstModule, 'przechwytywanie musi poprzedzać moduł');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes("addEventListener('error'"), 'brak handlera error w <head>');
  assert.ok(head.includes("addEventListener('unhandledrejection'"), 'brak unhandledrejection w <head>');
  assert.ok(head.includes('window.__appReady'), 'brak sprawdzenia __appReady');
  assert.ok(head.includes('10000'), 'brak 10-sekundowego limitu');
});

test('index.html: elementy diagnostyki i pokrycia opóźnień', () => {
  for (const id of ['diagCopy', 'diagBox', 'diagList', 'delayCoverage', 'safeNote']) {
    assert.match(html, new RegExp(`id="${id}"`), `brak #${id}`);
  }
  assert.match(html, /id="diagBox"[^>]*role="group"[^>]*hidden/);
  assert.match(html, /<textarea[^>]*id="diagText"[^>]*readonly/);
  // #safeNote jak #dayNote: role=status, bez hidden (zmienia się tylko tekst)
  assert.match(html, /<p[^>]*id="safeNote"[^>]*role="status"[^>]*><\/p>/);
  assert.doesNotMatch(html.match(/<p[^>]*id="safeNote"[^>]*>/)[0], /hidden/);
});

test('js/app.js: app_error wysyłany wyłącznie w gałęzi ze zgodą', () => {
  const calls = [...app.matchAll(/gtag\('event'/g)];
  assert.equal(calls.length, 1, 'dokładnie jedno wywołanie gtag(\'event\'');
  const at = calls[0].index;
  const guard = app.lastIndexOf("consentGet?.() === 'granted'", at);
  assert.ok(guard > 0 && at - guard < 600, 'wywołanie musi stać w gałęzi sprawdzającej zgodę');
  // między warunkiem a wywołaniem nie może być zamknięcia gałęzi ani wczesnego wyjścia
  const between = app.slice(guard, at);
  assert.ok(!between.includes('} catch'), 'gałąź zgody zamknięta przed gtag');
  assert.match(app, /GA_MAX_EVENTS = 5/);
  assert.match(app, /gaSent\.has\(key\)/);
  assert.doesNotMatch(app, /let\s+\w*consent\w*\s*=/i, 'zgody nie wolno cache\'ować');
});

test('js/app.js: do GA nie trafia nic poza dozwolonymi polami', () => {
  const ev = app.slice(app.indexOf("gtag('event'"));
  const body = ev.slice(0, ev.indexOf('});'));
  for (const f of ['error_source', 'error_message', 'error_where', 'error_phase', 'app_city', 'app_engine']) {
    assert.ok(body.includes(f), `brak pola ${f}`);
  }
  assert.doesNotMatch(body, /location|userAgent|state\.point|searchInput/);
  assert.match(body, /slice\(0, 100\)/);
});

test('js/app.js: ?diag=1 nie jest zapisywany w adresie, a worker.onmessage obsługuje diag przed pending', () => {
  const upd = app.slice(app.indexOf('function updateUrl'), app.indexOf('\n}\n', app.indexOf('function updateUrl')));
  assert.doesNotMatch(upd, /diag/);
  const diagAt = app.indexOf("m.type === 'diag'");
  assert.ok(diagAt > 0 && diagAt < app.indexOf('pending.get(m.id)'), 'diag musi być przed pending.get');
  assert.match(app, /window\.__appReady = true/);
  assert.match(app, /installHandlers\(window\)/);
});

test('js/worker.js: installHandlers i przekazanie rekordów do wątku głównego', () => {
  assert.match(worker, /installHandlers\(self\)/);
  assert.match(worker, /postMessage\(\{ type: 'diag', record \}\)/);
  assert.equal([...worker.matchAll(/reportError\(err, '/g)].length, 2, 'rekord w obu catch');
});

test('pomoc: akapit o trybie ostrożnym nie mówi „na żywo" ani „w czasie rzeczywistym"', () => {
  const start = html.indexOf('<h3>Opóźnienia (tryb ostrożny)</h3>');
  const para = html.slice(start, html.indexOf('<h3>', start + 10));
  assert.ok(start > 0 && para.length > 100);
  assert.doesNotMatch(para, /na żywo|w czasie rzeczywistym/i);
  assert.match(para, /statystyk/);
});

test('app.js: pokrycie opóźnień — ułamek N z M, bez procentów, unknown milczy', () => {
  const fn = app.slice(app.indexOf('function renderDelayCoverage'), app.indexOf('function renderSafeNote'));
  assert.match(fn, /z \$\{c\.routesTotal\} linii/);
  assert.doesNotMatch(fn, /%/);
  assert.match(fn, /hidden = !text/);
  const note = app.slice(app.indexOf('function renderSafeNote'));
  assert.match(note, /c\.state !== 'unknown'/);
  assert.match(note, /state\.direction === 'to'/);
});
