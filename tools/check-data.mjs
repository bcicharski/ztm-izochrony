#!/usr/bin/env node
/**
 * Kontrola stanu danych po odświeżeniu: dla każdego miasta z data/cities.json
 * sprawdza meta.json (istnieje? komplet dni? termin ważności rozkładu nie
 * minął i nie mija w ciągu WARN_DAYS?). Wynik w Markdown na stdout (do treści
 * zgłoszenia na GitHubie); kod wyjścia 1, gdy jest cokolwiek do zgłoszenia.
 *
 * Użycie: node tools/check-data.mjs [--skipped miasto1,miasto2]
 *   --skipped: miasta pominięte przez workflow (błąd feedu/budowy) — trafiają
 *   do raportu niezależnie od stanu ich (starych) plików.
 */

import fs from 'node:fs';
import path from 'node:path';

const WARN_DAYS = 7;
const root = path.join(import.meta.dirname, '..');
const cities = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cities.json'), 'utf8'));
const skippedArg = process.argv.indexOf('--skipped');
const skipped = new Set(skippedArg >= 0 ? (process.argv[skippedArg + 1] ?? '').split(',').filter(Boolean) : []);

const today = new Date();
const ymd = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const todayKey = ymd(today);
const warnKey = ymd(new Date(today.getTime() + WARN_DAYS * 86400e3));
const fmt = d => (d ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : '—');

const problems = [];
for (const [key, cfg] of Object.entries(cities)) {
  const file = path.join(root, 'data', key, 'meta.json');
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* brak pliku */ }
  const issues = [];
  if (skipped.has(key)) issues.push('pominięte przez workflow (błąd pobierania feedu albo budowy) — zostały poprzednie dane');
  if (!meta) {
    issues.push('brak meta.json');
  } else {
    const missing = ['workday', 'saturday', 'sunday'].filter(d => !meta.dates?.[d]);
    if (missing.length) issues.push(`brak typów dnia: ${missing.join(', ')}`);
    if (!meta.feedEndDate) issues.push('brak feedEndDate');
    else if (meta.feedEndDate < todayKey) issues.push(`rozkład NIEAKTUALNY (ważny do ${fmt(meta.feedEndDate)})`);
    else if (meta.feedEndDate < warnKey) issues.push(`rozkład kończy się za mniej niż ${WARN_DAYS} dni (${fmt(meta.feedEndDate)})`);
  }
  if (issues.length) problems.push({ key, name: cfg.name, issues, meta });
}

if (!problems.length) {
  console.log(`Wszystkie ${Object.keys(cities).length} miasta w porządku (rozkłady ważne dłużej niż ${WARN_DAYS} dni, komplet dni).`);
  process.exit(0);
}
console.log(`## Stan danych rozkładowych — ${fmt(todayKey)}\n`);
console.log(`Problemy w ${problems.length} z ${Object.keys(cities).length} miast:\n`);
for (const p of problems) {
  console.log(`- **${p.name}** (\`${p.key}\`)${p.meta?.generated ? ` — build ${p.meta.generated.slice(0, 10)}` : ''}`);
  for (const i of p.issues) console.log(`  - ${i}`);
}
console.log('\nRaport z `tools/check-data.mjs` (workflow `refresh-data.yml`).');
process.exit(1);
