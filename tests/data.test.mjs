import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeNetwork, REV_C, MIN_TRANSFER_S, profileLag, splitOvertaking, buildPatternEntries, delayCoverage } from '../js/data.js';
import { makeRaw, everyN, rng, randomNetSpec, overtakingBuildPattern } from './helpers.mjs';

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

// --- wyprzedzanie kursów (Z-005) ------------------------------------------------

const cum = deltas => deltas.reduce((a, d) => (a.push(a[a.length - 1] + d), a), [0]);

test('profileLag: max z różnic skumulowanych odjazdów', () => {
  assert.equal(profileLag(cum([600, 600]), cum([240, 240])), 720); // wolny − szybki na ostatniej pozycji
  assert.equal(profileLag(cum([240, 240]), cum([600, 600])), 0);   // na pozycji 0 różnica 0 jest maksimum
  assert.equal(profileLag(cum([300, 300]), cum([300, 300])), 0);
});

test('splitOvertaking: kursy jednoprofilowe = jeden łańcuch', () => {
  const trips = everyN(28800, 32400, 600);
  assert.deepEqual(splitOvertaking(trips, [cum([300, 300])]), [trips.map((_, i) => i)]);
});

test('splitOvertaking: przyspieszony kurs startujący później, a wyprzedzający = dwa łańcuchy', () => {
  const p = overtakingBuildPattern();
  assert.deepEqual(splitOvertaking(p.trips, p.profileList.map(cum)), [[0], [1]]);
  // dość duży odstęp startów likwiduje wyprzedzanie (lag 720 ≤ 720)
  const calm = [[28800, 0], [28800 + 720, 1]];
  assert.deepEqual(splitOvertaking(calm, [cum([600, 600]), cum([240, 240])]), [[0, 1]]);
});

test('splitOvertaking: własność na losowych danych', () => {
  const rand = rng(5);
  for (let seed = 0; seed < 60; seed++) {
    const nProf = 1 + Math.floor(rand() * 4);
    const profs = Array.from({ length: nProf }, () => cum(Array.from({ length: 4 }, () => 60 + Math.floor(rand() * 10) * 60)));
    const trips = [];
    for (let i = 0, s = 25200; i < 40; i++, s += Math.floor(rand() * 400)) trips.push([s, Math.floor(rand() * nProf)]);
    const chains = splitOvertaking(trips, profs);
    assert.ok(chains.length <= nProf, `seed ${seed}: ${chains.length} łańcuchów > ${nProf} profili`);
    assert.deepEqual(chains.flat().sort((a, b) => a - b), trips.map((_, i) => i), 'każdy kurs dokładnie raz');
    for (const ch of chains) {
      for (let i = 1; i < ch.length; i++) {
        assert.ok(ch[i] > ch[i - 1], 'kolejność z wejścia');
        const [sa, pa] = trips[ch[i - 1]], [sb, pb] = trips[ch[i]];
        for (let pos = 0; pos < profs[pa].length; pos++) assert.ok(sa + profs[pa][pos] <= sb + profs[pb][pos], `seed ${seed}: wyprzedzanie w łańcuchu`);
      }
    }
  }
});

test('flaga monotone: false dla wzorca z wyprzedzaniem, true dla zwykłego (sieć i odwrócona)', () => {
  const mk = trips => decodeNetwork(makeRaw({ stops, routes: [{ n: '1', t: 3 }], patterns: [{ r: 0, s: [0, 1, 2], p: [[600, 600], [240, 240]], t: trips }] }));
  const over = mk([[28800, 0], [28920, 1]]);
  assert.equal(over.patterns[0].monotone, false);
  assert.equal(over.overtakingPatterns, 1);
  assert.equal(over.reversed.patterns[0].monotone, false);
  const calm = mk([[28800, 0], [29700, 1], [30000, 1]]);
  assert.equal(calm.patterns[0].monotone, true);
  assert.equal(calm.overtakingPatterns, 0);
  assert.equal(calm.reversed.patterns[0].monotone, true);
  // zgodność z definicją: flaga = niemalejące depAt na każdej pozycji
  const rand = rng(11);
  let falses = 0;
  for (let seed = 0; seed < 30; seed++) {
    const net = decodeNetwork(makeRaw(randomNetSpec(rand, { overtaking: true })));
    for (const g of [net, net.reversed]) {
      for (const p of g.patterns) {
        let ok = true;
        for (let pos = 0; pos < p.stops.length; pos++) for (let t = 1; t < p.nTrips; t++) if (p.depAt[pos * p.nTrips + t] < p.depAt[pos * p.nTrips + t - 1]) ok = false;
        assert.equal(p.monotone, ok, `seed ${seed}`);
        if (!ok) falses++;
      }
    }
  }
  assert.ok(falses > 0, 'opcja overtaking powinna dawać wzorce z wyprzedzaniem');
});

