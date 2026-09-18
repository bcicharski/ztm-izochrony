import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeNetwork, REV_C, MIN_TRANSFER_S } from '../js/data.js';
import { makeRaw, everyN } from './helpers.mjs';

const stops = [0, 1, 2].map(i => ({ name: `S${i}`, lat: 50 + i * 0.0045, lon: 20 }));

test('dekoder: v2 (minuty) i v3 (sekundy) dają te same profile', () => {
  const v3 = decodeNetwork(makeRaw({ stops, routes: [{ n: '1', t: 3 }], patterns: [{ r: 0, s: [0, 1, 2], p: [[300, 240]], t: [[28800, 0]] }] }));
  const v2 = decodeNetwork(makeRaw({ stops, routes: [{ n: '1', t: 3 }], patterns: [{ r: 0, s: [0, 1, 2], p: [[5, 4]], t: [[480, 0]] }], version: 2 }));
  assert.deepEqual([...v2.patterns[0].profCum[0]], [...v3.patterns[0].profCum[0]]);
  assert.deepEqual([...v2.patterns[0].depAt], [...v3.patterns[0].depAt]);
  assert.deepEqual([...v3.patterns[0].profArr[0]], [0, 300, 540]); // bez postojów przyjazd = odjazd
});

test('dekoder: postoje (pole d) rozdzielają przyjazd od odjazdu', () => {
  const net = decodeNetwork(makeRaw({ stops, routes: [{ n: '1', t: 2 }], patterns: [{ r: 0, s: [0, 1, 2], p: [[300, 300]], d: [[0, 60, 0]], t: [[28800, 0]] }] }));
  assert.deepEqual([...net.patterns[0].profCum[0]], [0, 300, 600]);
  assert.deepEqual([...net.patterns[0].profArr[0]], [0, 240, 600]);
});

test('przesiadki: minimum 60 s, listy symetryczne, promień węzła 150 m dla różnych zespołów', () => {
  const near = [{ name: 'A', lat: 50, lon: 20, group: 0 }, { name: 'B', lat: 50.0008, lon: 20, group: 1 }, { name: 'C', lat: 50.003, lon: 20, group: 2 }];
  const net = decodeNetwork(makeRaw({ stops: near, routes: [], patterns: [], transfers: [[0, 1, 10], [0, 2, 350]] }));
  assert.deepEqual(net.transferAdj[0], [1, MIN_TRANSFER_S, 2, 350]);
  assert.deepEqual(net.transferAdj[1], [0, MIN_TRANSFER_S]);
  assert.deepEqual(net.sameGroupAdj[0], [1, MIN_TRANSFER_S]); // B ~89 m: w promieniu węzła; C 334 m: nie
  assert.deepEqual(net.sameGroupAdj[2], []);
});

test('sieć odwrócona: budowana leniwie, czasy = REV_C − oryginał, kolejność przystanków odwrócona', () => {
  const net = decodeNetwork(makeRaw({ stops, routes: [{ n: '1', t: 3 }], patterns: [{ r: 0, s: [0, 1, 2], p: [[300, 300]], d: [[0, 60, 0]], t: everyN(28800, 30000, 600) }] }));
  assert.equal(Object.getOwnPropertyDescriptor(net, 'reversed').enumerable, false);
  const rev = net.reversed;
  assert.equal(rev, net.reversed, 'ta sama instancja przy kolejnym odczycie');
  const p = net.patterns[0], q = rev.patterns[0];
  assert.deepEqual([...q.stops], [2, 1, 0]);
  // najwcześniejszy kurs odwrócony = ostatni kurs fwd: start = REV_C − (jego przyjazd na koniec)
  assert.equal(q.tripStart[0], REV_C - (p.tripStart[p.nTrips - 1] + p.profArr[0][2]));
  // odwrócony odjazd z S1 = REV_C − przyjazd fwd na S1 (postój zachowany)
  const fwdArrS1 = p.tripStart[0] + p.profArr[0][1];
  const revDepS1 = q.tripStart[q.nTrips - 1] + q.profCum[0][1];
  assert.equal(revDepS1, REV_C - fwdArrS1);
  for (let i = 1; i < q.nTrips; i++) assert.ok(q.tripStart[i] >= q.tripStart[i - 1], 'kursy posortowane');
});
