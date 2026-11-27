/**
 * Dostępność CSS (Z-020): token pola dotykowego, wyłącznik ruchu i inwentarz
 * kontrolek z obszarem dotyku >= 44 px. Test czyta css/style.css jako tekst
 * (bez DOM) — tablice poniżej są zarazem dokumentacją inwentarza.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Płaska lista reguł {selectors, body} (także tych wewnątrz @media). */
function rules(text) {
  const out = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = m[1].trim();
    if (head.startsWith('@')) continue;
    out.push({ selectors: head.split(',').map(s => s.trim()), body: m[2] });
  }
  return out;
}
const ALL = rules(css);

// Selektory ze stałą wysokością/min-height = --tap (realny rozmiar elementu).
const SIZED = [
  '.search-row input',
  '.search-row button',
  '.search-results li',
  '.segmented label',
  '.switch',
  '.veh',
  '.city-select',
  '#accessSelect',
  '#paceSelect',
  '.time-row input',
  '.time-row select',
  '.share-btn',
  '.coffee-btn',
  '#clearLimits',    // „Zdejmij limity" (Z-012)
  '#diagCopy',       // „Kopiuj raport diagnostyczny" (Z-025)
  '.sec > summary',  // sekcje panelu (Z-059)
  '.diag summary',   // rozwijane szczegóły diagnostyki (Z-025)
  '.consent-actions button',
  '.leaflet-container .leaflet-bar a', // tylko @media (pointer: coarse)
];

// Selektory z nakładką ::before (wizualnie < 44 px, wokół >= 12 px wolnego miejsca).
const OVERLAY = [
  '.help-btn',
  '.collapse-btn',
  '.coffee-icon',
  '.leaflet-container a.leaflet-popup-close-button',
];

test('token --tap: 44px w :root', () => {
  const root = ALL.find(r => r.selectors.includes(':root'));
  assert.ok(root, 'brak reguły :root');
  assert.match(root.body, /--tap:\s*44px\s*;/);
});

test('prefers-reduced-motion: kill-switch ze wszystkimi czterema deklaracjami !important', () => {
  const m = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/);
  assert.ok(m, 'brak bloku @media (prefers-reduced-motion: reduce)');
  const inner = rules(m[1].replace(/\}\s*$/, '') + '}');
  const rule = inner.find(r => r.selectors.join(',') === '*,*::before,*::after');
  assert.ok(rule, 'brak selektora *, *::before, *::after');
  for (const prop of ['transition-duration', 'animation-duration', 'animation-iteration-count', 'scroll-behavior']) {
    assert.match(rule.body, new RegExp(`${prop}:\\s*[^;]+!important`), `${prop} bez !important`);
  }
});

test('inwentarz: każda kontrolka ma wysokość --tap albo nakładkę', () => {
  for (const sel of SIZED) {
    const ok = ALL.some(r => r.selectors.includes(sel) && /(?:^|[\s;])(?:min-)?height:\s*var\(--tap\)/.test(r.body));
    assert.ok(ok, `${sel}: brak height/min-height: var(--tap)`);
  }
  for (const sel of OVERLAY) {
    const ok = ALL.some(r => r.selectors.includes(`${sel}::before`)
      && /min-width:\s*var\(--tap\)/.test(r.body) && /min-height:\s*var\(--tap\)/.test(r.body));
    assert.ok(ok, `${sel}: brak nakładki ::before z min-size var(--tap)`);
  }
});

test('nakładek ::before jest dokładnie 4 (nowa wymaga przemyślenia kolizji)', () => {
  const overlays = ALL.flatMap(r => r.selectors.filter(s => s.endsWith('::before'))
    .filter(() => /min-height:\s*var\(--tap\)/.test(r.body)));
  assert.equal(overlays.length, OVERLAY.length);
  assert.deepEqual(overlays.map(s => s.replace(/::before$/, '')).sort(), [...OVERLAY].sort());
});

test('przyciski nagłówka: środki co 44 px (nakładki się nie nachodzą)', () => {
  const right = sel => Number(ALL.find(r => r.selectors.includes(sel) && /\bright:\s*\d+px/.test(r.body))
    .body.match(/\bright:\s*(\d+)px/)[1]);
  assert.equal(right('.help-btn') - right('.collapse-btn'), 44);
  assert.equal(right('.coffee-btn.coffee-icon') - right('.help-btn'), 44);
});

