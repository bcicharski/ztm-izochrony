// Bramki tekstowe dla układu mobilnego (Z-028, Z-029, Z-030 A) — bez DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('css/style.css');
const html = read('index.html');
const app = read('js/app.js');
const mapJs = read('js/map.js');

// Liczba użyć var(--tap) w CSS: 17 po Z-028..Z-030, 19 po dołożeniu przycisków
// z Z-022 (#dayNote button) i Z-025 (#diagCopy, .diag summary), 21 po kontrolce
// lokalizacji z Z-002 (.locate-btn min-width/min-height, .locate-set). Zabezpiecza pola
// dotykowe 44 px: zagęszczanie marginesów ani porządki w CSS nie mogą usunąć
// żadnej deklaracji wysokości. Podnoś tę stałą, gdy dochodzi kolejna kontrolka.
const TAP_USES_MIN = 23; // 23 po .sec > summary (Z-059)

test('offset kontrolek mapy podąża za --panel-h, bez reguły zerującej', () => {
  assert.ok(css.includes('bottom: calc(var(--panel-h, 62vh) + 8px)'));
  assert.ok(!/body\.panel-collapsed\s+\.leaflet-bottom/.test(css));
});

test('atrybucja: doklejka ukryta na mobile tylko przy rozwiniętym panelu, OSM zostaje', () => {
  const media = css.slice(css.indexOf('/* ---------- mobile ---------- */'));
  assert.ok(/body:not\(\.panel-collapsed\)\s+\.attr-extra\s*\{\s*display:\s*none/.test(media));
  // żadnej bezwarunkowej reguły ukrywającej
  assert.ok(!/^\s*\.attr-extra\s*\{\s*display:\s*none/m.test(css));
  assert.ok(/<span class="attr-extra">[^']*Rozkłady/.test(mapJs));
  assert.ok(mapJs.includes('OpenStreetMap'));
});

test('app.js ustawia --panel-h z offsetHeight pod osłoną ResizeObserver', () => {
  assert.ok(app.includes("setProperty('--panel-h'"));
  assert.ok(app.includes('offsetHeight'));
  assert.ok(/typeof ResizeObserver\s*!==\s*'undefined'/.test(app));
});

test('baner zgody: region z etykietą, przed <main>', () => {
  const m = html.match(/<div class="consent"[^>]*>/);
  assert.ok(m);
  assert.ok(m[0].includes('role="region"'));
  assert.ok(/aria-label="[^"]+"/.test(m[0]));
  assert.ok(html.indexOf('class="consent"') < html.indexOf('<main'));
});

test('baner zgody na mobile jest u góry mapy', () => {
  assert.ok(/@media \(max-width: 560px\) \{\s*[^}]*\n\s*\.consent \{[^}]*top: 12px;[^}]*bottom: auto;/.test(css));
});

test('pola dotykowe: liczba var(--tap) nie zmalała', () => {
  const n = css.split('var(--tap)').length - 1;
  assert.ok(n >= TAP_USES_MIN, `var(--tap): ${n} < ${TAP_USES_MIN}`);
});

test('kontrolka lokalizacji: pole dotykowe var(--tap), focus, pozycja przez --panel-h, bez watchPosition', () => {
  const block = css.slice(css.indexOf('.leaflet-bar a.locate-btn {'));
  assert.ok(/min-width:\s*var\(--tap\)/.test(block));
  assert.ok(/min-height:\s*var\(--tap\)/.test(block));
  assert.ok(css.includes('.leaflet-bar a.locate-btn:focus-visible'));
  // kontrolka siedzi w .leaflet-bottom.leaflet-right, które podąża za --panel-h
  assert.ok(mapJs.includes("position: 'bottomright'"));
  assert.ok(!mapJs.includes('watchPosition') && !app.includes('watchPosition'));
  assert.ok(app.includes('addLocateControl') && app.includes('isSecureContext'));
});

test('legenda: jedna w DOM, zostaje widoczna przy zwiniętym panelu', () => {
  assert.equal((html.match(/class="legend"/g) || []).length, 1);
  assert.equal((html.match(/id="legendBar"/g) || []).length, 1);
  assert.ok(/role="group" aria-labelledby="legendTitle"/.test(html));
  assert.ok(/\.panel\.collapsed \.panel-body > :not\(\.legend\)\s*\{\s*display:\s*none/.test(css));
  // kontener nie jest już chowany razem z zawartością
  assert.ok(!/\.panel\.collapsed \.panel-body\s*\{\s*display:\s*none/.test(css));
  assert.ok(/\.panel\.collapsed \.panel-body > \.legend\s*\{[^}]*padding:\s*8px 18px 12px/.test(css));
});

test('przycisk zwijania: aria-label i komunikat dla czytnika w obu stanach', () => {
  assert.ok(/aria-label="Zwiń panel" aria-expanded="true"/.test(html));
  assert.ok(app.includes("collapsed ? 'Rozwiń panel' : 'Zwiń panel'"));
  assert.ok(app.includes('Panel zwinięty. Widać samą mapę i legendę.'));
  assert.ok(app.includes("'Panel rozwinięty.'"));
});
