#!/usr/bin/env node
/**
 * Bramka porównawcza dla świeżo pobranego grafu pieszego z OSM (Z-023):
 * porównuje NOWY walknet.json z OBECNYM (odniesieniem) i wykrywa przede
 * wszystkim urwaną odpowiedź Overpassa — graf mniejszy o dowolny procent,
 * który przechodzi wszystkie kontrole wewnętrzne (tools/check-osm.mjs).
 *
 * Silnik porównania to `compareNets` z tools/walknet-ab.mjs (bramka Z-003);
 * tu dochodzi własny profil progów i metryki liczbowe samych plików.
 *
 * Dyskryminatory (urwana odpowiedź uderza w nie wszystkie naraz, remont jednej
 * ulicy w żadną): spadek liczby węzłów, krawędzi i sumy kilometrów sieci; spadek
 * metrów osiągalnych w każdym paśmie 10/20/30/45/60 min; spadek udziału głównej
 * składowej; udział par przystanków osiągalnych tylko w jednej z sieci.
 *
 * Mediana i p95 różnicy czasu NIE są dyskryminatorem. Progi 5 s / 15 s z bramki
 * Z-003 są dobre dla bezstratnego przekodowania; nowy graf z OSM ma prawdziwie
 * zmienione ulice, więc pojedyncze czasy się zmieniają. Zostają w raporcie jako
 * informacja.
 *
 * Tryb domyślny: RAPORT BEZ BLOKOWANIA (kod wyjścia 0 zawsze, gdy plik da się
 * porównać). `--enforce` zwraca 1 przy przekroczeniu progu blokady. Brak pliku
 * odniesienia nie jest błędem: wynik pozytywny z adnotacją.
 *
 * Użycie:
 *   node tools/check-osm-diff.mjs <miasto> --new plik [--old plik] [--points N] [--enforce] [--json]
 *   (--old domyślnie data/<miasto>/walknet.json; przystanki z data/<miasto>/workday.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import { decodeWalkNet } from '../js/walknet.js';
import { compareNets, loadStops, BANDS_MIN } from './walknet-ab.mjs';

/**
 * Profil progów. ZMIERZONE 2026-11-27 (krok 5 projektu Z-023), n = 2 miasta.
 *
 * Normalna zmiana: graf z lipca 2026 (81e970f) vs świeże pobranie z Overpassa, ten sam
 * kod budujący i ten sam bbox, więc różnica to wyłącznie zmiany w OSM przez ~4 miesiące:
 *               węzły  krawędzie  km     pasma 10..60 min   główna skł.  pary jednostronne
 *   Gorzów      +4,4%  +4,3%      +1,2%  +2,8% … +3,8%     -0,09 pp     0,58%
 *   Warszawa    +1,3%  +1,3%      +0,8%  +0,8% … +1,0%     +0,02 pp     0,46%
 * Normalna zmiana jest WZROSTEM (mapowanie dojrzewa); normalnego spadku nie zaobserwowano,
 * więc progi spadków mają zapas nad największą zmianą co do modułu.
 *
 * Czułość na awarię — odpowiedź ucięta do 98% / 95% / 90% / 80% elementów (symulacja na
 * surowych odpowiedziach; ucięcie gubi współrzędne węzłów, więc giną długie krawędzie):
 *   km          Gorzów -4,7 / -11,2 / -20,1 / -35,0%   Warszawa -3,7 / -9,9%
 *   węzły       Gorzów +2,3 / -0,4 / -6,8 / -17,4%     Warszawa -1,0 / -4,6%
 *   pasma       Gorzów +3 / +3 / -3 / -10,5% (10 min)  Warszawa -0,4 / -3,5%
 *   pary jednostronne  Gorzów 0,6 / 1,1 / 6,1 / 13,3%  Warszawa 1,2 / 3,1%
 * Kilometry sieci są dyskryminatorem głównym: węzły, krawędzie i pasma maskuje normalny
 * wzrost o ok. 4%, więc są tylko wsparciem. Ucięcie o 2% daje ostrzeżenie, o 5% blokadę.
 *
 * OGRANICZENIA POMIARU: dwa miasta, jeden przedział czasu; strona SPADKÓW normalnej zmiany
 * (w OSM usunięto większy fragment sieci) nie była obserwowana; ucięcie to model syntetyczny.
 * `mainShareDrop` jest mało czuły na umiarkowane ucięcie (spada dopiero przy ~50%) — trzymany
 * wysoko celowo, łapie tylko katastrofę. Warto powtórzyć na realnych odświeżeniach z rotacji.
 *
 * `measured` mówi, które progi mają pomiar za sobą; klucz bez `true` wypisuje się w raporcie
 * jako zgadnięty. Wartości to ułamki (0,15 = 15%); `mainShareDrop` to spadek bezwzględny.
 */
