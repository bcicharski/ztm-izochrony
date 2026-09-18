import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReachability, findAccessStops } from '../js/router.js';
import { REV_C } from '../js/data.js';
import { makeNet, everyN, oracleEarliest, randomNetSpec, rng } from './helpers.mjs';

// przystanki co ~500 m wzdłuż jednej linii (lat rośnie na północ)
const line = n => Array.from({ length: n }, (_, i) => ({ name: `S${i}`, lat: 50 + i * 0.0045, lon: 20 }));
const H8 = 8 * 3600;
const opts = (extra = {}) => ({ lat: 50, lon: 20, direction: 'from', walk: false, mode: 'time', timeMin: 480, types: null, cautious: false, delays: null, dayType: 0, ...extra });

test('RAPTOR: jedna linia, start dokładnie o odjeździe i minutę po nim', () => {
  const net = makeNet({
    stops: line(3), routes: [{ n: '1', t: 3 }],
    patterns: [{ r: 0, s: [0, 1, 2], p: [[300, 300]], t: everyN(H8, H8 + 7200, 600) }],
  });
  const r = computeReachability(net, opts());
  assert.deepEqual([...r.minutes].map(m => +m.toFixed(3)), [0, 5, 10]);
  const r2 = computeReachability(net, opts({ timeMin: 481 }));
  assert.deepEqual([...r2.minutes].map(m => +m.toFixed(3)), [0, 14, 19]); // następny kurs 08:10
});

test('RAPTOR: przesiadka w miejscu wymaga bufora 60 s, przejście piesze nie dokłada drugiego', () => {
  // linia 1: S0→S2 (przyjazd 08:10:00); linia 2 z S2 (w miejscu) i linia 3 z S3 (60 s pieszo od S2)
  const build = (dep2, dep3) => makeNet({
    stops: [...line(3), { name: 'S3', lat: 50 + 2 * 0.0045, lon: 20.0007 }, { name: 'S4', lat: 50.02, lon: 20 }, { name: 'S5', lat: 50.03, lon: 20 }],
    routes: [{ n: '1', t: 3 }, { n: '2', t: 3 }, { n: '3', t: 3 }],
    patterns: [
      { r: 0, s: [0, 1, 2], p: [[300, 300]], t: [[H8, 0]] },
      { r: 1, s: [2, 4], p: [[300]], t: [[dep2, 0], [dep2 + 600, 0]] },
      { r: 2, s: [3, 5], p: [[300]], t: [[dep3, 0], [dep3 + 600, 0]] },
    ],
    transfers: [[2, 3, 60]],
  });
  const arrS2 = H8 + 600;
  // odjazd 59 s po przyjeździe: bufor 60 s go odrzuca → następny kurs (+600)
  let r = computeReachability(build(arrS2 + 59, arrS2 + 59), opts({ walk: true }));
  assert.equal(r.minutes[4], (600 + 59 + 600 + 300) / 60);
  // odjazd dokładnie po 60 s: w miejscu łapie (bufor = 60), pieszo też (marsz 60 s, bez bufora)
  r = computeReachability(build(arrS2 + 60, arrS2 + 60), opts({ walk: true }));
  assert.equal(r.minutes[4], (600 + 60 + 300) / 60);
  assert.equal(r.minutes[5], (600 + 60 + 300) / 60);
  // odjazd z S3 po 119 s: dojście 60 s + 0 bufora → łapie; podwójny bufor (dawny błąd) by nie złapał
  r = computeReachability(build(arrS2 + 60, arrS2 + 119), opts({ walk: true }));
  assert.equal(r.minutes[5], (600 + 119 + 300) / 60);
  // bez spaceru: S3 jest w promieniu węzła (≈50 m), więc przesiadka też działa
  r = computeReachability(build(arrS2 + 60, arrS2 + 119), opts({ walk: false }));
  assert.equal(r.minutes[5], (600 + 119 + 300) / 60);
});

