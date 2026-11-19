import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReachability, findAccessStops } from '../js/router.js';
import { REV_C, buildPatternEntries } from '../js/data.js';
import { makeNet, everyN, oracleEarliest, randomNetSpec, rng, overtakingBuildPattern } from './helpers.mjs';

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

// --- wyprzedzanie kursów (Z-005) ------------------------------------------------

/** Linia S0-S1-S2 z wzorcem wyprzedzającym; split = rozbicie jak w buildzie. */
function overtakingNet({ split, forceBinary = false }) {
  const entries = split
    ? buildPatternEntries(overtakingBuildPattern())
    : [{ r: 0, s: [0, 1, 2], p: [[600, 600], [240, 240]], t: [[H8, 0], [H8 + 120, 1]] }];
  const net = makeNet({ stops: line(3), routes: [{ n: '1', t: 3 }], patterns: entries });
  if (forceBinary) {
    // symulacja starego zachowania: wyszukiwanie binarne mimo wyprzedzania
    for (const p of net.patterns) p.monotone = true;
    for (const p of net.reversed.patterns) p.monotone = true;
  }
  return net;
}

/** Wynik RAPTOR-a (sekundy) i wyrocznia dla jednego zapytania. */
function overtakingRun(net, direction) {
  const o = direction === 'to'
    ? opts({ lat: 50 + 2 * 0.0045, direction: 'to', timeMin: 510 })
    : opts({ lat: 50 + 0.0045, timeMin: 480 });
  const r = computeReachability(net, o);
  const g = direction === 'to' ? net.reversed : net;
  const sources = findAccessStops(g, o.lat, o.lon, false);
  const t0 = direction === 'to' ? REV_C - o.timeMin * 60 : o.timeMin * 60;
  return { got: [...r.minutes].map(m => m * 60), expect: [...oracleEarliest(g, sources, t0, false)] };
}

test('wyprzedzanie: po rozbiciu wzorca RAPTOR = wyrocznia (do i od miejsca)', () => {
  for (const direction of ['from', 'to']) {
    const net = overtakingNet({ split: true });
    assert.equal(net.overtakingPatterns, 0);
    assert.equal(net.reversed.patterns.every(p => p.monotone), true);
    const { got, expect } = overtakingRun(net, direction);
    assert.ok(expect.some(x => x > 0 && x < Infinity), 'wyrocznia coś znajduje');
    assert.deepEqual(got, expect, direction);
  }
});

test('wyprzedzanie: bez rozbicia skan daje wynik poprawny, a wyszukiwanie binarne nigdy optymistyczny', () => {
  for (const direction of ['from', 'to']) {
    // skan liniowy (flaga monotone === false)
    const scan = overtakingNet({ split: false });
    assert.equal(scan.overtakingPatterns, 1);
    const s = overtakingRun(scan, direction);
    s.expect.forEach((e, i) => assert.ok(s.got[i] >= e && (s.got[i] < Infinity) === (e < Infinity), `skan ${direction} stop ${i}: ${s.got[i]} vs ${e}`));
    // wymuszone wyszukiwanie binarne: tylko pesymistyczne, ale skończone tam, gdzie wyrocznia
    const bin = overtakingNet({ split: false, forceBinary: true });
    const b = overtakingRun(bin, direction);
    let worse = 0;
    b.expect.forEach((e, i) => {
      assert.ok(b.got[i] >= e, `binarne ${direction} stop ${i}: ${b.got[i]} < optimum ${e}`);
      assert.equal(b.got[i] < Infinity, e < Infinity);
      if (b.got[i] > e) worse++;
    });
    if (direction === 'from') assert.ok(worse > 0, 'scenariusz faktycznie pokazuje pesymizm wyszukiwania binarnego');
  }
});

