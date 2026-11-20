/**
 * Koła szacunkowe (Z-077): próg małej skali, znacznik dla legendy, cache wzorów
 * oraz kontrakt HTML/CSS noty. Samo malowanie na canvasie wymaga przeglądarki
 * i jest sprawdzane ręcznie — tu testowana jest tylko logika bez canvasu.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// map.js woła L.Layer.extend przy imporcie — atrapa wystarcza (nic nie rysujemy)
globalThis.L = { Layer: { extend: o => o }, Control: { extend: o => o } };
let created = 0;
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => new Proxy({}, { get: (_, k) => (typeof k === 'string' && /^(moveTo|lineTo|beginPath|stroke)$/.test(k) ? () => {} : undefined), set: () => true }),
  }),
};
globalThis.DOMMatrix = class { scale(k) { this.k = k; return this; } };
const fakeCtx = { createPattern: () => { created++; return { setTransform() {} }; } };

const { isApproxSmallScale, hasApproxCircles, hatchPattern, APPROX_MIN_R } = await import('../js/map.js');

test('próg małej skali: 1 km poniżej APPROX_MIN_R px', () => {
  assert.equal(isApproxSmallScale(APPROX_MIN_R / 1000 - 1e-6), true);
  assert.equal(isApproxSmallScale(APPROX_MIN_R / 1000), false);
  assert.equal(isApproxSmallScale(0.05), false);
  assert.equal(isApproxSmallScale(0.001), true);
});

test('znacznik: null, puste, bez kół, z kołami', () => {
  assert.equal(hasApproxCircles(null), false);
  assert.equal(hasApproxCircles(undefined), false);
  assert.equal(hasApproxCircles([]), false);
  assert.equal(hasApproxCircles([{ color: '#fff', circles: [] }, { color: '#000' }]), false);
  assert.equal(hasApproxCircles([{ color: '#fff', circles: [] }, { color: '#000', circles: [[52, 21, 900]] }]), true);
});

test('cache wzorów: ten sam kolor i dpr to ten sam obiekt', () => {
  const a = hatchPattern('#123456', 2, fakeCtx);
  assert.equal(hatchPattern('#123456', 2, fakeCtx), a);
  assert.notEqual(hatchPattern('#123456', 1, fakeCtx), a);
  assert.notEqual(hatchPattern('#654321', 2, fakeCtx), a);
  assert.equal(created, 3);
});

test('legenda: nota w HTML i reguły CSS widoczności po atrybucie data-approx', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('Kreskowane: zasięg szacunkowy, w linii prostej'));
  const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.legend \.note-approx\s*\{\s*display:\s*none/);
  assert.match(css, /html\[data-approx\] \.legend \.note-approx\s*\{\s*display:\s*flex/);
});
