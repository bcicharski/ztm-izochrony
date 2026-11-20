import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../js/engine.js';
import { buildWalkGrid, pixelIndex } from '../js/walkgrid.js';
import { NET_WALK_MPS, NET_BIKE_MPS } from '../js/walknet.js';
import { WALK_MPS, BIKE_MPS, M_PER_DEG_LAT } from '../js/data.js';
import { makeRaw, makeWalkRaw, everyN } from './helpers.mjs';

/*
 * Syntetyczne „miasto": jedna ulica na południku 20°E od 50,00°N na północ
 * (węzły co 0,01° ≈ 1113 m). Punkt użytkownika stoi w węźle 0, a przystanki
 * leżą wzdłuż ulicy w znanych odległościach:
 *   S0  3339 m  (pieszo ~44 min, rowerem ~13 min)
 *   S1  7013 m  (pieszo ~93 min = poza capem 90 min, rowerem ~28 min = w capie 30 min)
 *   S2  8905 m  (pieszo i rowerem poza capem — rower ~36 min)
 * Każdy z nich ma własną linię do przystanku S3/S4/S5 poza grafem ulic.
 * Dane serwuje podmieniony `fetch` — testy nie dotykają data/.
 */
const stops = [
  { name: 'S0', lat: 50.03, lon: 20 },
  { name: 'S1', lat: 50.063, lon: 20 },
  { name: 'S2', lat: 50.08, lon: 20 },
  { name: 'S3', lat: 50.03, lon: 20.05 },
  { name: 'S4', lat: 50.063, lon: 20.05 },
  { name: 'S5', lat: 50.08, lon: 20.05 },
];
const patterns = [[0, 3], [1, 4], [2, 5]].map(([a, b], r) => ({
  r, s: [a, b], p: [[600]], t: everyN(7 * 3600, 12 * 3600, 300),
}));
const dayRaw = makeRaw({ stops, routes: [{ n: '1', t: 3 }, { n: '2', t: 3 }, { n: '3', t: 3 }], patterns });
const streetNodes = Array.from({ length: 10 }, (_, k) => [50 + k * 0.01, 20]);
const walkRaw = makeWalkRaw(streetNodes, streetNodes.slice(1).map((_, k) => [k, k + 1, 1113]));

/** Podmieniony fetch: liczy pobrania workday.json, resztę plików miasta serwuje albo zwraca 404. */
const dayFetches = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  const m = String(url).match(/\/data\/([^/]+)\/(.+)$/);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (m && m[2] === 'workday.json') {
    dayFetches.set(m[1], (dayFetches.get(m[1]) ?? 0) + 1);
    return json(dayRaw);
  }
  if (m && m[2] === 'walknet.json') return json(walkRaw);
  return { ok: false, status: 404, json: async () => null };
};
after(() => { globalThis.fetch = realFetch; });

const CFG = { gridBbox: [49.99, 19.99, 50.1, 20.06] };
const ORIGIN = { lat: 50, lng: 20 };
const baseParams = {
  dayKey: 'workday', direction: 'from', walk: true, mode: 'time', timeMin: 480,
  types: null, cautious: false, walkOnly: false, compare: false, point: ORIGIN, stats: false, access: 'foot',
};

/** Silnik z wczytanym miastem i grafem ulic, bez rastra lądu (ścieżka „koła crow-fly"). */
async function makeEngine(city) {
  let resolveWalk;
  const walkLoaded = new Promise(r => { resolveWalk = r; });
  const engine = new Engine({ createCanvas: () => { throw new Error('canvas niepotrzebny'); }, onWalkNet: resolveWalk });
  assert.equal(await engine.setCity(city, CFG), true);
  await walkLoaded;
  engine.assets = null; // brak geometrii: compute liczy bez siatki lądu
  return engine;
}

async function run(engine, overrides) {
  const msgs = [];
  await engine.compute({ ...baseParams, city: engine.city, ...overrides }, m => msgs.push(m));
  return { msgs, zones: msgs.find(m => m.phase === 'zones') };
}