test('RAPTOR: limit 4 przesiadek (5 rund)', () => {
  const n = 8;
  const net = makeNet({
    stops: line(n), routes: Array.from({ length: n - 1 }, (_, i) => ({ n: `L${i}`, t: 3 })),
    patterns: Array.from({ length: n - 1 }, (_, i) => ({ r: i, s: [i, i + 1], p: [[60]], t: everyN(H8, H8 + 3600, 60) })),
  });
  const r = computeReachability(net, opts());
  assert.ok(Number.isFinite(r.minutes[5]), '5 przejazdów mieści się w limicie');
  assert.equal(r.minutes[6], Infinity, '6 przejazdów przekracza limit');
});

test('RAPTOR: kursy nocne po północy (24:00+) łapane przy godzinie < 05:00', () => {
  const net = makeNet({
    stops: line(2), routes: [{ n: 'N1', t: 3 }],
    patterns: [{ r: 0, s: [0, 1], p: [[300]], t: [[25 * 3600 + 600, 0]] }], // 25:10 = 01:10 dnia następnego
  });
  const r = computeReachability(net, opts({ timeMin: 60 })); // 01:00
  assert.equal(r.minutes[1], 15);
  const legs = r.journeyTo(1);
  assert.equal(legs.at(-1).kind, 'ride');
  assert.equal(legs.at(-1).depSec, 25 * 3600 + 600);
});

test('tryb ogólny (Dijkstra): suma najkrótszych odcinków, bez czekania', () => {
  const net = makeNet({
    stops: line(3), routes: [{ n: '1', t: 3 }],
    patterns: [
      { r: 0, s: [0, 1, 2], p: [[300, 300], [240, 360]], t: [[H8, 0], [H8 + 600, 1]] },
    ],
  });
  const r = computeReachability(net, opts({ mode: 'general', timeMin: 999 }));
  assert.deepEqual([...r.minutes], [0, 4, 9]); // min(300,240) + min(300,360)
  const legs = r.journeyTo(2);
  assert.equal(legs.filter(l => l.kind === 'ride').length, 1, 'odcinki tej samej linii sklejone');
  assert.equal(legs[1].durSec, 540);
});

test('rekonstrukcja trasy: kolejność etapów dla „z miejsca" i „do miejsca"', () => {
  const net = makeNet({
    stops: line(3), routes: [{ n: '1', t: 3 }],
    patterns: [{ r: 0, s: [0, 1, 2], p: [[300, 300]], t: everyN(H8, H8 + 7200, 600) }],
  });
  // 07:59, 36 m od S0: dojście 36 s, kurs 08:00, S2 o 08:10 (pieszo byłoby 17 min)
  const from = computeReachability(net, opts({ walk: true, lat: 50, lon: 20.0005, timeMin: 479 }));
  assert.equal(from.minutes[2], 11);
  let legs = from.journeyTo(2);
  assert.deepEqual(legs.map(l => l.kind), ['access', 'ride']);
  assert.equal(legs[1].fromStop, 0); assert.equal(legs[1].toStop, 2);
  assert.equal(legs[1].depSec, H8); assert.equal(legs[1].arrSec, H8 + 600);

  // do S2 na 08:20: ostatni kurs zdąży odjechać z S0 o 08:10
  const to = computeReachability(net, opts({ direction: 'to', lat: 50 + 2 * 0.0045, lon: 20, timeMin: 500 }));
  assert.equal(to.minutes[0], 10);
  legs = to.journeyTo(0);
  assert.deepEqual(legs.map(l => l.kind), ['ride', 'access']);
  assert.equal(legs[0].fromStop, 0); assert.equal(legs[0].toStop, 2);
  assert.equal(legs[0].depSec, H8 + 600); assert.equal(legs[0].arrSec, H8 + 1200);
});

test('profil opóźnień zastępuje mnożnik w trybie ostrożnym', () => {
  const net = makeNet({
    stops: line(2), routes: [{ n: '7', t: 3 }],
    patterns: [{ r: 0, s: [0, 1], p: [[600]], t: [[H8, 0]] }],
  });
  const heur = computeReachability(net, opts({ cautious: true }));
  assert.equal(heur.minutes[1], (600 + 90) / 60); // +15 % dla autobusu
  const prof = computeReachability(net, opts({ cautious: true, delays: { '7|0|8': 180 } }));
  assert.equal(prof.minutes[1], (600 + 180) / 60);
});

