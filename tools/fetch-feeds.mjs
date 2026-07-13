#!/usr/bin/env node
/**
 * Pobiera i rozpakowuje wszystkie feedy GTFS miasta do <katalog>/<nazwa-feedu>/.
 * Obsługuje feedy o stałym URL oraz zbiór z API Wrocławia (resolve: "wroclaw-od2",
 * gdzie URL wskazuje dataset, a właściwy plik trzeba znaleźć przez od2-files).
 *
 * Użycie: node tools/fetch-feeds.mjs <miasto> <katalog-roboczy>
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const cityKey = process.argv[2];
const workDir = process.argv[3];
const cities = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'cities.json'), 'utf8'));
if (!cities[cityKey] || !workDir) {
  console.error('Użycie: node tools/fetch-feeds.mjs <miasto> <katalog-roboczy>');
  process.exit(1);
}

const UA = { 'User-Agent': 'ztm-izochrony-build/1.0' };

async function resolveUrl(feed) {
  if (feed.resolve === 'ckan-latest') {
    // feed.url = endpoint package_show CKAN; bierzemy najnowszy zasób ZIP
    const pkg = await (await fetch(feed.url, { headers: UA })).json();
    const zips = (pkg.result.resources ?? []).filter(r => (r.format ?? '').toUpperCase() === 'ZIP');
    zips.sort((a, b) => (b.last_modified ?? b.created ?? '').localeCompare(a.last_modified ?? a.created ?? ''));
    if (!zips.length) throw new Error(`${feed.name}: brak zasobów ZIP w zbiorze CKAN`);
    console.log(`  CKAN: najnowszy zasób ${zips[0].name ?? zips[0].url.split('/').pop()}`);
    return zips[0].url;
  }
  if (feed.resolve === 'wroclaw-od2') {
    // dataset -> lista id plików -> metadane najnowszego pliku -> download_url
    const ds = await (await fetch(feed.url, { headers: UA })).json();
    const newest = Math.max(...ds.pliki);
    const file = await (await fetch(`https://api.open-data.cui.wroclaw.pl/od2-files/${newest}/`, { headers: UA })).json();
    console.log(`  Wrocław: plik ${file.nazwa_pliku_bez_rozszerzenia} (id ${newest})`);
    return file.download_url;
  }
  return feed.url;
}

/** Pobiera plik z timeoutem, ponawia i sprawdza, że to faktycznie ZIP. */
async function downloadZip(url, headers, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // serwery miejskie potrafią oddać stronę błędu z kodem 200 — waliduj nagłówek ZIP (PK\x03\x04)
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
        throw new Error(`odpowiedź nie jest plikiem ZIP (${buf.length} B)`);
      }
      return buf;
    } catch (err) {
      if (attempt >= tries) throw err;
      const waitS = attempt * 15;
      console.log(`  pobieranie nieudane (${err.message}) — ponawiam za ${waitS} s (${attempt}/${tries})…`);
      await new Promise(r => setTimeout(r, waitS * 1000));
    }
  }
}

for (const feed of cities[cityKey].feeds) {
  const dir = path.join(workDir, feed.name);
  fs.mkdirSync(dir, { recursive: true });
  const url = await resolveUrl(feed);
  console.log(`Pobieram ${feed.name}: ${url}`);
  const headers = feed.accept ? { ...UA, Accept: feed.accept } : UA;
  const buf = await downloadZip(url, headers);
  const zipPath = path.join(workDir, `${feed.name}.zip`);
  fs.writeFileSync(zipPath, buf);
  // Windows: systemowy bsdtar rozpakowuje zip (GNU tar z Git Basha
  // potraktowałby "C:\..." jako host zdalny); Linux/Actions: unzip
  if (process.platform === 'win32') {
    const bsdtar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(bsdtar, ['-xf', zipPath, '-C', dir]);
  } else {
    execFileSync('unzip', ['-oq', zipPath, '-d', dir]);
  }
  console.log(`  -> ${dir} (${(fs.statSync(zipPath).size / 1e6).toFixed(1)} MB)`);
}
console.log('Feedy gotowe.');