test('kolory: poza :root żadnej wartości hex ani rgba() na sztywno (nowy kolor = nowy token)', () => {
  // wyjątki jawnie: <selektor> -> dozwolona liczba literałów (dziś zero)
  const allowed = {};
  const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/g;
  for (const r of ALL) {
    if (r.selectors.includes(':root')) continue;
    const n = (r.body.match(literal) || []).length;
    const ok = r.selectors.some(s => allowed[s] >= n) || n === 0;
    assert.ok(ok, `${r.selectors.join(', ')}: kolor na sztywno — dodaj token w :root`);
  }
});

test('tokeny punktów A/B i kanałów cienia istnieją w :root', () => {
  const root = ALL.find(r => r.selectors.includes(':root')).body;
  for (const t of ['--dot-a', '--dot-b', '--map-bg', '--shadow-rgb']) {
    assert.ok(root.includes(`${t}:`), `brak ${t}`);
  }
  assert.match(root, /--dot-a:\s*#2a81cb/);
  assert.match(root, /--dot-b:\s*#e8722d/);
});

test('#locateBtn niedostępny: aria-disabled ze stylem bez opacity', () => {
  const rule = ALL.find(r => r.selectors.includes('.search-row button[aria-disabled="true"]'));
  assert.ok(rule, 'brak reguły aria-disabled');
  assert.match(rule.body, /color:\s*var\(--muted\)/);
  assert.match(rule.body, /cursor:\s*not-allowed/);
  assert.ok(!/opacity/.test(rule.body));
});

test('summary (Z-062): każdy <summary> w index.html jest pod .sec albo .diag, a żadna reguła nie zmniejsza ich wysokości', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // każdy <details> z summary: albo class="sec ...", albo wewnątrz <section class="diag">
  const details = [...html.matchAll(/<details([^>]*)>\s*<summary/g)];
  assert.ok(details.length >= 5, 'oczekiwano 4 sekcji panelu + szczegółów diagnostyki');
  const diagStart = html.indexOf('class="diag"');
  const diagEnd = html.indexOf('</section>', diagStart);
  for (const m of details) {
    const isSec = /class="[^"]*\bsec\b/.test(m[1]);
    const inDiag = m.index > diagStart && m.index < diagEnd;
    assert.ok(isSec || inDiag, `<details${m[1]}> z summary poza .sec i .diag — dodaj do inwentarza SIZED`);
  }
  // żadna reguła dla summary nie nadpisuje min-height wartością inną niż --tap
  for (const r of ALL.filter(r => r.selectors.some(s => /\bsummary\b/.test(s)))) {
    const h = r.body.match(/(?:^|[\s;])(?:min-)?height:\s*([^;]+);/);
    if (h) assert.equal(h[1].trim(), 'var(--tap)', `${r.selectors.join(', ')}: wysokość summary ≠ --tap`);
  }
});

test('linia trasy (Z-010): kolory .jl-* wyłącznie z tokenów, a js/map.js nie ma kolorów na sztywno', () => {
  const expected = {
    '.jl-halo': /stroke:\s*var\(--map-ink\)/,
    '.jl-core': /stroke:\s*var\(--map-surface\)/,
    '.jl-core-a': /stroke:\s*var\(--dot-a\)/,
    '.jl-core-b': /stroke:\s*var\(--dot-b\)/,
    '.jl-dot': /fill:\s*var\(--map-surface\)[\s\S]*stroke:\s*var\(--map-ink\)/,
    '.jl-dot-a': /fill:\s*var\(--dot-a\)/,
  };
  for (const [sel, re] of Object.entries(expected)) {
    const rule = ALL.find(r => r.selectors.includes(sel));
    assert.ok(rule, `brak reguły ${sel}`);
    assert.match(rule.body, re, sel);
  }
  const src = readFileSync(new URL('../js/map.js', import.meta.url), 'utf8');
  const journey = src.slice(src.indexOf('schematyczna linia trasy (Z-010)'));
  assert.ok(journey.length > 100, 'nie znaleziono sekcji Z-010 w map.js');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(journey), 'kolor na sztywno w warstwie linii trasy');
  assert.ok(!/color:\s*['"]/.test(journey), 'kolor podany w opcjach Leafleta zamiast klasy CSS');
});