test('buildPatternEntries: bez wyprzedzania wpis identyczny jak dotychczasowy, z wyprzedzaniem — łańcuchy z przenumerowanymi profilami', () => {
  const calm = { route: 2, stops: [0, 1, 2], flags: [0, 0, 0], profileList: [[300, 300]], dwellList: [[0, 0, 0]], trips: everyN(28800, 30000, 600) };
  // stara gałąź buildu (przed Z-005), przepisana dosłownie
  const legacy = p => {
    const entry = { r: p.route, s: p.stops, f: p.flags.some(f => f) ? p.flags : 0, p: p.profileList, t: p.trips };
    if (p.dwellList.some(dw => dw.some(x => x))) entry.d = p.dwellList;
    return entry;
  };
  assert.equal(JSON.stringify(buildPatternEntries(calm)), JSON.stringify([legacy(calm)]));
  const withDwell = { ...calm, flags: [0, 1, 0], dwellList: [[0, 60, 0]] };
  assert.equal(JSON.stringify(buildPatternEntries(withDwell)), JSON.stringify([legacy(withDwell)]));

  const entries = buildPatternEntries(overtakingBuildPattern());
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(e => e.p), [[[600, 600]], [[240, 240]]]);
  assert.deepEqual(entries.map(e => e.t), [[[28800, 0]], [[28920, 0]]]);
  // po zdekodowaniu żaden wpis nie wyprzedza
  const net = decodeNetwork(makeRaw({ stops, routes: [{ n: '1', t: 3 }], patterns: entries }));
  assert.equal(net.overtakingPatterns, 0);
});

test('koszt: splitOvertaking i flaga monotone na dużym wzorcu', () => {
  const nTrips = 30000;
  const profs = [cum(Array.from({ length: 60 }, () => 120)), cum(Array.from({ length: 60 }, () => 100))];
  const trips = [];
  for (let i = 0; i < nTrips; i++) trips.push([21600 + i * 2, i % 5 === 4 ? 1 : 0]);
  let t0 = performance.now();
  splitOvertaking(trips, profs);
  const msSplit = performance.now() - t0;
  const raw = { stops, routes: [{ n: '1', t: 3 }], patterns: [{ r: 0, s: Array.from({ length: 61 }, (_, i) => i % 3), p: profs.map(c => c.slice(1).map((v, i) => v - c[i])), t: trips }] };
  t0 = performance.now();
  decodeNetwork(makeRaw(raw));
  const msDecode = performance.now() - t0;
  console.log(`# splitOvertaking(${nTrips} kursów): ${msSplit.toFixed(1)} ms; decodeNetwork całość: ${msDecode.toFixed(1)} ms`);
  assert.ok(msSplit < 1000, 'splitOvertaking powinno mieścić się w ułamku sekundy');
});

test('ZTM_SCAN_DATA: dane w data/ nie mają wyprzedzania (domyślnie pomijane)', { skip: !process.env.ZTM_SCAN_DATA }, async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.join(import.meta.dirname, '..', 'data');
  for (const city of fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory())) {
    for (const day of ['workday', 'saturday', 'sunday']) {
      const file = path.join(root, city.name, `${day}.json`);
      if (!fs.existsSync(file)) continue;
      const net = decodeNetwork(JSON.parse(fs.readFileSync(file, 'utf8')));
      assert.equal(net.overtakingPatterns, 0, `${city.name}/${day}`);
    }
  }
});

test('delayCoverage: cztery stany pokrycia profilami', () => {
  const d = (routes, extra = {}) => ({ delays: { routes, routesTotal: 180, keys: 10, updated: '20261116', source: null, ...extra } });
  assert.deepEqual(delayCoverage(d(128), { rt: {} }), { state: 'profiles', routes: 128, routesTotal: 180, updated: '20261116' });
  assert.equal(delayCoverage(d(0), { rt: { type: 'x' } }).state, 'collecting');
  assert.equal(delayCoverage(d(0), {}).state, 'none');
  assert.equal(delayCoverage({ city: 'x' }, { rt: {} }).state, 'unknown');
  assert.equal(delayCoverage(null, undefined).state, 'unknown');
  assert.equal(delayCoverage(d(0, { routesTotal: null }), {}).routesTotal, null);
});
