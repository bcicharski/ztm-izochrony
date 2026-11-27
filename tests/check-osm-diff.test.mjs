import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeWalkNet } from '../js/walknet.js';
import { diffNets, diffFiles, netMetrics, run, PROFILE } from '../tools/check-osm-diff.mjs';
import { makeWalkRaw } from './helpers.mjs';
import { M_PER_DEG_LAT } from '../js/data.js';

const mPerLon = M_PER_DEG_LAT * Math.cos(50 * Math.PI / 180);
const at = (x, y) => [50 + y / M_PER_DEG_LAT, 20 + x / mPerLon];
const K = 12; // siatka K×K co 120 m

function lattice(k = K) {
  const nodes = [], edges = [];
  for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) nodes.push(at(x * 120, y * 120));
  for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
    const i = y * k + x;
    if (x < k - 1) edges.push([i, i + 1, 120]);
    if (y < k - 1) edges.push([i, i + k, 120]);
  }
  const stops = { lat: nodes.filter((_, i) => i % 7 === 0).map(n => n[0]), lon: nodes.filter((_, i) => i % 7 === 0).map(n => n[1]) };
  return { nodes, edges, stops };
}
const net = (nodes, edges) => decodeWalkNet(makeWalkRaw(nodes, edges));

test('identyczne grafy: wynik pozytywny, zero zmian, brak ostrzeżeń', () => {
  const { nodes, edges, stops } = lattice();
  const r = diffNets(net(nodes, edges), net(nodes, edges), stops, { points: 20, enforce: true });
  assert.equal(r.severity, 'ok');
  assert.equal(r.blocked, false);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.metrics.bandChange, [0, 0, 0, 0, 0]);
  assert.equal(r.metrics.change.edges, 0);
  assert.equal(r.metrics.oneSidedShare, 0);
  assert.ok(r.info.stopPairs > 0);
});

test('usunięcie połowy krawędzi (urwana odpowiedź): blokada w trybie --enforce', () => {
  const { nodes, edges, stops } = lattice();
  const half = edges.filter((_, i) => i % 2 === 0);
  const r = diffNets(net(nodes, edges), net(nodes, half), stops, { points: 20, enforce: true });
  assert.equal(r.severity, 'block');
  assert.equal(r.blocked, true);
  const msgs = r.findings.filter(f => f.level === 'block').map(f => f.msg).join('\n');
  assert.match(msgs, /liczba krawędzi/);
  assert.match(msgs, /kilometry sieci/);
  assert.match(msgs, /metry w paśmie/);
});

test('mała perturbacja (jedna ulica usunięta, jedna dłuższa): bez blokady', () => {
  const { nodes, edges, stops } = lattice();
  const small = edges.filter((_, i) => i !== 40).map((e, i) => (i === 10 ? [e[0], e[1], 150] : e));
  const r = diffNets(net(nodes, edges), net(nodes, small), stops, { points: 20, enforce: true });
  assert.notEqual(r.severity, 'block');
  assert.equal(r.blocked, false);
  assert.ok(r.info.medianS >= 0); // mediana jest tylko informacją
});

test('tryb bez blokowania nigdy nie blokuje, ale uczciwie podaje przekroczenie progu', () => {
  const { nodes, edges, stops } = lattice();
  const half = edges.filter((_, i) => i % 2 === 0);
  const r = diffNets(net(nodes, edges), net(nodes, half), stops, { points: 20 });
  assert.equal(r.blocked, false);
  assert.equal(r.severity, 'block');
  assert.ok(!r.notes.some(n => /zgadnięte/.test(n))); // wszystkie progi zmierzone
});

test('próg bez pomiaru jest jawnie oznaczony w raporcie jako zgadnięty', () => {
  const { nodes, edges, stops } = lattice();
  const profile = { ...PROFILE, measured: { ...PROFILE.measured, oneSidedShare: false } };
  const r = diffNets(net(nodes, edges), net(nodes, edges), stops, { points: 5, profile });
  assert.ok(r.notes.some(n => /zgadnięte, niezmierzone: oneSidedShare/.test(n)));
});