/** Czasy dojazdu [min] per przystanek w ostatnim przeliczeniu. */
const mins = engine => [...engine.last.res.minutes];
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} ${actual} != ${expected} ±${tol}`);

test('tempa: pieszo, rower do przystanku i rower w pojeździe — role zgodnie z trybem', async () => {
  const e = await makeEngine('tstSpeeds');
  const get = async (access, direction) => { await run(e, { access, direction }); return e.last.speeds; };

  const foot = await get('foot', 'from');
  assert.equal(foot.accessMps, NET_WALK_MPS);
  assert.equal(foot.egressMps, NET_WALK_MPS);
  assert.equal(foot.cap, 90 * 60);

  const bike = await get('bike', 'from');
  assert.equal(bike.accessMps, NET_BIKE_MPS, 'rower dowozi do przystanku');
  assert.equal(bike.egressMps, NET_WALK_MPS, 'rower zostaje w stojaku — dalej pieszo');
  assert.equal(bike.cap, 30 * 60, 'cap dojazdu rowerem 30 min');
  assert.equal(bike.crowAccess, BIKE_MPS);
  assert.equal(bike.crowEgress, WALK_MPS);

  const onboard = await get('bike-onboard', 'from');
  assert.equal(onboard.accessMps, NET_BIKE_MPS);
  assert.equal(onboard.egressMps, NET_BIKE_MPS);
  assert.equal(onboard.cap, 30 * 60);

  const unknown = await get('hulajnoga', 'from');
  assert.equal(unknown.accessMps, NET_WALK_MPS, 'nieznany tryb = pieszo');
});

test('tempa: kierunek „do miejsca" zamienia role — rower dotyczy fali po mieście, nie dojścia', async () => {
  const e = await makeEngine('tstSwap');
  await run(e, { access: 'bike', direction: 'to' });
  const s = e.last.speeds;
  assert.equal(s.accessMps, NET_WALK_MPS, 'do przystanku startowego idzie się pieszo');
  assert.equal(s.egressMps, NET_BIKE_MPS, 'rower jedzie dopiero przy punkcie użytkownika');
  assert.equal(s.crowAccess, WALK_MPS);
  assert.equal(s.crowEgress, BIKE_MPS);
  assert.equal(s.cap, 90 * 60, 'dojście pieszo ma cap pieszy, nie rowerowy');

  await run(e, { access: 'bike-onboard', direction: 'to' });
  assert.equal(e.last.speeds.accessMps, NET_BIKE_MPS, 'rower w pojeździe: rower w obie strony także „do"');
  assert.equal(e.last.speeds.cap, 30 * 60);

  await run(e, { access: 'foot', direction: 'to' });
  assert.equal(e.last.speeds.accessMps, NET_WALK_MPS);
  assert.equal(e.last.speeds.cap, 90 * 60);
});

test('dojście po sieci ulic: pieszo ~44 min, rowerem ~13 min do S0; cap ucina dalsze przystanki', async () => {
  const e = await makeEngine('tstAccess');
  await run(e, { access: 'foot' });
  const net = e.last.net;
  const foot = e.accessTimesOnNet(net, ORIGIN, NET_WALK_MPS, 90 * 60);
  near(foot[0], 3339 / NET_WALK_MPS, 60, 'S0 pieszo');
  assert.equal(foot[1], Infinity, 'S1 (93 min pieszo) poza capem 90 min');
  assert.ok(Number.isNaN(foot[3]), 'przystanek poza grafem: NaN (router zostaje przy linii prostej)');

  const bike = e.accessTimesOnNet(net, ORIGIN, NET_BIKE_MPS, 30 * 60);
  near(bike[0], 3339 / NET_BIKE_MPS, 30, 'S0 rowerem');
  assert.ok(bike[1] < 30 * 60, 'S1 rowerem mieści się w capie');
  assert.equal(bike[2], Infinity, 'S2 rowerem: 36 min > cap 30 min');
});

test('zależność wyniku od trybu: rower dociera szybciej i dalej niż pieszo, cap rowerowy obowiązuje w compute', async () => {
  const e = await makeEngine('tstModes');
  await run(e, { access: 'foot' });
  const foot = mins(e);
  await run(e, { access: 'bike' });
  const bike = mins(e);

  // minutes[i] dla przystanków S0-S2 to czas dojścia po ulicy (przystanki S3-S5 są poza
  // grafem, więc router łapie je w linii prostej — nie nadają się do porównań)
  assert.ok(Number.isFinite(foot[0]) && Number.isFinite(bike[0]), 'S0 osiągalny w obu trybach');
  assert.ok(foot[0] - bike[0] > 25, `rower oszczędza ~31 min dojścia (jest ${foot[0] - bike[0]})`);
  assert.equal(foot[1], Infinity, 'S1: pieszo poza capem 90 min');
  assert.ok(Number.isFinite(bike[1]), 'S1: rowerem osiągalny');
  assert.equal(foot[2], Infinity);
  assert.equal(bike[2], Infinity, 'S2: rower nie wchodzi w cap 30 min — bez capu byłby osiągalny (~36 min)');
});

test('kierunek „do": dojście pieszo także przy rowerze, więc wynik = pieszy; „od" z rowerem jest inny', async () => {
  const e = await makeEngine('tstTo');
  await run(e, { access: 'foot', direction: 'to' });
  const toFoot = mins(e);
  await run(e, { access: 'bike', direction: 'to' });
  const toBike = mins(e);
  await run(e, { access: 'bike', direction: 'from' });
  const fromBike = mins(e);

  assert.ok(Number.isFinite(toFoot[0]));
  assert.equal(toBike[0], toFoot[0], 'S0 „do" z rowerem liczy dojście pieszo, jak bez roweru');
  assert.equal(toBike[1], Infinity, 'S1: pieszo poza capem 90 min — rower tego nie zmienia przy „do"');
  assert.ok(Number.isFinite(fromBike[1]), 'a „od" z rowerem sięga dalej');
});

test('tryby spaceru: bez spaceru zasięg się zawęża; „tylko pieszo" pomija routing', async () => {
  const e = await makeEngine('tstWalkModes');
  const withWalk = await run(e, { walk: true });
  assert.ok(e.last.res.minutes[0] > 40, 'ze spacerem do S0 trzeba dojść ~44 min');
  assert.ok(withWalk.zones.reachable > 0);
  const noWalk = await run(e, { walk: false });
  // bez spaceru podróż zaczyna się na przystanku najbliższym punktowi (S0), bez dojścia
  assert.equal(e.last.res.minutes[0], 0);
  assert.equal(e.last.res.minutes[1], Infinity, 'dalsze przystanki bez dojścia nieosiągalne');
  assert.ok(withWalk.zones.reachable >= noWalk.zones.reachable);

  const only = await run(e, { walkOnly: true });
  assert.equal(only.zones.reachable, 0);
  assert.equal(e.last.res, null, 'bez routera');
  assert.equal(e.journey({ lat: 50.01, lng: 20 }).kind, 'walkOnly');
});

test('compute: żądanie dla innego miasta niż silnik jest odrzucane', async () => {
  const e = await makeEngine('tstWrongCity');
  await assert.rejects(() => e.compute({ ...baseParams, city: 'inne' }, () => {}), /inne miasto/);
});

test('cache: przełączenie miasta zrzuca dane poprzedniego — powrót pobiera je od nowa', async () => {
  const e = await makeEngine('tstCacheA');
  await run(e, {});
  await run(e, {});
  assert.equal(dayFetches.get('tstCacheA'), 1, 'drugie przeliczenie z cache');

  await e.setCity('tstCacheB', CFG);
  e.assets = null;
  await run(e, {});
  assert.equal(dayFetches.get('tstCacheB'), 1);
  assert.equal(dayFetches.get('tstCacheA'), 1, 'cache A nietknięty do czasu powrotu');

  await e.setCity('tstCacheA', CFG);
  e.assets = null;
  await run(e, {});
  assert.equal(dayFetches.get('tstCacheA'), 2, 'po zrzuceniu liczy od nowa');
});

test('cache: ponowne ustawienie tego samego miasta niczego nie zrzuca', async () => {
  const e = await makeEngine('tstCacheSame');
  await run(e, {});
  await e.setCity('tstCacheSame', CFG);
  e.assets = null;
  await run(e, {});
  assert.equal(dayFetches.get('tstCacheSame'), 1);
});

test('dropGrid przy zmianie miasta: siatka lądu budowana od nowa po powrocie', async () => {
  // atrapa canvasu: wszystko jest lądem, rysowanie jest pomijane
  const hadImageData = 'ImageData' in globalThis;
  if (!hadImageData) globalThis.ImageData = class { constructor(w, h) { this.data = new Uint8ClampedArray(w * h * 4); } };
  try {
    const createCanvas = (w, h) => ({
      width: w, height: h,
      getContext: () => new Proxy({ getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(ww * hh * 4) }) }, {
        get: (t, k) => (k in t ? t[k] : () => {}),
        set: () => true,
      }),
    });
    const e = new Engine({ createCanvas });
    await e.setCity('tstGridA', CFG);
    const g1 = buildWalkGrid('tstGridA', CFG, null, null, null, createCanvas);
    assert.equal(buildWalkGrid('tstGridA', CFG, null, null, null, createCanvas), g1, 'z cache: ta sama siatka');
    await e.setCity('tstGridB', CFG);
    const g2 = buildWalkGrid('tstGridA', CFG, null, null, null, createCanvas);
    assert.notEqual(g2, g1, 'po zrzuceniu powstaje nowa siatka');
  } finally {
    if (!hadImageData) delete globalThis.ImageData;
  }
});

// --- limity przesiadek i spaceru (Z-012) ------------------------------------------

test('limity domyślne: run({}) i run({maxTransfers:null, maxWalkSec:null}) dają identyczne strefy', async () => {
  const e = await makeEngine('tstLimDefault');
  for (const extra of [{}, { access: 'bike' }, { walk: false }, { mode: 'general' }]) {
    const a = await run(e, extra);
    const b = await run(e, { ...extra, maxTransfers: null, maxWalkSec: null });
    assert.deepEqual(b.zones.zones, a.zones.zones, JSON.stringify(extra));
    assert.equal(b.zones.reachable, a.zones.reachable);
    assert.deepEqual(b.zones.stats, a.zones.stats);
  }
});

test('limit spaceru: dojście do S0 (~44 min pieszo) odpada przy 40 min, zostaje przy 60 min; limity zapamiętane w last', async () => {
  const e = await makeEngine('tstLimAccess');
  await run(e, {});
  assert.ok(Number.isFinite(mins(e)[0]));
  await run(e, { maxWalkSec: 3600 });
  assert.ok(Number.isFinite(mins(e)[0]));
  assert.equal(e.last.limits.maxWalkSec, 3600);
  await run(e, { maxWalkSec: 2400, maxTransfers: 1 });
  assert.equal(mins(e)[0], Infinity, 'dojście 44 min > limit 40 min');
  assert.deepEqual(e.last.limits, { maxTransfers: 1, maxWalkSec: 2400 });
  // bez spaceru i „tylko pieszo" limit spaceru nie ma znaczenia
  await run(e, { maxWalkSec: 2400, walk: false });
  assert.equal(e.last.limits.maxWalkSec, Infinity);
  await run(e, { maxWalkSec: 2400, walkOnly: true });
  assert.equal(e.last.limits.maxWalkSec, Infinity);
});

test('limit spaceru: dymek (pickTargetStop, linia prosta) nie obiecuje celu spoza limitu', async () => {
  const e = await makeEngine('tstLimPick');
  const target = { lat: 50.0465, lng: 20 }; // ok. 1,8 km od S0 i od S1
  await run(e, { access: 'bike', maxWalkSec: 1700 });
  assert.ok(Number.isFinite(mins(e)[1]), 'S1 rowerem w limicie');
  assert.equal(e.pickTargetStop(target), null, 'marsz ~31 min z najbliższego przystanku > limit 28 min');
  await run(e, { access: 'bike' });
  assert.ok(e.pickTargetStop(target), 'bez limitu cel istnieje');
});

test('walkWaveOnNet: limit tnie falę od przystanków, ale nie spacer z punktu', async () => {
  const e = await makeEngine('tstLimWave');
  await run(e, {});
  const net = e.last.net;
  const res = 25, W = 40, H = 450;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(50 * Math.PI / 180);
  const grid = { W, H, res, land: new Uint8Array(W * H).fill(1), time: new Uint16Array(W * H),
    toX: lon => (lon - 19.999) * mPerDegLon / res, toY: lat => (50.1 - lat) * M_PER_DEG_LAT / res };
  const px = lat => pixelIndex(grid, lat, 20);
  const stopsMins = new Float64Array(net.nStops).fill(Infinity);
  stopsMins[1] = 10; // S1 (50,063) osiągnięty po 10 min jazdy
  const wave = (origin, max) => { const t = e.walkWaveOnNet(grid, net, stopsMins, origin, undefined, max); return [px(50.065), px(50.072), px(50.02)].map(i => t[i]); };

  const [nearFree, farFree] = wave(null, Infinity);
  assert.ok(nearFree < 65535 && farFree < 65535, 'bez limitu fala sięga 1 km od S1');
  const [nearLim, farLim, originOnlyLim] = wave(null, 300);
  assert.ok(nearLim < 65535, 'blisko przystanku mieści się w 5 min marszu');
  assert.equal(farLim, 65535, '1 km od przystanku > 5 min marszu');
  assert.equal(originOnlyLim, 65535);
  // z punktem użytkownika w 50,00: jego spacer (2,2 km do 50,02) jest zwolniony z limitu
  const [, farWithOrigin, nearOrigin] = wave({ lat: 50, lng: 20 }, 300);
  assert.equal(farWithOrigin, 65535, 'limit dalej tnie falę od przystanków');
  assert.ok(nearOrigin < 65535, 'punkt idzie dalej niż limit — zwolniony');
  assert.ok(nearOrigin > 1500 && nearOrigin < 1900, `~2,2 km pieszo ≈ 1780 s, jest ${nearOrigin}`);
});

test('walkWaveOnNet: wynik nie zależy od starego bufora spread siatki (np. po fallbacku rastrowym z limitem)', async () => {
  const e = await makeEngine('tstSpreadStale');
  await run(e, {});
  const net = e.last.net;
  const res = 25, W = 40, H = 450;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(50 * Math.PI / 180);
  const mk = () => ({ W, H, res, land: new Uint8Array(W * H).fill(1), time: new Uint16Array(W * H),
    toX: lon => (lon - 19.999) * mPerDegLon / res, toY: lat => (50.1 - lat) * M_PER_DEG_LAT / res });
  const mins = new Float64Array(net.nStops).fill(Infinity);
  mins[1] = 10;
  const clean = mk();
  const a = [...e.walkWaveOnNet(clean, net, mins, null, undefined, 300)];
  const dirty = mk();
  dirty.spread = new Uint16Array(W * H).fill(60000); // pozostałość po dużym rozlewie
  const b = [...e.walkWaveOnNet(dirty, net, mins, null, undefined, 300)];
  assert.deepEqual(b, a);
});

test('limit spaceru przy rowerze: dojazd do przystanku też podlega limitowi (5 min ≈ 1,25 km)', async () => {
  const e = await makeEngine('tstLimBike');
  await run(e, { access: 'bike' });
  assert.ok(Number.isFinite(mins(e)[0]), 'S0 (3,3 km) rowerem osiągalny bez limitu');
  await run(e, { access: 'bike', maxWalkSec: 300 });
  assert.equal(mins(e)[0], Infinity, 'przy limicie 5 min dojazd sięga ok. 1,25 km');
  await run(e, { access: 'bike', maxWalkSec: 900 });
  assert.ok(Number.isFinite(mins(e)[0]), 'limit 15 min (3,75 km) mieści S0');
});

test('meet (Z-004): włączenie nie zmienia stref, statystyk ani zasięgu — tylko dokłada pole meet', async () => {
  const e = await makeEngine('tstMeetReg');
  const point2 = { lat: 50.063, lng: 20 };
  for (const extra of [{}, { access: 'bike' }, { walk: false }, { mode: 'general' }, { maxWalkSec: 900 }]) {
    const a = await run(e, { compare: true, point2, ...extra });
    const b = await run(e, { compare: true, point2, ...extra, meet: true });
    assert.deepEqual(b.zones.zones, a.zones.zones, JSON.stringify(extra));
    assert.equal(b.zones.reachable, a.zones.reachable, JSON.stringify(extra));
    assert.deepEqual(b.zones.stats, a.zones.stats, JSON.stringify(extra));
    assert.equal(a.zones.meet, null);
  }
});

test('meet (Z-004): bez porównania i w trybie „tylko pieszo" pole meet jest null', async () => {
  const e = await makeEngine('tstMeetNull');
  const point2 = { lat: 50.063, lng: 20 };
  assert.equal((await run(e, { meet: true })).zones.meet, null);
  assert.equal((await run(e, { compare: true, walkOnly: true, point2, meet: true })).zones.meet, null);
});

test('meet (Z-004): ranking spójny z czasami silnika i mieszczący się w oknie', async () => {
  const e = await makeEngine('tstMeetRank');
  const r = await run(e, { compare: true, meet: true, point2: { lat: 50.063, lng: 20 } });
  const meet = r.zones.meet;
  assert.ok(meet && meet.bothCount > 0, 'jest wspólny przystanek');
  const top = meet.fair[0];
  assert.equal(top.aMin, e.last.res.minutes[top.stop]);
  assert.equal(top.bMin, e.last.res2.minutes[top.stop]);
  assert.ok(top.meetMin <= meet.windowMin);
  assert.ok(meet.sum.length > 0 && typeof top.name === 'string');
});

// --- schematyczna linia trasy (Z-010) -------------------------------------------

test('journey: kind single ma anchors i shape (dojście + przejazd), legi niosą współrzędne', async () => {
  const e = await makeEngine('tstShape');
  await run(e, { walk: false }); // start na przystanku S0 (50,03; 20), bez dojścia
  const target = { lat: 50.03, lng: 20.05 };    // przystanek S3
  const j = e.journey(target);
  assert.equal(j.kind, 'single');
  assert.deepEqual(j.anchors, { start: [50, 20], end: [50.03, 20.05] });
  const ride = j.legs.find(l => l.kind === 'ride');
  assert.deepEqual(ride.path, [[50.03, 20], [50.03, 20.05]]);
  assert.deepEqual(j.legs.find(l => l.kind === 'access').pt, [50.03, 20]);
  // dojście (punkt → S0) i przejazd; koniec trasy leży na kliknięciu, więc bez dodatkowego spaceru
  assert.deepEqual(j.shape.map(s => s.kind), ['foot', 'ride']);
  assert.deepEqual(j.shape[0].pts[0], j.anchors.start);
  assert.deepEqual(j.shape.at(-1).pts.at(-1), j.anchors.end);
});

test('journey: kierunek „do miejsca" — shape zaczyna się w kliknięciu, kończy przy punkcie', async () => {
  const e = await makeEngine('tstShapeTo');
  await run(e, { walk: false, direction: 'to', point: { lat: 50.03, lng: 20.05 } });
  const click = { lat: 50.03, lng: 20 };
  const j = e.journey(click);
  assert.equal(j.kind, 'single');
  assert.deepEqual(j.anchors, { start: [50.03, 20], end: [50.03, 20.05] });
  assert.deepEqual(j.shape[0].pts[0], j.anchors.start);
  assert.deepEqual(j.shape.at(-1).pts.at(-1), j.anchors.end);
  assert.equal(j.shape.find(s => s.kind === 'ride').pts.length, 2);
});

test('journey: walkOnly i unreach nie mają shape', async () => {
  const e = await makeEngine('tstShapeNone');
  await run(e, { walkOnly: true });
  const w = e.journey({ lat: 50.01, lng: 20 });
  assert.equal(w.kind, 'walkOnly');
  assert.equal('shape' in w, false);
  await run(e, { walk: false });
  const u = e.journey({ lat: 50.09, lng: 20.2 }); // żaden przystanek w pobliżu
  assert.equal(u.kind, 'unreach');
  assert.equal('shape' in u, false);
});

test('journey: compare daje shape obu osobom, z ich własnymi kotwicami', async () => {
  const e = await makeEngine('tstShapeCmp');
  const point2 = { lat: 50.03, lng: 20.0001 };
  await run(e, { walk: false, compare: true, point2 });
  const j = e.journey({ lat: 50.03, lng: 20.05 });
  assert.equal(j.kind, 'compare');
  assert.equal(j.persons.length, 2);
  for (const p of j.persons) assert.ok(p.shape.some(s => s.kind === 'ride'));
  assert.deepEqual(j.persons[0].anchors.start, [50, 20]);
  assert.deepEqual(j.persons[1].anchors.start, [50.03, 20.0001]);
});

// --- trasy do zadanego przystanku (Z-071) ---------------------------------------

test('journeyToStop (Z-071): czasy obu osób równe tym z rankingu spotkania — karta i dymek mówią to samo', async () => {
  const point2 = { lat: 50.063, lng: 20 };
  for (const extra of [{}, { mode: 'general' }, { maxWalkSec: 3600 }, { maxTransfers: 1 }, { access: 'bike' }, { direction: 'to' }]) {
    const e = await makeEngine('tstJStop' + JSON.stringify(extra).length);
    const meet = (await run(e, { compare: true, meet: true, point2, ...extra })).zones.meet;
    assert.ok(meet && meet.bothCount > 0, JSON.stringify(extra));
    for (const c of [...meet.fair, ...meet.sum]) {
      const j = e.journeyToStop(c.stop);
      assert.equal(j.kind, 'compare');
      assert.equal(j.persons[0].totalMin, c.aMin, JSON.stringify(extra));
      assert.equal(j.persons[1].totalMin, c.bMin, JSON.stringify(extra));
      assert.equal(j.total, c.meetMin);
      assert.equal(j.targetName, c.name);
      assert.equal(j.stop, c.stop);
      assert.equal(j.walkMin, 0);
    }
  }
});

test('journeyToStop (Z-071): oba shape są obecne, a kotwica końca to współrzędne przystanku', async () => {
  const e = await makeEngine('tstJStopShape');
  const point2 = { lat: 50.063, lng: 20 };
  const meet = (await run(e, { compare: true, meet: true, point2 })).zones.meet;
  const c = meet.fair[0];
  const j = e.journeyToStop(c.stop);
  const end = [Math.round(c.lat * 1e5) / 1e5, Math.round(c.lon * 1e5) / 1e5];
  for (const p of j.persons) {
    assert.ok(p.shape.length > 0);
    assert.deepEqual(p.anchors.end, end);
  }
  assert.deepEqual(j.persons[0].anchors.start, [50, 20]);
  assert.deepEqual(j.persons[1].anchors.start, [50.063, 20]);
});

test('journeyToStop (Z-071): kierunek „do" — kotwica początku to przystanek, końca to punkt osoby', async () => {
  const e = await makeEngine('tstJStopTo');
  const point2 = { lat: 50.063, lng: 20 };
  const meet = (await run(e, { compare: true, meet: true, point2, direction: 'to' })).zones.meet;
  const c = meet.fair[0];
  const j = e.journeyToStop(c.stop);
  const at = [Math.round(c.lat * 1e5) / 1e5, Math.round(c.lon * 1e5) / 1e5];
  assert.deepEqual(j.persons[0].anchors, { start: at, end: [50, 20] });
});

test('journeyToStop (Z-071): bez porównania, w trybie pieszym i dla złego indeksu — null; poza zasięgiem — unreach', async () => {
  const e = await makeEngine('tstJStopNull');
  const point2 = { lat: 50.063, lng: 20 };
  await run(e, {});
  assert.equal(e.journeyToStop(0), null);
  await run(e, { compare: true, walkOnly: true, point2 });
  assert.equal(e.journeyToStop(0), null);
  await run(e, { compare: true, point2, walk: false });
  assert.equal(e.journeyToStop(-1), null);
  assert.equal(e.journeyToStop(9999), null);
  assert.equal(e.journeyToStop(1.5), null);
  const far = [...Array(e.last.net.nStops).keys()].find(i => !(Math.max(e.last.res.minutes[i], e.last.res2.minutes[i]) <= 90));
  assert.ok(far !== undefined);
  assert.equal(e.journeyToStop(far).kind, 'unreach');
});

test('journeyToStop (Z-071): journey() w porównaniu zwraca ten sam kształt osób (wspólny kod)', async () => {
  const e = await makeEngine('tstJStopSame');
  const point2 = { lat: 50.03, lng: 20.0001 };
  await run(e, { walk: false, compare: true, point2 });
  const a = e.journey({ lat: 50.03, lng: 20.05 });
  const b = e.journeyToStop(a.persons.length && e.last.net.stopName.indexOf('S3'));
  assert.deepEqual(b.persons, a.persons);
});

// --- Z-076: cap promienia kół poza siatką liczony tempem wyjścia z przystanku -------

/** Atrapa canvasu: sama „lądowa" siatka, bez rysowania (alfa 0 = ląd). */
const fakeCanvas = (W, H) => ({
  getContext: () => new Proxy({ getImageData: () => ({ data: new Uint8ClampedArray(W * H * 4) }) }, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: () => true,
  }),
});

/** Silnik z siatką lądu obejmującą tylko okolice węzła 0 — wszystkie przystanki S0..S5 leżą poza nią. */
async function makeGridEngine(city) {
  globalThis.ImageData ??= class { constructor(w, h) { this.data = new Uint8ClampedArray(w * h * 4); } };
  let resolveWalk;
  const walkLoaded = new Promise(r => { resolveWalk = r; });
  const engine = new Engine({ createCanvas: fakeCanvas, onWalkNet: resolveWalk });
  assert.equal(await engine.setCity(city, { gridBbox: [49.99, 19.99, 50.01, 20.01] }), true);
  await walkLoaded;
  return engine;
}

/** Największy promień koła w strefach [m] — przy dalekim przystanku z długim pasmem to właśnie cap. */
const maxRadius = zones => Math.max(...zones.zones.flatMap(z => z.circles.map(c => c[2])));
// punkt ok. 300 m od S0 (50,03): dojście mieści się w limicie 250 s także pieszo
const NEAR_S0 = { lat: 50.0273, lng: 20 };
const LIM = 250; // [s]; 250 s × tempo < 1000 m w każdym trybie, więc cap nie ginie w OUTSIDE_MAX_RADIUS_M

test('cap kół poza siatką (Z-076): tempo wyjścia z przystanku — pieszo i rower do przystanku liczą pieszo, rower w pojeździe rowerowo', async () => {
  const e = await makeGridEngine('tstOutCap');
  const cap = async (access, direction, maxWalkSec = LIM) => {
    const { zones } = await run(e, { access, direction, maxWalkSec, point: NEAR_S0 });
    assert.ok(zones, `${access}/${direction}: są koła poza siatką`);
    return maxRadius(zones);
  };
  // wartości liczone z definicji: min(OUTSIDE_MAX_RADIUS_M, limit × tempo wyjścia)
  assert.equal(await cap('foot', 'from'), LIM * WALK_MPS, 'pieszo: bez zmian');
  assert.equal(await cap('bike', 'from'), LIM * WALK_MPS, 'rower do przystanku: wyjście pieszo, bez zmian');
  const onboard = await cap('bike-onboard', 'from');
  assert.equal(onboard, LIM * BIKE_MPS, 'rower w pojeździe: wyjście rowerem');
  assert.ok(onboard > LIM * WALK_MPS);
  assert.ok(onboard <= 1000, 'nie przekracza OUTSIDE_MAX_RADIUS_M');
});

test('cap kół poza siatką (Z-076): kierunek „do miejsca" zamienia role — wyjście rowerem przy „bike" i „bike-onboard"', async () => {
  const e = await makeGridEngine('tstOutCapTo');
  const cap = async access => {
    const { zones } = await run(e, { access, direction: 'to', maxWalkSec: LIM, point: NEAR_S0 });
    assert.ok(zones, `${access}/to: są koła poza siatką`);
    return maxRadius(zones);
  };
  assert.equal(await cap('foot'), LIM * WALK_MPS);
  assert.equal(await cap('bike'), LIM * BIKE_MPS, 'po zamianie ról rower dotyczy wyjścia');
  assert.equal(await cap('bike-onboard'), LIM * BIKE_MPS);
});

test('cap kół poza siatką (Z-076): bez limitu spaceru cap to OUTSIDE_MAX_RADIUS_M w każdym trybie', async () => {
  const e = await makeGridEngine('tstOutCapFree');
  for (const [access, direction] of [['foot', 'from'], ['bike', 'from'], ['bike-onboard', 'from'], ['bike', 'to']]) {
    const { zones } = await run(e, { access, direction, point: NEAR_S0 });
    assert.ok(zones, `${access}/${direction}`);
    assert.equal(maxRadius(zones), 1000, `${access}/${direction}`);
  }
});

test('promień pasma (Z-076): tempo wyjścia z przystanku także bez limitu spaceru (koła crow-fly)', async () => {
  const e = await makeEngine('tstBandSpeed');
  /** Promień koła wokół S0 w paśmie „do 90 min" i czas dojazdu do S0 [min]. */
  const band = async (access, direction) => {
    const { zones } = await run(e, { access, direction });
    const c = zones.zones.find(z => z.limit === 90).circles.find(k => k[0] === 50.03 && k[1] === 20);
    assert.ok(c, `${access}/${direction}: koło S0`);
    return { r: c[2], t: mins(e)[0] };
  };
  for (const [access, direction, mps] of [['foot', 'from', WALK_MPS], ['bike', 'from', WALK_MPS], ['bike-onboard', 'from', BIKE_MPS], ['bike', 'to', BIKE_MPS], ['foot', 'to', WALK_MPS]]) {
    const { r, t } = await band(access, direction);
    assert.ok(Number.isFinite(t) && t < 90, `${access}/${direction}: S0 osiągalny`);
    near(r, (90 - t) * 60 * mps, 1e-6, `${access}/${direction}`);
  }
});
