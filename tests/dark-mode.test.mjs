/**
 * Tryb ciemny (Z-044): kontrasty par tokenów liczone z css/style.css, żeby tabela
 * z projektu nie rozjechała się z kodem, oraz zakaz literałów koloru poza
 * :root i blokiem ciemnym.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const rootBody = css.match(/:root\s*\{([^}]*)\}/)[1];
const DARK_AT = css.indexOf('@media (prefers-color-scheme: dark)');
assert.ok(DARK_AT > 0, 'brak bloku ciemnego');

/** Wycina blok z klamrami zaczynający się od pozycji `from` (pierwsza `{`). */
function block(text, from) {
  const open = text.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return { start: from, end: i + 1, body: text.slice(open + 1, i) };
  }
  throw new Error('niedomknięty blok');
}
const dark = block(css, DARK_AT);
const darkRoot = dark.body.match(/:root\s*\{([^}]*)\}/)[1];

const tokens = body => Object.fromEntries(
  [...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2]]));
const LIGHT = tokens(rootBody);
const DARK = { ...LIGHT, ...tokens(darkRoot) };

const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('ciemny blok przesłania dokładnie pięć tokenów i color-scheme', () => {
  assert.deepEqual(Object.keys(tokens(darkRoot)).sort(),
    ['--accent', '--ink', '--line', '--muted', '--surface']);
  assert.match(darkRoot, /color-scheme:\s*dark\s*;/);
});

test('tokeny --map-* są literalne i nieprzesłaniane w ciemnym', () => {
  assert.deepEqual([LIGHT['--map-ink'], LIGHT['--map-surface'], LIGHT['--map-accent']],
    ['#1c1c28', '#ffffff', '#b83289']);
  assert.doesNotMatch(darkRoot, /--map-/);
});

// [pierwszy token, drugi token, próg, wartość z projektu]
const PAIRS = [
  ['--ink', '--surface', 4.5, 14.3],
  ['--muted', '--surface', 4.5, 6.2],
  ['--muted', '--line', 4.5, 4.76],
  ['--ink', '--line', 4.5, 11.0],
  ['--accent', '--surface', 4.5, 5.08],
  ['--accent', '--line', 3, 3.9],
  ['--dot-a', '--surface', 3, 4.09],
  ['--dot-b', '--surface', 3, 5.5],
];

for (const [a, b, min, designed] of PAIRS) {
  test(`kontrast ciemny ${a} na ${b} >= ${min}:1`, () => {
    const r = ratio(DARK[a], DARK[b]);
    assert.ok(r >= min, `${r.toFixed(2)}:1`);
    assert.ok(Math.abs(r - designed) < 0.06, `projekt ${designed}, policzone ${r.toFixed(2)}`);
  });
}

test('kontrast --map-accent na białym >= 3:1 (projekt 5,45)', () => {
  const r = ratio(LIGHT['--map-accent'], LIGHT['--map-surface']);
  assert.ok(r >= 3 && Math.abs(r - 5.45) < 0.06, r.toFixed(2));
});

test('tryb jasny: pary tekstowe nadal >= 4,5:1', () => {
  assert.ok(ratio(LIGHT['--ink'], LIGHT['--surface']) >= 4.5);
  assert.ok(ratio(LIGHT['--muted'], LIGHT['--surface']) >= 4.5);
  assert.ok(ratio(LIGHT['--accent'], LIGHT['--surface']) >= 4.5);
});

test('poza :root i blokiem ciemnym nie ma literałów koloru', () => {
  const rootAt = css.search(/:root\s*\{/);
  const rest = css.slice(0, rootAt) + css.slice(rootAt + rootBody.length + 8, DARK_AT) + css.slice(dark.end);
  const bad = rest.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\((?!var\()[^)]*\)|\bhsla?\(/g)
    ?.filter(x => !/^rgba?\(var\(--shadow-rgb\)/.test(x));
  // rgba(var(--shadow-rgb), a) to dozwolony wzorzec cienia — regex powyżej go pomija
  assert.deepEqual(bad ?? [], []);
});

test('linia trasy, pinezki i znaczniki mapy używają tokenów --map-*, nie motywowanych', () => {
  for (const sel of ['.jl-rim', '.jl-halo', '.jl-core', '.jl-dot', '.meet-pin', '.meet-pin.selected',
    '.meet-pin-label', '#mapKeys', '.map-cross', '.map-keyhint']) {
    const esc = sel.replace(/[.#]/g, ch => '\\' + ch);
    const m = css.match(new RegExp('(?:^|\\n)' + esc + '\\s*\\{([^}]*)\\}'));
    assert.ok(m, sel);
    assert.doesNotMatch(m[1], /var\(--(?:ink|surface|accent)\)/, sel);
  }
});

test('dymek Leaflet i dialogi dostają tło z --surface w ciemnym', () => {
  assert.match(dark.body, /#helpDialog,\s*#privacyDialog\s*\{\s*background:\s*var\(--surface\)/);
  assert.match(dark.body, /\.leaflet-popup-tip\s*\{\s*background:\s*var\(--surface\);\s*color:\s*var\(--ink\)/);
});

test('bez ręcznego przełącznika i bez transition na kolorach', () => {
  assert.doesNotMatch(css, /data-theme/);
  assert.doesNotMatch(css, /transition[^;]*\b(color|background)/);
});