test('wyprzedzanie: losowe sieci z wyprzedzaniem — wynik ≥ wyrocznia, a po rozbiciu równy', () => {
  const rand = rng(99);
  for (let seed = 0; seed < 20; seed++) {
    const spec = randomNetSpec(rand, { overtaking: true });
    const origin = { lat: 50 + rand() * 0.01, lon: 20 + rand() * 0.015 };
    // wersja z rozbiciem: każdy wzorzec przepuszczony przez buildPatternEntries
    const splitSpec = {
      ...spec,
      patterns: spec.patterns.flatMap(p => buildPatternEntries({
        route: p.r, stops: p.s, flags: p.s.map(() => 0),
        profileList: p.p, dwellList: p.p.map(() => p.s.map(() => 0)), trips: p.t.slice().sort((a, b) => a[0] - b[0]),
      })),
    };
    for (const [label, net] of [['skan', makeNet(spec)], ['rozbite', makeNet(splitSpec)]]) {
      const r = computeReachability(net, opts({ ...origin, walk: true }));
      const expect = oracleEarliest(net, findAccessStops(net, origin.lat, origin.lon, true), 480 * 60, true);
      for (let i = 0; i < net.nStops; i++) {
        const got = r.minutes[i] * 60;
        assert.ok(got >= expect[i] - 1e-6, `seed ${seed} ${label} stop ${i}: ${got} < ${expect[i]}`);
        if (label === 'rozbite') assert.ok(Math.abs(got - expect[i]) < 1e-6 || got === expect[i], `seed ${seed} rozbite stop ${i}: ${got} vs ${expect[i]}`);
      }
    }
  }
});

// --- limity przesiadek i spaceru (Z-012) ------------------------------------------

test('limity domyślne (null) nie zmieniają wyniku: losowe sieci × spacer × ostrożny, i dalej = wyrocznia', () => {
  const rand = rng(20261117);
  let cases = 0;
  for (let seed = 0; seed < 25; seed++) {
    const net = makeNet(randomNetSpec(rand));
    const origin = { lat: 50 + rand() * 0.01, lon: 20 + rand() * 0.015 };
    for (const walk of [false, true]) {
      for (const cautious of [false, true]) {
        for (const mode of ['time', 'general']) {
          const o = opts({ ...origin, walk, cautious, mode });
          const base = computeReachability(net, o);
          const nulls = computeReachability(net, { ...o, maxTransfers: null, maxWalkSec: null });
          assert.deepEqual([...nulls.minutes], [...base.minutes], `seed ${seed} walk=${walk} cautious=${cautious} ${mode}`);
          if (mode === 'time' && !cautious) {
            const exp = oracleEarliest(net, findAccessStops(net, origin.lat, origin.lon, walk), 480 * 60, walk, false);
            for (let i = 0; i < net.nStops; i++) assert.ok(Math.abs(nulls.minutes[i] * 60 - exp[i]) < 1e-6 || exp[i] === Infinity);
          }
          cases++;
        }
      }
    }
  }
  assert.ok(cases >= 200);
});

test('limit przesiadek: maxTransfers 0/1/2 daje dokładnie tr+1 przejazdów, null dalej pięć', () => {
  const n = 8;
  const net = makeNet({
    stops: line(n), routes: Array.from({ length: n - 1 }, (_, i) => ({ n: `L${i}`, t: 3 })),
    patterns: Array.from({ length: n - 1 }, (_, i) => ({ r: i, s: [i, i + 1], p: [[60]], t: everyN(H8, H8 + 3600, 60) })),
  });
  for (const tr of [0, 1, 2]) {
    const r = computeReachability(net, opts({ maxTransfers: tr }));
    assert.ok(Number.isFinite(r.minutes[tr + 1]), `tr=${tr}: stop ${tr + 1} osiągalny`);
    assert.equal(r.minutes[tr + 2], Infinity, `tr=${tr}: stop ${tr + 2} poza limitem`);
  }
  const free = computeReachability(net, opts({ maxTransfers: null }));
  assert.ok(Number.isFinite(free.minutes[5]));
  assert.equal(free.minutes[6], Infinity);
  // limit dotyczy też przebiegu nocnego (24:00+)
  const night = makeNet({
    stops: line(3), routes: [{ n: 'N1', t: 3 }, { n: 'N2', t: 3 }],
    patterns: [
      { r: 0, s: [0, 1], p: [[300]], t: [[25 * 3600, 0]] },
      { r: 1, s: [1, 2], p: [[300]], t: [[25 * 3600 + 900, 0]] },
    ],
  });
  assert.ok(Number.isFinite(computeReachability(night, opts({ timeMin: 60 })).minutes[2]));
  assert.equal(computeReachability(night, opts({ timeMin: 60, maxTransfers: 0 })).minutes[2], Infinity);
});

