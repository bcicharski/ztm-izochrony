import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { xmlEvents, forEachElement, kid, kids, txt, has } from '../tools/xmlstream.mjs';

const bytes = (s, size = 1 << 20) => {
  const buf = Buffer.from(s, 'utf8');
  const parts = [];
  for (let i = 0; i < buf.length; i += size) parts.push(buf.subarray(i, i + size));
  return Readable.from(parts, { objectMode: false });
};

async function events(s, size) {
  const out = [];
  for await (const e of xmlEvents(bytes(s, size))) out.push(e);
  return out;
}

async function collect(s, paths, size, opts) {
  const out = [];
  await forEachElement(bytes(s, size), paths, (n, p) => out.push([p, n]), opts);
  return out;
}

test('xmlEvents: element samozamykający, atrybuty z > i apostrofami', async () => {
  const ev = await events(`<a x="1>2" y='b'><b/><c>t</c></a>`);
  assert.deepEqual(ev[0], { t: 'open', name: 'a', attrs: { x: '1>2', y: 'b' }, self: false });
  assert.deepEqual(ev[1], { t: 'open', name: 'b', attrs: {}, self: true });
  assert.deepEqual(ev[2], { t: 'close', name: 'b' });
  assert.deepEqual(ev.filter(e => e.t === 'text'), [{ t: 'text', text: 't' }]);
});

test('xmlEvents: BOM, komentarz, instrukcja, DOCTYPE i prefiksy', async () => {
  const xml = '﻿<?xml version="1.0"?><!DOCTYPE r><!-- <x> --><r xmlns:apd="u"><apd:Street>a</apd:Street></r>';
  const names = (await events(xml)).filter(e => e.t === 'open').map(e => e.name);
  assert.deepEqual(names, ['r', 'Street']);
});

test('xmlEvents: znak wielobajtowy rozcięty między porcjami (po 1 bajcie)', async () => {
  const ev = await events('<a>Zażółć &gt; \u{1F68C}</a>', 1);
  assert.equal(ev.find(e => e.t === 'text').text, 'Zażółć > \u{1F68C}');
});

test('xmlEvents: encje predefiniowane i numeryczne', async () => {
  const ev = await events('<a t="&quot;x&apos;">&gt;&lt;&amp;&#x17C;&#380;</a>');
  assert.equal(ev[0].attrs.t, '"x\'');
  assert.equal(ev.find(e => e.t === 'text').text, '><&żż');
});

test('xmlEvents: CDATA przerywa z offsetem', async () => {
  await assert.rejects(events('<a><![CDATA[x]]></a>'), /CDATA.*bajt 3/);
});

test('xmlEvents: nieznana encja przerywa z offsetem', async () => {
  await assert.rejects(events('<a>ab &nbsp; c</a>'), /nieznana encja "&nbsp;" \(bajt \d+\)/);
});

test('xmlEvents: niedomknięty element, niezgodny tag i EOF w tagu', async () => {
  await assert.rejects(events('<a><b></b>'), /niedomknięty element <a> \(bajt \d+\)/);
  await assert.rejects(events('<a><b></a>'), /nie pasuje.*bajt/);
  await assert.rejects(events('<a><b attr="x'), /koniec pliku w środku tagu \(bajt 3\)/);
});

test('forEachElement: budowa węzłów i pomocniki', async () => {
  const xml = '<R><S><I id="1"><N>x</N><N>y</N><D><E>deep</E></D></I><I id="2"/></S><Z><I id="no"/></Z></R>';
  const got = await collect(xml, ['R/S/I']);
  assert.equal(got.length, 2);
  const [path, n] = got[0];
  assert.equal(path, 'R/S/I');
  assert.equal(n.attrs.id, '1');
  assert.equal(kids(n, 'N').length, 2);
  assert.equal(kid(n, 'N').text, 'x');
  assert.equal(txt(n, 'D/E'), 'deep');
  assert.equal(txt(n, 'D/Q', 'dflt'), 'dflt');
  assert.ok(has(n, 'D/E') && !has(n, 'D/Q'));
  assert.equal(got[1][1].self, true);
});

test('forEachElement: ścieżkowe pomijanie poddrzew', async () => {
  const xml = `<T>
    <Garages><VehicleJourney id="x"/><VehicleJourney><Code>bad</Code></VehicleJourney></Garages>
    <ServiceCalendars><VehicleJourney id="x"/><VehicleJourney><Code>bad2</Code></VehicleJourney></ServiceCalendars>
    <VehicleJourneys><VehicleJourney><Code>ok</Code></VehicleJourney></VehicleJourneys>
  </T>`;
  for (const size of [1, 7, 1 << 20]) {
    const got = await collect(xml, ['T/VehicleJourneys/VehicleJourney'], size);
    assert.deepEqual(got.map(([, n]) => txt(n, 'Code')), ['ok']);
  }
});

test('forEachElement: opts.skip pomija nazwane poddrzewa wewnątrz węzła', async () => {
  const xml = '<R><I><Track><P>1</P></Track><K>k</K></I></R>';
  const [[, n]] = await collect(xml, ['R/I'], 1 << 20, { skip: new Set(['Track']) });
  assert.deepEqual(n.kids.map(k => k.name), ['K']);
});
