#!/usr/bin/env node
/**
 * Przekodowuje data/<miasto>/walknet.json na format v2 (długość krawędzi jako
 * reszta względem cięciwy; Z-003). Bezstratnie: graf po dekodowaniu jest ten sam.
 *
 * Użycie:
 *   node tools/reencode-walknet.mjs <miasto|all> [--write]
 *
 * DOMYŚLNIE to próba na sucho: wczytuje plik, koduje w pamięci, sprawdza obieg
 * zamknięty (dekoder daje graf dosłownie identyczny) i drukuje rozmiary. Nic nie
 * trafia na dysk. Z `--write` plik jest podmieniany — przez plik tymczasowy
 * w tym samym katalogu (rename jest wtedy atomowy), po odczytaniu go z powrotem
 * i ponownej weryfikacji grafu. Plik już w v2 jest pomijany.
 * Bramę jakości trasowania uruchamia tools/walknet-ab.mjs — przed `--write`.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodeWalkNet } from '../js/walknet.js';
import { encodeWalkNet, graphFromNet, netDifference } from './walknet-codec.mjs';

const DATA = path.join(import.meta.dirname, '..', 'data');

const gz6 = buf => zlib.gzipSync(buf, { level: 6 }).length;

/**
 * Przekodowuje jeden plik. Zwraca statystyki; przy błędzie weryfikacji rzuca.
 * @param {string} file ścieżka walknet.json
 * @param {{write?: boolean}} [opts]
 */
export function reencodeFile(file, { write = false } = {}) {
  const oldBuf = fs.readFileSync(file);
  const raw = JSON.parse(oldBuf.toString('utf8'));
  const net = decodeWalkNet(raw);
  const isV2 = !!raw.edges.res;
  const out = encodeWalkNet(graphFromNet(net, raw.quant || 1e5), { version: 2 });
  const newBuf = Buffer.from(JSON.stringify(out));

  // obieg zamknięty z tekstu, tak jak zobaczy go przeglądarka
  const diff = netDifference(net, decodeWalkNet(JSON.parse(newBuf.toString('utf8'))));
  if (diff) throw new Error(`${file}: przekodowanie nie jest bezstratne (${diff})`);

  const stats = {
    file, skipped: isV2, written: false,
    oldRaw: oldBuf.length, oldGz: gz6(oldBuf), newRaw: newBuf.length, newGz: gz6(newBuf),
  };
  if (!write || isV2) return stats;

  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  try {
    fs.writeFileSync(tmp, newBuf);
    const back = decodeWalkNet(JSON.parse(fs.readFileSync(tmp, 'utf8')));
    const d = netDifference(net, back);
    if (d) throw new Error(`${file}: weryfikacja odczytu nie przeszła (${d})`);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  stats.written = true;
  return stats;
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const target = args.find(a => !a.startsWith('--'));
  const cities = JSON.parse(fs.readFileSync(path.join(DATA, 'cities.json'), 'utf8'));
  const keys = target === 'all' ? Object.keys(cities) : [target];
  if (!target || !keys.every(k => cities[k])) {
    console.error(`Użycie: reencode-walknet.mjs <miasto|all> [--write]. Miasta: ${Object.keys(cities).join(', ')}`);
    process.exit(1);
  }
  console.log(write ? 'TRYB ZAPISU (--write)' : 'próba na sucho — nic nie jest zapisywane (zapis: --write)');
  const kb = n => (n / 1024).toFixed(1);
  let failed = false;
  for (const key of keys) {
    const file = path.join(DATA, key, 'walknet.json');
    if (!fs.existsSync(file)) { console.log(`${key}: brak walknet.json — pomijam`); continue; }
    try {
      const s = reencodeFile(file, { write });
      const gain = ((s.oldGz - s.newGz) / s.oldGz * 100).toFixed(1);
      console.log(`${key.padEnd(12)} ${s.skipped ? 'już v2   ' : (s.written ? 'ZAPISANO ' : 'na sucho ')}` +
        `raw ${kb(s.oldRaw)} -> ${kb(s.newRaw)} KB, gzip-6 ${kb(s.oldGz)} -> ${kb(s.newGz)} KB (${gain}% mniej)`);
    } catch (err) {
      failed = true;
      console.error(`${key}: BŁĄD ${err.message}`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main();