test('limit przesiadek 0: marsz z przystanku po wysiadce zostaje (to wyjście, nie przesiadka)', () => {
  const net = makeNet({
    stops: [...line(2), { name: 'S2', lat: 50.0046, lon: 20.0005 }], routes: [{ n: '1', t: 3 }],
    patterns: [{ r: 0, s: [0, 1], p: [[300]], t: everyN(H8, H8 + 3600, 600) }],
    transfers: [[1, 2, 100]],
  });
  const r = computeReachability(net, opts({ walk: true, maxTransfers: 0, accessSec: Float64Array.from([0, Infinity, Infinity]) }));
  assert.equal(r.minutes[1], 5);
  assert.equal(r.minutes[2], (300 + 100) / 60);
});

/** S0 -L0-> S1, marsz `walkSec` do S2 -L1-> S3; z S1 w miejscu L2 -> S4. */
const walkNet = walkSec => makeNet({
  stops: [...line(4), { name: 'S4', lat: 50.03, lon: 20 }],
  routes: [{ n: 'A', t: 3 }, { n: 'B', t: 3 }, { n: 'C', t: 3 }],
  patterns: [
    { r: 0, s: [0, 1], p: [[300]], t: everyN(H8, H8 + 7200, 300) },
    { r: 1, s: [2, 3], p: [[300]], t: everyN(H8, H8 + 7200, 300) },
    { r: 2, s: [1, 4], p: [[300]], t: everyN(H8, H8 + 7200, 300) },
  ],
  transfers: [[1, 2, walkSec]],
});
const ONLY_S0 = Float64Array.from([0, Infinity, Infinity, Infinity, Infinity]);

test('limit spaceru: 240 s wycina przesiadkę piesza 300 s, zostawia przesiadkę w miejscu', () => {
  const net = walkNet(300);
  const free = computeReachability(net, opts({ walk: true, accessSec: ONLY_S0 }));
  assert.ok(Number.isFinite(free.minutes[3]));
  const lim = computeReachability(net, opts({ walk: true, accessSec: ONLY_S0, maxWalkSec: 240 }));
  assert.equal(lim.minutes[3], Infinity, 'przesiadka 300 s > 240 s');
  assert.ok(Number.isFinite(lim.minutes[4]), 'przesiadka w miejscu nie jest marszem');
  assert.ok(Number.isFinite(computeReachability(net, opts({ walk: true, accessSec: ONLY_S0, maxWalkSec: 300 })).minutes[3]), 'równo na limicie przechodzi');
});

test('limit spaceru: tryb ostrożny filtruje surowy czas marszu, nie margines 240 s', () => {
  const net = walkNet(120);
  const r = computeReachability(net, opts({ walk: true, cautious: true, accessSec: ONLY_S0, maxWalkSec: 180 }));
  assert.ok(Number.isFinite(r.minutes[3]), 'marsz 120 s ≤ 180 s, choć ostrożny liczy go jako 240 s');
  const tight = computeReachability(net, opts({ walk: true, cautious: true, accessSec: ONLY_S0, maxWalkSec: 100 }));
  assert.equal(tight.minutes[3], Infinity);
});

