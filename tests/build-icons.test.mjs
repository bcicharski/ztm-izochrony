/** Generator ikon PWA (Z-002): poprawny PNG i deterministyczność. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcon } from '../tools/build-icons.mjs';

test('buildIcon zwraca poprawny PNG 192x192', () => {
  const png = buildIcon({ size: 192 });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 192);
  assert.equal(png.readUInt32BE(20), 192);
  assert.equal(png.subarray(-8, -4).toString('ascii'), 'IEND');
});

test('buildIcon jest deterministyczny', () => {
  assert.ok(buildIcon({ size: 64 }).equals(buildIcon({ size: 64 })));
  assert.ok(buildIcon({ size: 64, pad: 0.2, bleed: true }).equals(buildIcon({ size: 64, pad: 0.2, bleed: true })));
});
