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
  '.time-row input',
  '.time-row select',
  '.share-btn',
  '.coffee-btn',
  '#dayNote button', // „Pokaż niedzielę" (Z-022)
  '#diagCopy',       // „Kopiuj raport diagnostyczny" (Z-025)
  '.diag summary',   // rozwijane szczegóły diagnostyki (Z-025)
  '.consent-actions button',
  '.leaflet-container .leaflet-bar a', // tylko @media (pointer: coarse)
];

// Selektory z nakładką ::before (wizualnie < 44 px, wokół >= 12 px wolnego miejsca).
const OVERLAY = [
  '.help-btn',
  '.collapse-btn',
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

test('nakładek ::before jest dokładnie 3 (nowa wymaga przemyślenia kolizji)', () => {
  const overlays = ALL.flatMap(r => r.selectors.filter(s => s.endsWith('::before'))
    .filter(() => /min-height:\s*var\(--tap\)/.test(r.body)));
  assert.equal(overlays.length, OVERLAY.length);
  assert.deepEqual(overlays.map(s => s.replace(/::before$/, '')).sort(), [...OVERLAY].sort());
});

test('przyciski nagłówka: środki co 44 px (nakładki się nie nachodzą)', () => {
  const right = sel => Number(ALL.find(r => r.selectors.includes(sel) && /\bright:\s*\d+px/.test(r.body))
    .body.match(/\bright:\s*(\d+)px/)[1]);
  assert.equal(right('.help-btn') - right('.collapse-btn'), 44);
});