test('limit spaceru: bez spaceru nie rusza sameGroupAdj, tryb ogólny filtruje przejścia piesze', () => {
  const grouped = makeNet({
    stops: [...line(4)].map((s, i) => ({ ...s, group: i === 2 ? 1 : i })),
    routes: [{ n: 'A', t: 3 }, { n: 'B', t: 3 }],
    patterns: [
      { r: 0, s: [0, 1], p: [[300]], t: everyN(H8, H8 + 7200, 300) },
      { r: 1, s: [2, 3], p: [[300]], t: everyN(H8, H8 + 7200, 300) },
    ],
    transfers: [[1, 2, 300]],
  });
  const a = computeReachability(grouped, opts({ walk: false }));
  const b = computeReachability(grouped, opts({ walk: false, maxWalkSec: 1 }));
  assert.deepEqual([...b.minutes], [...a.minutes]);
  const net = walkNet(300);
  const g = computeReachability(net, opts({ walk: true, mode: 'general', accessSec: ONLY_S0 }));
  assert.ok(Number.isFinite(g.minutes[3]));
  const gl = computeReachability(net, opts({ walk: true, mode: 'general', accessSec: ONLY_S0, maxWalkSec: 240 }));
  assert.equal(gl.minutes[3], Infinity);
});

test('findAccessStops: maxAccessSec ucina wpisy accessSec i gałąź w linii prostej', () => {
  const net = makeNet({
    stops: [{ name: 'A', lat: 50, lon: 20 }, { name: 'B', lat: 50.0005, lon: 20 }, { name: 'C', lat: 50.001, lon: 20 }, { name: 'D', lat: 50.01, lon: 20 }],
    routes: [], patterns: [],
  });
  const idx = a => a.filter((_, i) => i % 2 === 0);
  const acc = findAccessStops(net, 50, 20, true, Float64Array.from([100, 500, NaN, Infinity]), undefined, 300);
  assert.deepEqual(idx(acc), [0, 2], 'B (500 s) odpada, C z linii prostej (~116 s) zostaje, D = Infinity');
  assert.deepEqual(idx(findAccessStops(net, 50, 20, true, Float64Array.from([100, 500, NaN, Infinity]), undefined, 60)), [], 'wszystko ponad 60 s');
  // brak grafu ulic: tylko linia prosta (~0,96 m/s → 60 s ≈ 58 m)
  assert.deepEqual(idx(findAccessStops(net, 50, 20, true, null, undefined, 60)), [0, 1]);
  assert.equal(findAccessStops(net, 50, 20, true).length / 2, 4, 'bez limitu bez zmian');
});

test('tryb ogólny z maxTransfers: 0 daje ten sam wynik co bez limitu (decyzja: Dijkstra nie modeluje przesiadek)', () => {
  const net = walkNet(300);
  const o = opts({ walk: true, mode: 'general', accessSec: ONLY_S0 });
  assert.deepEqual([...computeReachability(net, { ...o, maxTransfers: 0 }).minutes], [...computeReachability(net, o).minutes]);
});

// --- przystanki pośrednie etapu przejazdu (Z-010) ---------------------------------

const rides = legs => legs.filter(l => l.kind === 'ride');
/** Każda kolejna para z `stops` jest parą sąsiadów w którymś wzorcu (w danej kolejności). */
const adjacentInSomePattern = (net, a, b) => net.patterns.some(p => {
  for (let i = 0; i + 1 < p.stops.length; i++) if (p.stops[i] === a && p.stops[i + 1] === b) return true;
  return false;
});

test('stops: etap przejazdu zaczyna się od fromStop, kończy na toStop, pary to sąsiedzi we wzorcu', () => {
  const net = makeNet({
    stops: line(5), routes: [{ n: '1', t: 3 }],
    patterns: [{ r: 0, s: [0, 1, 2, 3, 4], p: [[60, 60, 60, 60]], t: everyN(H8, H8 + 3600, 600) }],
  });
  const r = computeReachability(net, opts());
  const [ride] = rides(r.journeyTo(3));
  assert.deepEqual(ride.stops, [0, 1, 2, 3]);
  assert.equal(ride.stops[0], ride.fromStop);
  assert.equal(ride.stops.at(-1), ride.toStop);
  for (let i = 0; i + 1 < ride.stops.length; i++) assert.ok(adjacentInSomePattern(net, ride.stops[i], ride.stops[i + 1]));
});

