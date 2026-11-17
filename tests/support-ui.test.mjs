// Z-064 (usunięcie AdSense) i Z-065 (przycisk wsparcia widoczny zawsze) — bramki tekstowe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('css/style.css');

test('Z-064: w index.html nie ma już śladu AdSense', () => {
  for (const s of ['adsbygoogle', 'ad-box', 'ad-label', 'loadAds', 'google-adsense-account', 'googlesyndication', 'adBox']) {
    assert.ok(!html.includes(s), `index.html wciąż zawiera ${s}`);
  }
});

test('Z-064: w style.css nie ma reguł .ad-box ani .ad-label', () => {
  assert.ok(!/\.ad-box|\.ad-label/.test(css));
});

test('Z-064: baner zgody mówi wyłącznie o statystykach, a mechanizm zgody zostaje', () => {
  assert.ok(html.replace(/\s+/g, ' ').includes(
    'Strona korzysta z Google Analytics (anonimowe statystyki) — pliki cookie zapisywane tylko po zgodzie.'));
  assert.ok(!/reklam/i.test(html), 'wzmianka o reklamach w index.html');
  for (const s of ['id="consentBar"', 'id="consentYes"', 'id="consentNo"', 'window.consentGet', 'window.consentSet', 'window.loadGA']) {
    assert.ok(html.includes(s), s);
  }
  assert.match(html, /if \(value === 'granted'\) \{ loadGA\(\); \}/);
  assert.match(html, /if \(consentGet\(\) === 'granted'\) loadGA\(\);/);
});

test('Z-065: dwa linki .coffee-btn — ikona w nagłówku przed #helpBtn i pełny w „Dane i kontakt", różne aria-label', () => {
  const links = [...html.matchAll(/<a class="coffee-btn[^"]*"[^>]*>/g)].map(m => ({ at: m.index, tag: m[0] }));
  assert.equal(links.length, 2);
  const [icon, full] = links;
  const header = html.slice(html.indexOf('<header class="panel-header">'), html.indexOf('</header>'));
  assert.ok(header.includes(icon.tag), 'ikona w .panel-header');
  assert.ok(icon.at < html.indexOf('id="helpBtn"') && html.indexOf('id="helpBtn"') < html.indexOf('id="collapseBtn"'));
  assert.ok(full.at > html.indexOf('id="secData"'), 'pełny link w sekcji Dane i kontakt');
  const label = t => t.match(/aria-label="([^"]+)"/)?.[1];
  assert.ok(label(icon.tag) && label(full.tag) && label(icon.tag) !== label(full.tag));
  for (const l of links) assert.match(l.tag, /target="_blank"/), assert.match(l.tag, /rel="noopener"/);
  assert.match(icon.tag, /href="https:\/\/suppi\.pl\/bcicharski"/);
  assert.ok(html.includes('<span aria-hidden="true">☕</span>'));
});

test('Z-065: ikonowy .coffee-btn ma pole dotykowe var(--tap) przez ::before i nie znika przy zwiniętym panelu', () => {
  assert.match(css, /\.coffee-icon::before,/);
  assert.match(css, /\.coffee-icon::before,[^{]*\{[^}]*min-width: var\(--tap\);[^}]*min-height: var\(--tap\)/);
  assert.match(css, /\.coffee-btn\.coffee-icon \{[^}]*position: absolute;[^}]*right: 100px/);
  assert.ok(!/\.panel\.collapsed[^{]*coffee/.test(css));
  assert.ok(!/\.collapsed[^{]*\.panel-header/.test(css));
});