export const PROFILE = {
  measured: {
    nodesDrop: true, edgesDrop: true, kmDrop: true, bandDrop: true,
    mainShareDrop: true, oneSidedShare: true, growthWarn: true,
  },
  nodesDrop: { block: 0.15, warn: 0.08 },     // było 0,15 / 0,05
  edgesDrop: { block: 0.15, warn: 0.08 },     // było 0,15 / 0,05
  kmDrop: { block: 0.08, warn: 0.03 },        // było 0,15 / 0,05
  bandDrop: { block: 0.12, warn: 0.07 },      // było 0,10 / 0,05
  mainShareDrop: { block: 0.05, warn: 0.02 }, // bez zmian
  oneSidedShare: { block: 0.05, warn: 0.02 }, // było 0,10 / 0,03
  growthWarn: 0.25,                           // bez zmian
};

const pct = v => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const SEVERITY = { ok: 0, warn: 1, block: 2 };

/** Metryki liczbowe samej sieci. */
export function netMetrics(net) {
  let m = 0;
  for (let e = 0; e < net.edgeLen.length; e++) m += net.edgeLen[e];
  return { nodes: net.n, edges: net.edgeLen.length, km: m / 1000 };
}

/** Zmiana względna (nowe − stare) / stare; 0, gdy oba zero. */
const rel = (a, b) => (a ? (b - a) / a : (b ? 1 : 0));

/**
 * Porównanie dwóch zdekodowanych sieci. Czyste (bez dysku).
 * @param {object|null} oldNet odniesienie; null = brak (wynik pozytywny z adnotacją)
 * @param {object} newNet
 * @param {{lat: ArrayLike<number>, lon: ArrayLike<number>}} stops
 * @param {{points?: number, enforce?: boolean, profile?: object}} [opts]
 * @returns {{severity: 'ok'|'warn'|'block', blocked: boolean, findings: Array<{level: string, msg: string}>,
 *   metrics: object|null, info: object|null, notes: string[]}}
 *   `severity` to uczciwa ocena progów; `blocked` jest prawdą tylko z `enforce`.
 */
export function diffNets(oldNet, newNet, stops, { points = 100, enforce = false, profile = PROFILE } = {}) {
  const notes = [];
  if (!oldNet) {
    notes.push('brak pliku odniesienia — nie ma z czym porównać (wynik pozytywny)');
    return { severity: 'ok', blocked: false, findings: [], metrics: { new: netMetrics(newNet) }, info: null, notes };
  }
  const findings = [];
  const add = (level, msg) => findings.push({ level, msg });
  const drop = (label, change, th) => {
    if (-change >= th.block) add('block', `${label}: spadek o ${pct(-change)} (próg blokady ${pct(th.block)})`);
    else if (-change >= th.warn) add('warn', `${label}: spadek o ${pct(-change)} (próg ostrzeżenia ${pct(th.warn)})`);
    else if (change >= profile.growthWarn) add('warn', `${label}: wzrost o ${pct(change)} (ostrzeżenie od ${pct(profile.growthWarn)})`);
  };

  const mo = netMetrics(oldNet), mn = netMetrics(newNet);
  const change = { nodes: rel(mo.nodes, mn.nodes), edges: rel(mo.edges, mn.edges), km: rel(mo.km, mn.km) };
  drop('liczba węzłów', change.nodes, profile.nodesDrop);
  drop('liczba krawędzi', change.edges, profile.edgesDrop);
  drop('kilometry sieci', change.km, profile.kmDrop);

  const cmp = compareNets(oldNet, newNet, stops, { points });
  const bandChange = cmp.bandOldM.map((v, k) => rel(v, cmp.bandNewM[k]));
  cmp.bandOldM.forEach((v, k) => { if (v > 0) drop(`metry w paśmie ${BANDS_MIN[k]} min`, bandChange[k], profile.bandDrop); });
  if (!cmp.bandOldM.some(v => v > 0)) notes.push('brak osiągalnej sieci w próbie — pasma nie były oceniane');

  const mainDrop = cmp.mainShareOld - cmp.mainShareNew;
  if (mainDrop >= profile.mainShareDrop.block) add('block', `udział głównej składowej: spadek o ${pct(mainDrop)} punktu (próg blokady ${pct(profile.mainShareDrop.block)})`);
  else if (mainDrop >= profile.mainShareDrop.warn) add('warn', `udział głównej składowej: spadek o ${pct(mainDrop)} punktu (próg ostrzeżenia ${pct(profile.mainShareDrop.warn)})`);

  const oneSidedShare = cmp.stopPairs ? cmp.oneSided / cmp.stopPairs : 0;
  if (oneSidedShare >= profile.oneSidedShare.block) add('block', `pary przystanków osiągalne w jednej sieci: ${pct(oneSidedShare)} (próg blokady ${pct(profile.oneSidedShare.block)})`);
  else if (oneSidedShare >= profile.oneSidedShare.warn) add('warn', `pary przystanków osiągalne w jednej sieci: ${pct(oneSidedShare)} (próg ostrzeżenia ${pct(profile.oneSidedShare.warn)})`);
  if (!cmp.stopPairs) notes.push('brak osiągalnych par przystanków w próbie — metryki trasowania nie były oceniane');

  const severity = findings.reduce((s, f) => (SEVERITY[f.level] > SEVERITY[s] ? f.level : s), 'ok');
  const guessed = Object.keys(profile).filter(k => k !== 'measured' && !profile.measured?.[k]);
  if (guessed.length) notes.push(`progi zgadnięte, niezmierzone: ${guessed.join(', ')} (krok 5 projektu Z-023)`);
  return {
    severity,
    blocked: enforce && severity === 'block',
    findings,
    metrics: { old: mo, new: mn, change, bandChange, mainShareOld: cmp.mainShareOld, mainShareNew: cmp.mainShareNew, oneSidedShare },
    // informacja, nie dyskryminator (patrz opis pliku)
    info: { medianS: cmp.medianS, p95S: cmp.p95S, maxS: cmp.maxS, stopPairs: cmp.stopPairs, oneSided: cmp.oneSided, snapMismatch: cmp.snapMismatch, points: cmp.points, z003Pass: cmp.pass },
    notes,
  };
}

