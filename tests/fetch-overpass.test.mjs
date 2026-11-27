import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOverpass, overpassRemarkError } from '../tools/geo.mjs';

const GOOD = { version: 0.6, elements: [{ type: 'way', id: 1 }, { type: 'way', id: 2 }] };
const TRUNCATED = {
  version: 0.6, elements: [{ type: 'way', id: 1 }],
  remark: 'runtime error: Query timed out in "query" at line 4 after 181 seconds.',
};
const res = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });

/** Podstawia fetch kolejką odpowiedzi; zwraca liczbę wywołań i czasy oczekiwań. */
async function withFetch(queue, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); const next = queue.shift(); if (next instanceof Error) throw next; return next; };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}
const waits = [];
const sleep = async s => { waits.push(s); };

test('Overpass: odpowiedź 200 z polem remark (urwana) jest ponawiana, nie zwracana', async () => {
  waits.length = 0;
  await withFetch([res(TRUNCATED), res(GOOD)], async calls => {
    const out = await fetchOverpass('q', 4, { sleep });
    assert.deepEqual(out, GOOD);
    assert.equal(calls.length, 2);
    assert.equal(waits.length, 1);
  });
});

test('Overpass: stale urwane odpowiedzi kończą się błędem po wyczerpaniu prób', async () => {
  await withFetch([res(TRUNCATED), res(TRUNCATED), res(TRUNCATED)], async calls => {
    await assert.rejects(fetchOverpass('q', 3, { sleep }), /remark|timed out/);
    assert.equal(calls.length, 3);
  });
});

test('Overpass: rate_limited i brak pamięci w remark też są błędem do ponowienia', async () => {
  for (const remark of ['rate_limited', 'runtime error: Query run out of memory using about 2048 MB', 'Too many requests']) {
    assert.ok(overpassRemarkError({ elements: [], remark }), remark);
  }
});

test('Overpass: inna nazwa pola (error) z komunikatem o błędzie też jest odrzucana', async () => {
  assert.ok(overpassRemarkError({ elements: [], error: 'runtime error: timed out' }));
  assert.equal(overpassRemarkError(GOOD), null);
  assert.equal(overpassRemarkError({ elements: [], remark: 'zwykła uwaga' }), null);
});

test('Overpass: poprawna odpowiedź bez remark wraca za pierwszym razem; domyślnie 6 prób', async () => {
  await withFetch([res(GOOD)], async calls => {
    assert.deepEqual(await fetchOverpass('q', undefined, { sleep }), GOOD);
    assert.equal(calls.length, 1);
  });
  await withFetch(Array.from({ length: 8 }, () => res(TRUNCATED)), async calls => {
    await assert.rejects(fetchOverpass('q', undefined, { sleep }));
    assert.equal(calls.length, 6);
  });
});

test('Overpass: ciało niebędące JSON-em przy 200 jest ponawiane', async () => {
  const html = { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
  await withFetch([html, res(GOOD)], async calls => {
    assert.deepEqual(await fetchOverpass('q', 4, { sleep }), GOOD);
    assert.equal(calls.length, 2);
  });
});