test('progi mają zapas nad zmierzoną normalną zmianą i łapią ucięcie o 5% (pomiar 2026-11-27)', () => {
  // największa normalna zmiana co do modułu: Gorzów lipiec -> listopad 2026
  const normal = { nodes: 0.0443, edges: 0.0432, km: 0.0119, band: 0.0384, mainDrop: 0.0009, oneSided: 0.0058 };
  // ucięcie odpowiedzi do 95% elementów: spadek km o 9,9% (Warszawa) i 11,2% (Gorzów)
  const cut95 = { km: 0.099, oneSided: 0.031 };
  assert.ok(PROFILE.nodesDrop.warn >= 1.5 * normal.nodes);
  assert.ok(PROFILE.edgesDrop.warn >= 1.5 * normal.edges);
  assert.ok(PROFILE.kmDrop.warn >= 2 * normal.km);
  assert.ok(PROFILE.bandDrop.warn >= 1.5 * normal.band);
  assert.ok(PROFILE.mainShareDrop.warn >= 10 * normal.mainDrop);
  assert.ok(PROFILE.oneSidedShare.warn >= 3 * normal.oneSided);
  assert.ok(PROFILE.growthWarn >= 5 * normal.nodes);
  for (const k of ['nodesDrop', 'edgesDrop', 'kmDrop', 'bandDrop', 'mainShareDrop', 'oneSidedShare']) {
    assert.ok(PROFILE[k].block > PROFILE[k].warn, k);
    assert.equal(PROFILE.measured[k], true, k);
  }
  assert.ok(cut95.km >= PROFILE.kmDrop.block, 'ucięcie o 5% ma przekraczać próg blokady km');
  assert.ok(cut95.oneSided >= PROFILE.oneSidedShare.warn);
});

test('mediana i p95 różnicy czasu nie są dyskryminatorem: sama zmiana czasów bez utraty sieci nie blokuje', () => {
  const { nodes, edges, stops } = lattice();
  // wszystkie ulice o 12% dłuższe (prawdziwa zmiana OSM): czasy wyraźnie inne, sieci nie ubyło
  const longer = edges.map(([a, b, l]) => [a, b, Math.round(l * 1.12)]);
  const r = diffNets(net(nodes, edges), net(nodes, longer), stops, { points: 20, enforce: true });
  assert.ok(r.info.p95S > 15); // próg Z-003 byłby przekroczony
  assert.equal(r.info.z003Pass, false);
  assert.notEqual(r.severity, 'block');
  assert.equal(r.blocked, false);
});

test('brak odniesienia: wynik pozytywny z adnotacją (graf i plik)', () => {
  const { nodes, edges } = lattice(4);
  const r = diffNets(null, net(nodes, edges), { lat: [], lon: [] }, { enforce: true });
  assert.equal(r.severity, 'ok');
  assert.equal(r.blocked, false);
  assert.ok(r.notes.some(n => /brak pliku odniesienia/.test(n)));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-diff-'));
  const newFile = path.join(dir, 'nowy.json');
  fs.writeFileSync(newFile, JSON.stringify(makeWalkRaw(nodes, edges)));
  const f = diffFiles({ oldFile: path.join(dir, 'nie-ma.json'), newFile, stopsDir: dir }, { enforce: true });
  assert.equal(f.severity, 'ok');
  assert.equal(f.blocked, false);
  assert.equal(netMetrics(net(nodes, edges)).edges, edges.length);
});

test('CLI: raport bez blokowania daje kod 0 nawet przy urwanym grafie, --enforce kod 1, brak nowego pliku kod 2', () => {
  const { nodes, edges, stops } = lattice();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-diff-cli-'));
  const dir = path.join(root, 'data', 'x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'cities.json'), JSON.stringify({ x: { name: 'X' } }));
  fs.writeFileSync(path.join(dir, 'walknet.json'), JSON.stringify(makeWalkRaw(nodes, edges)));
  fs.writeFileSync(path.join(dir, 'workday.json'), JSON.stringify({ stops: { lat: stops.lat.map(v => Math.round(v * 1e5)), lon: stops.lon.map(v => Math.round(v * 1e5)) } }));
  const cut = path.join(root, 'nowy.json');
  fs.writeFileSync(cut, JSON.stringify(makeWalkRaw(nodes, edges.filter((_, i) => i % 2 === 0))));

  const soft = run(['x', '--new', cut, '--points', '20'], { root });
  assert.equal(soft.code, 0);
  assert.match(soft.out, /PRZEKROCZONY PRÓG BLOKADY \(tryb raportowania/);
  assert.match(soft.out, /mediana różnicy czasu/);
  const hard = run(['x', '--new', cut, '--points', '20', '--enforce'], { root });
  assert.equal(hard.code, 1);
  assert.match(hard.out, /BLOKADA/);
  assert.equal(run(['x', '--new', path.join(root, 'brak.json')], { root }).code, 2);
  assert.equal(run(['nieznane', '--new', cut], { root }).code, 2);
  // bez pliku odniesienia: kod 0
  fs.rmSync(path.join(dir, 'walknet.json'));
  assert.equal(run(['x', '--new', cut, '--enforce'], { root }).code, 0);
});
