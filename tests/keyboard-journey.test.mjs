/**
 * Trasa z klawiatury (Z-073) i kontrast otoczki linii trasy (Z-072).
 * Źródła czytane jako tekst (bez DOM), wzorzec jak w a11y-css.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isJourneyKey, MAP_ARIA_LABEL, MAP_KEY_HINT } from '../js/uilogic.js';
import { BANDS } from '../js/isochrone.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../js/app.js');
const html = read('../index.html');
const css = read('../css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

const mapEl = {};
const key = (over = {}) => ({ key: 'Enter', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: mapEl, currentTarget: mapEl, ...over });

test('isJourneyKey: tylko Enter na samym kontenerze mapy, bez modyfikatorów', () => {
  assert.equal(isJourneyKey(key()), true);
  assert.equal(isJourneyKey(key({ key: 'Escape' })), false);
  assert.equal(isJourneyKey(key({ key: 'ArrowUp' })), false);
  assert.equal(isJourneyKey(key({ target: {} })), false, 'Enter na przycisku zoomu/pinezce/dymku bąbelkuje do kontenera');
  for (const m of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'repeat']) {
    assert.equal(isJourneyKey(key({ [m]: true })), false, m);
  }
});

test('Enter i prawy klik wywołują tę samą funkcję openJourney', () => {
  assert.match(app, /map\.on\('contextmenu'[\s\S]{0,200}openJourney\(/);
  assert.match(app, /isJourneyKey\(e\)[\s\S]{0,200}openJourney\([^)]*true\)/);
  assert.equal((app.match(/engine\.journey\(/g) ?? []).length, 1, 'engine.journey: jedno miejsce wyboru (askJourney)');
  assert.equal((app.match(/askJourney\(/g) ?? []).length, 2, 'askJourney: openJourney + odświeżanie dymka');
  assert.equal((app.match(/journeyLayer\.setShapes\(/g) ?? []).length, 2);
});

test('Escape na dymku z klawiatury zamyka go, a zamknięcie oddaje fokus mapie', () => {
  assert.match(app, /ev\.key === 'Escape'[\s\S]{0,120}map\.closePopup\(\)/);
  assert.match(app, /byKey && \(!active \|\| active === document\.body \|\| popupEl\?\.contains\(active\)\)\) \{[\s\S]{0,260}\(row \?\? mapEl\)\.focus\(/);
});

test('opis mapy dla czytnika i podpowiedź wymieniają Enter', () => {
  assert.match(MAP_ARIA_LABEL, /Enter/);
  assert.match(MAP_KEY_HINT, /Enter/);
  assert.match(app, /setAttribute\('aria-label', MAP_ARIA_LABEL\)/);
});

test('okno pomocy opisuje skrót w sekcji o trasie', () => {
  const help = html.slice(html.indexOf('id="helpDialog"'));
  const sec = help.slice(help.indexOf('Trasa do wybranego miejsca'), help.indexOf('Opóźnienia (tryb ostrożny)'));
  assert.match(sec, /Z klawiatury/);
  assert.match(sec, /Enter/);
  assert.match(sec, /Esc/);
});

test('znacznik środka i ramka fokusu: tylko tokeny, widoczne tylko przy :focus-visible mapy', () => {
  assert.match(html, /<div id="map"><\/div>\s*<!--[^>]*-->\s*<div id="mapKeys" aria-hidden="true">/);
  assert.match(css, /#map:focus-visible \+ #mapKeys \{\s*display: block;/);
  const block = css.slice(css.indexOf('#mapKeys {'), css.indexOf('.journey:focus-visible'));
  assert.ok(block.length > 200);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(block), 'kolor na sztywno w znaczniku środka mapy');
});

// --- Z-072: kontrast otoczki -----------------------------------------------------

const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('otoczka linii trasy: co najmniej jedna z krawędzi (ciemna/jasna) ma >= 3:1 na każdym paśmie i jasności podkładu', () => {
  const root = read('../css/style.css');
  const token = name => hex(root.match(new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})'))[1]);
  const ink = token('--ink'), surface = token('--surface');
  // jasność kafli OSM po filtrze CSS: mediana, 25. i 5. percentyl (pomiar z Z-072)
  for (const gray of [226, 211, 179]) {
    for (const band of BANDS) {
      const bg = hex(band.color).map(v => 0.55 * v + 0.45 * gray); // ZONE_ALPHA = 0,55
      const best = Math.max(ratio(ink, bg), ratio(surface, bg));
      assert.ok(best >= 3, `${band.label}, podkład ${gray}: ${best.toFixed(2)}:1`);
    }
  }
});

test('jasny obrys otoczki: klasa .jl-rim na tokenie --map-surface, rysowany pod ciemną otoczką', () => {
  assert.match(css, /\.jl-rim \{ stroke: var\(--map-surface\); \}/);
  const map = read('../js/map.js');
  assert.ok(map.indexOf("'jl-rim'") < map.indexOf("'jl-halo'"), 'obrys musi być pod otoczką');
});

// --- dymek spotkania i zaproszenie (Z-071) ---------------------------------------------

test('Spotkanie: pozycja listy i pinezka otwierają TEN SAM dymek trasy (jedna ścieżka, brak drugiego L.popup)', () => {
  assert.match(app, /function selectMeet\([^)]*\) \{[\s\S]*?openJourney\(\{ lat: c\.lat, lng: c\.lon \}, byKey, c\.stop\)/);
  assert.equal((app.match(/L\.popup\(/g) ?? []).length, 1, 'w app.js jest jeden dymek');
  assert.match(app, /engine\.journeyToStop\(stop\)/);
  // klawiatura: detail 0 = aktywacja Enterem/Spacją → fokus do dymka
  assert.match(app, /selectMeet\(\+row\.dataset\.i, true, e\.detail === 0\)/);
});

test('Przycisk „Kopiuj zaproszenie": button type=button, styl .share-btn (pole dotykowe), bez nowych kolorów', () => {
  assert.match(app, /<button type="button" class="share-btn invite-btn">\$\{INVITE_LABEL\}<\/button>/);
  assert.match(app, /const INVITE_LABEL = 'Kopiuj zaproszenie'/);
  const share = css.match(/\.share-btn \{[^}]*\}/)[0];
  assert.match(share, /height: var\(--tap\)/);
  const mine = css.match(/\.journey \.invite-btn \{[^}]*\}/)[0];
  assert.doesNotMatch(mine, /#[0-9a-f]{3,8}|rgb\(/i);
});

test('Schowek: link i zaproszenie idą przez jedną copyText z awaryjnym polem #shareText', () => {
  const fn = app.slice(app.indexOf('async function copyText('), app.indexOf("$('shareBtn')"));
  assert.match(fn, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(fn, /ta\.hidden = false;[\s\S]*ta\.select\(\)/);
  assert.equal((app.match(/copyText\(/g) ?? []).length, 3, 'definicja + link + zaproszenie');
  assert.match(app, /meetInviteText\(\{[\s\S]*?url: location\.href/);
  assert.match(app, /okText: 'Zaproszenie skopiowane do schowka\.'/);
});
