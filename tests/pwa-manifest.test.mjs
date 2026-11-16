/** Manifest PWA (Z-002, etap 1): ikony istnieją, kolory = token --surface. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const css = readFileSync(new URL('css/style.css', root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = readFileSync(new URL('index.html', root), 'utf8');
const surface = css.match(/--surface:\s*(#[0-9a-fA-F]{3,8})\s*;/)[1].toLowerCase();

test('start_url i scope są względne', () => {
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
});

test('ikony istnieją, a wymiary PNG zgadzają się z sizes', () => {
  for (const ic of manifest.icons) {
    const url = new URL(ic.src, root);
    assert.ok(existsSync(url), `brak pliku ${ic.src}`);
    if (ic.type === 'image/png') {
      const b = readFileSync(url);
      const [w, h] = ic.sizes.split('x').map(Number);
      assert.equal(b.readUInt32BE(16), w, ic.src);
      assert.equal(b.readUInt32BE(20), h, ic.src);
    }
  }
});

test('jest PNG >= 192 px i ikona maskable', () => {
  assert.ok(manifest.icons.some(i => i.type === 'image/png' && parseInt(i.sizes, 10) >= 192));
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
});

test('kolory manifestu = token --surface', () => {
  assert.equal(manifest.theme_color.toLowerCase(), surface);
  assert.equal(manifest.background_color.toLowerCase(), surface);
});

test('index.html linkuje manifest, theme-color i apple-touch-icon', () => {
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.json">/);
  const theme = html.match(/<meta name="theme-color" content="([^"]+)"/);
  assert.equal(theme[1].toLowerCase(), surface);
  const apple = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/);
  assert.ok(existsSync(new URL(apple[1], root)));
});
