import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../js/engine.js';
import { buildWalkGrid } from '../js/walkgrid.js';
import { NET_WALK_MPS, NET_BIKE_MPS } from '../js/walknet.js';
import { WALK_MPS, BIKE_MPS } from '../js/data.js';
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