/**
 * Porównanie plików. Brak pliku odniesienia (`oldFile`) = wynik pozytywny z adnotacją;
 * brak nowego pliku to błąd (wyjątek).
 * @param {{oldFile: string, newFile: string, stopsDir: string}} p
 */
export function diffFiles({ oldFile, newFile, stopsDir }, opts = {}) {
  const newNet = decodeWalkNet(JSON.parse(fs.readFileSync(newFile, 'utf8')));
  if (!fs.existsSync(oldFile)) return diffNets(null, newNet, { lat: [], lon: [] }, opts);
  const oldNet = decodeWalkNet(JSON.parse(fs.readFileSync(oldFile, 'utf8')));
  let stops;
  const extra = [];
  try { stops = loadStops(stopsDir); } catch {
    stops = { lat: [], lon: [] };
    extra.push(`brak ${path.join(stopsDir, 'workday.json')} — pominięto trasowanie (tylko metryki plików)`);
  }
  const r = diffNets(oldNet, newNet, stops, opts);
  r.notes.push(...extra);
  return r;
}

/** Raport w Markdown. */
export function formatReport(key, r, { enforce = false } = {}) {
  const lines = [`### ${key}: ${r.blocked ? 'BLOKADA' : r.severity === 'block' ? 'PRZEKROCZONY PRÓG BLOKADY (tryb raportowania — nie blokuje)' : r.severity === 'warn' ? 'OSTRZEŻENIE' : 'OK'}`];
  const m = r.metrics;
  if (m?.old) {
    lines.push(`- węzły ${m.old.nodes} → ${m.new.nodes} (${pct(m.change.nodes)}), krawędzie ${m.old.edges} → ${m.new.edges} (${pct(m.change.edges)}), km ${m.old.km.toFixed(1)} → ${m.new.km.toFixed(1)} (${pct(m.change.km)})`);
    lines.push(`- metry w pasmach ${BANDS_MIN.join('/')} min: ${m.bandChange.map(pct).join(' / ')}`);
    lines.push(`- główna składowa ${pct(m.mainShareOld)} → ${pct(m.mainShareNew)}; pary jednostronne ${pct(m.oneSidedShare)}`);
  }
  if (r.info) lines.push(`- informacyjnie (nie dyskryminator): mediana różnicy czasu ${r.info.medianS} s, p95 ${r.info.p95S} s, max ${r.info.maxS} s, par ${r.info.stopPairs}`);
  for (const f of r.findings) lines.push(`- ${f.level === 'block' ? 'BLOKADA' : 'OSTRZEŻENIE'}: ${f.msg}`);
  for (const n of r.notes) lines.push(`- uwaga: ${n}`);
  if (!enforce) lines.push('- tryb: raport bez blokowania (`--enforce` włącza blokadę)');
  return lines.join('\n') + '\n';
}

/** CLI; zwraca { code, out } zamiast kończyć proces (testy). */
export function run(argv, { root = path.join(import.meta.dirname, '..') } = {}) {
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const valueFlags = ['--new', '--old', '--points'];
  const key = argv.find((a, i) => !a.startsWith('--') && !valueFlags.includes(argv[i - 1]));
  const newFile = opt('--new');
  const cities = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cities.json'), 'utf8'));
  if (!key || !cities[key] || !newFile) {
    return { code: 2, out: `Użycie: check-osm-diff.mjs <miasto> --new plik [--old plik] [--points N] [--enforce] [--json]. Miasta: ${Object.keys(cities).join(', ')}\n` };
  }
  if (!fs.existsSync(newFile)) return { code: 2, out: `Brak nowego pliku: ${newFile}\n` };
  const dir = path.join(root, 'data', key);
  const enforce = argv.includes('--enforce');
  const r = diffFiles({ oldFile: opt('--old') ?? path.join(dir, 'walknet.json'), newFile, stopsDir: dir }, { points: Number(opt('--points') ?? 100), enforce });
  return { code: r.blocked ? 1 : 0, out: argv.includes('--json') ? JSON.stringify(r, null, 2) + '\n' : formatReport(key, r, { enforce }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const { code, out } = run(process.argv.slice(2));
  process.stdout.write(out);
  process.exit(code);
}
