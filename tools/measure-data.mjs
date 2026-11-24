#!/usr/bin/env node
/**
 * Pomiar rozmiarów danych (Z-003). Tylko do odczytu — nic nie zapisuje w data/.
 *
 * Użycie:
 *   node tools/measure-data.mjs [miasto|all] [--variants]
 *
 * Dla każdego pliku w data/<miasto>/ i dla data/cities.json: rozmiar surowy oraz
 * po gzipie na poziomie 6 (tak liczy serwer) i 9. Dla walknet.json dodatkowo
 * statystyki grafu. Z `--variants` — rozmiary hipotetycznych wariantów kodowania
 * liczone w pamięci (nic nie trafia na dysk).
 */

import fs from 'node:fs';
import path from 'node:path';
import { decodeWalkNet } from '../js/walknet.js';
import { gzipSize, graphStats, measureVariants, gain, GATE_JSON, GATE_BINARY, EDGE_THRESHOLDS_M, EDGE_PERCENTILES } from './measure-lib.mjs';

const DATA = path.join(import.meta.dirname, '..', 'data');
const args = process.argv.slice(2);
const withVariants = args.includes('--variants');
const target = args.find(a => !a.startsWith('--')) ?? 'all';

const cities = JSON.parse(fs.readFileSync(path.join(DATA, 'cities.json'), 'utf8'));
const keys = target === 'all' ? Object.keys(cities) : [target];
if (!keys.every(k => cities[k])) {
  console.error(`Nieznane miasto. Dostępne: all, ${Object.keys(cities).join(', ')}`);
  process.exit(1);
}

const kb = n => (n / 1024).toFixed(1);
const pct = x => `${(x * 100).toFixed(1)}%`;
const pad = (s, w) => String(s).padStart(w);

/** Rozmiary pliku: surowy, gz6, gz9. */
function sizes(file) {
  const buf = fs.readFileSync(file);
  return { raw: buf.length, gz6: gzipSize(buf, 6), gz9: gzipSize(buf, 9) };
}

function loadNet(cityKey) {
  const file = path.join(DATA, cityKey, 'walknet.json');
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { raw, net: decodeWalkNet(raw) };
  } catch (err) {
    console.error(`  ! ${cityKey}/walknet.json: nie da się wczytać (${err.message})`);
    return null;
  }
}

// --- tabela rozmiarów ----------------------------------------------------
const perCity = {};
for (const key of keys) {
  const dir = path.join(DATA, key);
  perCity[key] = {};
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isFile()) perCity[key][name] = sizes(full);
  }
}
const fileNames = [...new Set(keys.flatMap(k => Object.keys(perCity[k])))].sort();
const citiesJson = sizes(path.join(DATA, 'cities.json'));

for (const [title, field] of [['SUROWE [KB]', 'raw'], ['GZIP-6 [KB]', 'gz6'], ['GZIP-9 [KB]', 'gz9']]) {
  console.log(`\n== Rozmiary ${title} ==`);
  console.log(['miasto'.padEnd(12), ...fileNames.map(n => pad(n.replace('.json', ''), 10)), pad('RAZEM', 10)].join(' '));
  const tot = {};
  for (const key of keys) {
    let sum = 0;
    const cells = fileNames.map(n => {
      const s = perCity[key][n];
      if (!s) return pad('-', 10);
      sum += s[field]; tot[n] = (tot[n] ?? 0) + s[field];
      return pad(kb(s[field]), 10);
    });
    console.log([key.padEnd(12), ...cells, pad(kb(sum), 10)].join(' '));
  }
  if (keys.length > 1) {
    const all = Object.values(tot).reduce((a, b) => a + b, 0);
    console.log(['SUMA'.padEnd(12), ...fileNames.map(n => pad(kb(tot[n] ?? 0), 10)), pad(kb(all), 10)].join(' '));
  }
}
console.log(`\ncities.json: surowy ${kb(citiesJson.raw)} KB, gzip-6 ${kb(citiesJson.gz6)} KB, gzip-9 ${kb(citiesJson.gz9)} KB`);

// --- statystyki grafu ----------------------------------------------------
function printGraph(key, st) {
  console.log(`\n== Graf pieszy: ${key} ==`);
  console.log(`węzły ${st.nodes}, krawędzie ${st.edges}, sieć ${st.km.toFixed(0)} km`);
  console.log('stopnie wierzchołków: ' + Object.entries(st.degrees).map(([d, c]) => `${d}:${c}`).join('  '));
  console.log('długość krawędzi [m]: ' + EDGE_PERCENTILES.map(p => `p${p}=${st.percentiles[p]}`).join('  '));
  console.log('krawędzie krótsze niż:   ' + EDGE_THRESHOLDS_M.map(t => `${t} m: ${pct(st.shortShare[t].edges)} krawędzi / ${pct(st.shortShare[t].km)} km`).join('   '));
}

const nets = {};
for (const key of keys) {
  const loaded = loadNet(key);
  if (!loaded) { console.log(`\n${key}: brak walknet.json lub plik uszkodzony — pomijam statystyki`); continue; }
  nets[key] = loaded;
  printGraph(key, graphStats(loaded.raw, loaded.net));
}

// --- warianty ------------------------------------------------------------
if (withVariants) {
  for (const key of keys) {
    if (!nets[key]) continue;
    const res = measureVariants(nets[key].net);
    const actual = perCity[key]['walknet.json'];
    const ref = res[0];
    console.log(`\n== Warianty kodowania: ${key} ==`);
    console.log(`plik na dysku: raw ${kb(actual.raw)} KB, gz6 ${kb(actual.gz6)} KB; odtworzony "obecny": raw ${kb(ref.jsonRaw)} KB, gz6 ${kb(ref.jsonGz6)} KB`);
    console.log('(zysk względem odtworzonego "obecnego" JSON gz6 = jak serwer; progi: JSON >= 15%, binarny >= 25%; bin/json9 = zysk binarnego wobec JSON TEGO SAMEGO wariantu, oba gz9)');
    console.log(['wariant'.padEnd(42), pad('json raw', 9), pad('json gz6', 9), pad('zysk', 7), pad('json gz9', 9), pad('bin raw', 9), pad('bin gz9', 9), pad('zysk bin', 9), pad('bin/json9', 9), pad('błąd[m]', 8), 'próg'].join(' '));
    for (const r of res) {
      const gJson = gain(ref.jsonGz6, r.jsonGz6);
      const gBin = gain(ref.jsonGz6, r.binGz9);
      const pass = r === ref ? '' : [gJson >= GATE_JSON ? 'JSON:TAK' : 'JSON:nie', gBin >= GATE_BINARY ? 'BIN:TAK' : 'BIN:nie'].join(' ');
      console.log([r.label.padEnd(42), pad(kb(r.jsonRaw), 9), pad(kb(r.jsonGz6), 9), pad(pct(gJson), 7), pad(kb(r.jsonGz9), 9), pad(kb(r.binRaw), 9), pad(kb(r.binGz9), 9), pad(pct(gBin), 9), pad(pct(gain(r.jsonGz9, r.binGz9)), 9), pad(r.quantErrM.toFixed(2), 8), pass].join(' '));
    }
  }
}