test('stops: dwa przejazdy z przesiadką mają własne, rozłączne ciągi', () => {
  const net = makeNet({
    stops: line(6), routes: [{ n: '1', t: 3 }, { n: '2', t: 3 }],
    patterns: [
      { r: 0, s: [0, 1, 2], p: [[60, 60]], t: [[H8, 0]] },
      { r: 1, s: [2, 3, 4, 5], p: [[60, 60, 60]], t: [[H8 + 600, 0]] },
    ],
  });
  const legs = computeReachability(net, opts()).journeyTo(5);
  assert.deepEqual(rides(legs).map(l => l.stops), [[0, 1, 2], [2, 3, 4, 5]]);
});

test('stops: kierunek „do miejsca" daje przystanki w rzeczywistej kolejności podróży (nie sieci odwróconej)', () => {
  const net = makeNet({
    stops: line(4), routes: [{ n: '1', t: 3 }],
    patterns: [{ r: 0, s: [0, 1, 2, 3], p: [[60, 60, 60]], t: everyN(H8, H8 + 7200, 600) }],
  });
  const to = computeReachability(net, opts({ direction: 'to', lat: 50 + 3 * 0.0045, lon: 20, timeMin: 500 }));
  const [ride] = rides(to.journeyTo(0));
  assert.equal(ride.fromStop, 0);
  assert.equal(ride.toStop, 3);
  assert.deepEqual(ride.stops, [0, 1, 2, 3], 'od wsiadania do wysiadania, nie odwrotnie');
  // ta sama trasa „z miejsca" daje identyczny ciąg
  const from = computeReachability(net, opts());
  assert.deepEqual(rides(from.journeyTo(3))[0].stops, ride.stops);
});

test('stops: wzorzec z pętlą daje wycinek wg pozycji, a nie wg pierwszego wystąpienia przystanku', () => {
  // przystanek 1 odwiedzany dwa razy: pozycje 1 i 3
  const net = makeNet({
    stops: line(4), routes: [{ n: 'L', t: 3 }],
    patterns: [{ r: 0, s: [0, 1, 2, 1, 3], p: [[60, 60, 60, 60]], t: [[H8, 0]] }],
  });
  const r = computeReachability(net, opts());
  assert.deepEqual(rides(r.journeyTo(3))[0].stops, [0, 1, 2, 1, 3]);
  assert.deepEqual(rides(r.journeyTo(2))[0].stops, [0, 1, 2]);
});

test('stops: tryb ogólny (Dijkstra) — scalone odcinki tej samej linii dają pełny ciąg, w obu kierunkach', () => {
  const net = makeNet({
    stops: line(4), routes: [{ n: '1', t: 3 }],
    patterns: [{ r: 0, s: [0, 1, 2, 3], p: [[60, 60, 60]], t: [[H8, 0]] }],
  });
  const from = computeReachability(net, opts({ mode: 'general', timeMin: 999 }));
  const legs = from.journeyTo(3);
  assert.equal(rides(legs).length, 1);
  assert.deepEqual(rides(legs)[0].stops, [0, 1, 2, 3]);
  const to = computeReachability(net, opts({ mode: 'general', direction: 'to', lat: 50 + 3 * 0.0045, lon: 20, timeMin: 999 }));
  assert.deepEqual(rides(to.journeyTo(0))[0].stops, [0, 1, 2, 3]);
});

test('stops: kurs nocny (24:00+) nie gubi ciągu przystanków', () => {
  const net = makeNet({
    stops: line(3), routes: [{ n: 'N1', t: 3 }],
    patterns: [{ r: 0, s: [0, 1, 2], p: [[300, 300]], t: [[25 * 3600 + 600, 0]] }],
  });
  const r = computeReachability(net, opts({ timeMin: 60 }));
  assert.deepEqual(rides(r.journeyTo(2))[0].stops, [0, 1, 2]);
});

test('stops: etapy walk i access nie dostają pola stops', () => {
  const net = makeNet({
    stops: line(3), routes: [{ n: '1', t: 3 }],
    patterns: [{ r: 0, s: [0, 1, 2], p: [[300, 300]], t: everyN(H8, H8 + 7200, 600) }],
  });
  const legs = computeReachability(net, opts({ walk: true, lat: 50, lon: 20.0005, timeMin: 479 })).journeyTo(2);
  for (const l of legs.filter(x => x.kind !== 'ride')) assert.equal('stops' in l, false);
});