test('findAccessStops: spacer = wszystkie przystanki z dojściem; bez spaceru = najbliższy zespół + 150 m', () => {
  const net = makeNet({
    stops: [{ name: 'A', lat: 50, lon: 20, group: 0 }, { name: 'A', lat: 50.0005, lon: 20, group: 0 }, { name: 'B', lat: 50.001, lon: 20, group: 1 }, { name: 'C', lat: 50.01, lon: 20, group: 2 }],
    routes: [], patterns: [],
  });
  const walk = findAccessStops(net, 50, 20, true);
  assert.equal(walk.length / 2, 4);
  const noWalk = findAccessStops(net, 50, 20, false);
  assert.deepEqual(noWalk.filter((_, i) => i % 2 === 0).sort(), [0, 1, 2]); // C (1,1 km) poza promieniem
  // accessSec: Infinity = przystanek pomijany, NaN = linia prosta, liczba = wprost
  const acc = findAccessStops(net, 50, 20, true, Float64Array.from([10, Infinity, NaN, 20]));
  assert.deepEqual([...acc], [0, 10, 2, Math.round(111.32 / (4.5 / 3.6 / 1.3)), 3, 20]);
});

test('RAPTOR = wyrocznia na losowych sieciach (spacer × ostrożny × godzina)', () => {
  const rand = rng(20260918);
  let cases = 0, cautiousExact = 0, cautiousAll = 0;
  for (let seed = 0; seed < 40; seed++) {
    const net = makeNet(randomNetSpec(rand));
    const origin = { lat: 50 + rand() * 0.01, lon: 20 + rand() * 0.015 };
    for (const timeMin of [450, 480, 557]) {
      for (const walk of [true, false]) {
        for (const cautious of [false, true]) {
          const r = computeReachability(net, opts({ ...origin, walk, cautious, timeMin }));
          const sources = findAccessStops(net, origin.lat, origin.lon, walk);
          const expect = oracleEarliest(net, sources, timeMin * 60, walk, cautious);
          for (let i = 0; i < net.nStops; i++) {
            const got = r.minutes[i] * 60, exp = expect[i];
            const same = Math.abs(got - exp) < 1e-6 || (got === Infinity && exp === Infinity);
            if (!cautious) {
              assert.ok(same, `seed ${seed} t=${timeMin} walk=${walk} stop ${i}: ${got} vs ${exp}`);
            } else {
              // model ostrożny: margines zależy od miejsca wsiadania, a RAPTOR nie
              // rozważa późniejszego wsiadania do tego samego kursu — wolno mu być
              // gorszym od optimum, nigdy lepszym
              assert.ok(same || got > exp, `seed ${seed} t=${timeMin} walk=${walk} cautious stop ${i}: ${got} < optimum ${exp}`);
              cautiousAll++;
              if (same) cautiousExact++;
            }
          }
          cases++;
        }
      }
    }
  }
  assert.ok(cases >= 400);
  assert.ok(cautiousExact / cautiousAll > 0.97, `tryb ostrożny: tylko ${(100 * cautiousExact / cautiousAll).toFixed(1)}% wyników optymalnych`);
});

test('kierunek „do miejsca" = wyrocznia na sieci odwróconej', () => {
  const rand = rng(7);
  for (let seed = 0; seed < 20; seed++) {
    const net = makeNet(randomNetSpec(rand));
    const target = { lat: 50 + rand() * 0.01, lon: 20 + rand() * 0.015 };
    const timeMin = 540;
    for (const walk of [true, false]) {
      const r = computeReachability(net, opts({ ...target, direction: 'to', walk, timeMin }));
      const g = net.reversed;
      const sources = findAccessStops(g, target.lat, target.lon, walk);
      const expect = oracleEarliest(g, sources, REV_C - timeMin * 60, walk);
      for (let i = 0; i < g.nStops; i++) {
        assert.ok(Math.abs(r.minutes[i] * 60 - expect[i]) < 1e-6 || (r.minutes[i] === Infinity && expect[i] === Infinity),
          `seed ${seed} walk=${walk} stop ${i}: ${r.minutes[i] * 60} vs ${expect[i]}`);
      }
    }
  }
});
