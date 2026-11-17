#!/usr/bin/env node
/**
 * Kontrola stanu danych po odświeżeniu. Dwie warstwy:
 *  1. stan: dla każdego miasta z data/cities.json sprawdza meta.json (istnieje?
 *     komplet dni? termin ważności rozkładu nie minął i nie mija w ciągu
 *     WARN_DAYS?);
 *  2. bramka regresji: porównuje świeże meta.json (pola `counts`, `grid`,
 *     zapisywane przez build-data.mjs) z meta.json z HEAD. Miasto z podejrzanym
 *     spadkiem jest do cofnięcia przed commitem (robi to workflow, tu tylko
 *     decyzja), reszta publikuje się normalnie.
 *
 * Wynik w Markdown na stdout (do treści zgłoszenia na GitHubie); kod wyjścia
 * 1, gdy jest cokolwiek do zgłoszenia.
 *
 * Użycie: node tools/check-data.mjs [--skipped a,b] [--force a,b|all]
 *                                   [--baseline-dir <kat>] [--gate-out gate.json]
 *   --skipped       miasta pominięte przez workflow (błąd feedu/budowy) — trafiają
 *                   do raportu niezależnie od stanu ich (starych) plików.
 *   --force         miasta, dla których spadek jest świadomie przepuszczany
 *                   (BLOKADA -> OSTRZEŻENIE); `all` = wszystkie.
 *   --baseline-dir  katalog z plikami <miasto>.json (punkt odniesienia) zamiast
 *                   `git show HEAD:data/<miasto>/meta.json` — szew testowy.
 *   --gate-out      plik JSON { blocked, warned, ok, noBaseline } dla workflow.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WARN_DAYS = 7;

/**
 * Progi bramki. Każdy próg relatywny (`*Pct`) działa tylko razem z podłogą
 * bezwzględną (`*Min`) — mała liczba w mianowniku nie może wywołać alarmu.
 * Brak `blockPct` = ta metryka nigdy nie blokuje.
 */
export const GATE = {
  trips:     { warnPct: 0.10, warnMin: 20,    blockPct: 0.30, blockMin: 200 }, // per typ dnia
  patterns:  { warnPct: 0.10, warnMin: 5,     blockPct: 0.30, blockMin: 50 },  // per typ dnia
  stops:     { warnPct: 0.05, warnMin: 5,     blockPct: 0.20, blockMin: 50 },
  routes:    { warnPct: 0.05, warnMin: 2,     blockPct: 0.20, blockMin: 5 },
  transfers: { warnPct: 0.15, warnMin: 50 },
  bytes:     { warnPct: 0.15, warnMin: 20000, blockPct: 0.40, blockMin: 0 },   // per typ dnia
  growthWarnPct: 1.5,           // wzrost o ≥150% -> tylko ostrzeżenie
  // Przystanki poza siatką pieszą (grid.outsideShare). Skalibrowane 2026-11-16 na
  // danych z data/ (meta.json nie miało jeszcze pola grid, więc udział wyliczono
  // z workday.json + gridBbox tą samą gridCoverage co build): 7 z 18 miast stale
  // ma >2% — Warszawa 8,94%, Kraków 5,88%, Trójmiasto 5,52%, Toruń 5,02%,
  // Poznań 3,16%, Bydgoszcz 2,79%, Kielce 2,59% (linie podmiejskie wychodzą poza
  // siatkę; to stan stały, nie awaria), pozostałe 0–1%. Dawny próg bezwzględny 2%
  // zapalałby się więc co odświeżenie dla 39% miast. Właściwy sygnał to WZROST
  // względem poprzedniego buildu; pułap bezwzględny zostaje tylko jako zabezpieczenie
  // dla miasta bez baseline (np. pomyłka w gridBbox nowego miasta).
  outsideShareWarn: 0.25,       // pułap awaryjny: najwyższy dziś 8,94% (Warszawa), zapas ~2,8x
  outsideShareRiseWarn: 0.005,  // wzrost o ≥0,5 pp wobec poprzedniego buildu...
  outsideRiseMinStops: 5,       // ...ale tylko gdy przybyło ≥5 przystanków (0,5 pp to 2 przystanki w Gorzowie, 433 szt.)
  valveDays: WARN_DAYS,         // zawór: stary rozkład wygasa w ≤ tylu dniach
  delaysParseMaxBytes: 256,     // delays.json do tylu bajtów parsujemy (odróżnienie `{}`); większy = są profile
};

const DAYS = ['workday', 'saturday', 'sunday'];
const DAY_PL = { workday: 'dzień roboczy', saturday: 'sobota', sunday: 'niedziela' };
const METRIC_PL = { trips: 'kursy', patterns: 'wzorce', stops: 'przystanki', routes: 'linie', transfers: 'przesiadki', bytes: 'rozmiar (B)' };

const ymd = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const fmt = d => (d ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : '—');
const pct = x => `${Math.round(x * 1000) / 10}%`;
const num = n => String(n);

/**
 * Czy `delays.json` zawiera profile opóźnień. Tanio: puste pliki (`{}`) są małe,
 * więc tylko plik ≤ GATE.delaysParseMaxBytes jest parsowany; większy zawiera
 * profile na pewno, bez wczytywania go do pamięci. Brak/uszkodzony plik = false.
 */
export function hasDelayProfiles(file) {
  try {
    const size = fs.statSync(file).size;
    if (size > GATE.delaysParseMaxBytes) return true;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Boolean(data) && typeof data === 'object' && Object.keys(data).length > 0;
  } catch { return false; }
}

/**
 * Decyzja bramki dla jednego miasta.
 * @param {string} key  klucz miasta
 * @param {object} cfg  wpis z cities.json (obecnie nieużywany, zostawiony na progi per miasto)
 * @param {object|null} fresh     świeże meta.json
 * @param {object|null} baseline  meta.json z HEAD (null = brak odniesienia)
 * @param {{today?: Date, force?: boolean, delaysProfiles?: boolean}} opts  delaysProfiles: `delays.json` ma profile (stan bieżący, niezależny od baseline)
 * @returns {{level: 'ok'|'warn'|'block', findings: string[], emergency: boolean, noBaseline: boolean, rows: object[]}}
 */
export function gateCity(key, cfg, fresh, baseline, { today = new Date(), force = false, delaysProfiles = false } = {}) {
  const res = { level: 'ok', findings: [], emergency: false, noBaseline: false, rows: [] };
  // stan bieżący (bez baseline): profile opóźnień są, ale meta.json zgubiło pole `delays`
  // (np. po samodzielnej przebudowie miasta) — front milczałby mimo posiadanych danych; nigdy blokada
  const delaysNote = fresh && delaysProfiles && !fresh.delays
    ? `${key}: są profile opóźnień (delays.json), ale w meta.json zniknęły metadane pokrycia (pole delays) — front nie pokaże informacji o opóźnieniach; napraw ponownym uruchomieniem tools/build-delays.mjs`
    : null;
  // brak odniesienia albo brak metryk po którejś stronie (stary format) = przejście
  if (!fresh?.counts || !baseline?.counts) {
    res.noBaseline = true;
    if (delaysNote) { res.findings.push(`OSTRZEŻENIE: ${delaysNote}`); res.level = 'warn'; }
    return res;
  }

  const found = []; // { sev: 'block'|'warn', hard: bool, text }
  const bc = baseline.counts, fc = fresh.counts;
  const add = (sev, text, hard = false) => found.push({ sev, hard, text });
  if (delaysNote) add('warn', delaysNote);

  const compare = (label, rule, was, now) => {
    res.rows.push({ label, was, now });
    if (!(was > 0) || !Number.isFinite(now)) return;
    const diff = was - now, drop = diff / was;
    const txt = `${label}: ${num(was)} → ${num(now)} (${drop > 0 ? '−' : '+'}${pct(Math.abs(drop))})`;
    if (rule.blockPct && drop >= rule.blockPct && diff >= rule.blockMin) add('block', `spadek: ${txt}`);
    else if (drop >= rule.warnPct && diff >= rule.warnMin) add('warn', `spadek: ${txt}`);
    else if (-drop >= GATE.growthWarnPct && -diff >= rule.warnMin) add('warn', `nagły wzrost: ${txt}`);
  };

  compare(METRIC_PL.stops, GATE.stops, bc.stops, fc.stops);
  compare(METRIC_PL.routes, GATE.routes, bc.routes, fc.routes);
  compare(METRIC_PL.transfers, GATE.transfers, bc.transfers, fc.transfers);

  for (const day of DAYS) {
    const b = bc.days?.[day], f = fc.days?.[day];
    if (!b) continue;
    if (!f) { add('block', `znikł typ dnia: ${DAY_PL[day]} (był w poprzednich danych)`, true); continue; }
    for (const m of ['trips', 'patterns', 'bytes']) {
      compare(`${DAY_PL[day]} — ${METRIC_PL[m]}`, GATE[m], b[m], f[m]);
    }
    // Wyprzedzanie kursów: build rozbija takie wzorce sam, więc to informacja, nigdy
    // blokada. Ostrzegamy tylko, gdy liczba urosła — stała wartość to cecha feedu,
    // nie zdarzenie (Z-052: Łódź zapalała ostrzeżenie co tydzień przy niezmienionym 1).
    // Brak pola po którejkolwiek stronie (stare meta.json) = pominięcie.
    if (f.overtaking > 0 && b.overtaking != null && f.overtaking > b.overtaking) {
      add('warn', `${DAY_PL[day]}: ${f.overtaking} wzorców z wyprzedzaniem kursów (było ${b.overtaking}) — rozbito je automatycznie, wyniki są poprawne`);
    }
  }
  for (const day of DAYS) {
    if (fc.days?.[day] && fc.days[day].trips === 0) add('block', `${DAY_PL[day]}: 0 kursów`, true);
  }

  const share = fresh.grid?.outsideShare;
  if (typeof share === 'number') {
    const was = baseline.grid?.outsideShare;
    const rise = typeof was === 'number' ? share - was : 0;
    const wasStops = baseline.grid?.outsideStops, nowStops = fresh.grid.outsideStops;
    // brak liczności po którejś stronie = decyduje sam próg względny
    const stopsRise = typeof wasStops === 'number' && typeof nowStops === 'number' ? nowStops - wasStops : Infinity;
    if (share > GATE.outsideShareWarn || (rise >= GATE.outsideShareRiseWarn && stopsRise >= GATE.outsideRiseMinStops)) {
      const from = typeof was === 'number' ? ` (było ${pct(was)})` : '';
      add('warn', `przystanki poza siatką pieszą: ${pct(share)}${from}, najdalszy ${fresh.grid.maxOutsideKm ?? '?'} km od siatki`);
    }
  }

  // zawór: gdy opublikowany rozkład i tak wygasa, blokada nikomu nie pomaga
  const endKey = baseline.feedEndDate;
  const valveKey = ymd(new Date(today.getTime() + GATE.valveDays * 86400e3));
  // zawór nie obowiązuje, gdy w tym samym przebiegu jest twarda blokada (0 kursów, znikły typ dnia)
  const valve = Boolean(endKey) && endKey <= valveKey && !found.some(f => f.hard);

  for (const f of found) {
    if (f.sev === 'warn') { res.findings.push(`OSTRZEŻENIE: ${f.text}`); continue; }
    if (force) res.findings.push(`OSTRZEŻENIE: ${f.text} — przepuszczone (force)`);
    else if (valve && !f.hard) {
      res.emergency = true;
      res.findings.push(`OSTRZEŻENIE: ${f.text} — PRZEPUSZCZONE AWARYJNIE (stary rozkład wygasa)`);
    } else { res.level = 'block'; res.findings.push(`BLOKADA: ${f.text}`); }
  }
  if (res.level !== 'block' && res.findings.length) res.level = 'warn';
  return res;
}

function readBaseline(key, { root, baselineDir }) {
  try {
    if (baselineDir) return JSON.parse(fs.readFileSync(path.join(baselineDir, `${key}.json`), 'utf8'));
    const out = execFileSync('git', ['show', `HEAD:data/${key}/meta.json`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(out.toString('utf8'));
  } catch { return null; }
}

const listArg = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? '').split(',').filter(Boolean) : [];
};
const strArg = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** Cała kontrola; zwraca { code, out, gate } zamiast kończyć proces (testy). */
export function run(argv, { root = path.join(import.meta.dirname, '..'), today = new Date() } = {}) {
  const cities = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cities.json'), 'utf8'));
  const skipped = new Set(listArg(argv, '--skipped'));
  const forceList = listArg(argv, '--force');
  const forceAll = forceList.includes('all');
  const baselineDir = strArg(argv, '--baseline-dir');
  const todayKey = ymd(today);
  const warnKey = ymd(new Date(today.getTime() + WARN_DAYS * 86400e3));

  const problems = [];
  const gate = { blocked: [], warned: [], ok: [], noBaseline: [] };
  const gated = [];
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

    const baseline = readBaseline(key, { root, baselineDir });
    const delaysProfiles = hasDelayProfiles(path.join(root, 'data', key, 'delays.json'));
    const g = gateCity(key, cfg, meta, baseline, { today, force: forceAll || forceList.includes(key), delaysProfiles });
    if (g.noBaseline && g.level === 'ok') gate.noBaseline.push(key);
    else if (g.level === 'warn' && g.noBaseline) gate.warned.push(key);
    else if (g.level === 'block') gate.blocked.push(key);
    else if (g.level === 'warn') gate.warned.push(key);
    else gate.ok.push(key);
    if (g.level !== 'ok') gated.push({ key, name: cfg.name, g, baseline, meta });

    if (issues.length || g.level !== 'ok') problems.push({ key, name: cfg.name, issues, gate: g, meta });
  }

  const total = Object.keys(cities).length;
  const lines = [];
  if (!problems.length) {
    lines.push(`Wszystkie ${total} miasta w porządku (rozkłady ważne dłużej niż ${WARN_DAYS} dni, komplet dni).`);
    return { code: 0, out: lines.join('\n') + '\n', gate };
  }
  lines.push(`## Stan danych rozkładowych — ${fmt(todayKey)}\n`);
  lines.push(`Problemy w ${problems.length} z ${total} miast:\n`);
  for (const p of problems) {
    lines.push(`- **${p.name}** (\`${p.key}\`)${p.meta?.generated ? ` — build ${p.meta.generated.slice(0, 10)}` : ''}`);
    for (const i of p.issues) lines.push(`  - ${i}`);
    for (const i of p.gate.findings) lines.push(`  - ${i}`);
  }
  if (gate.blocked.length) {
    lines.push(`\n**Cofnięte przed publikacją (bramka jakości): ${gate.blocked.join(', ')}** — na stronie zostają poprzednie dane.`);
  }
  for (const { key, name, g, baseline, meta } of gated) {
    if (g.noBaseline) continue; // ostrzeżenie bez porównania z baseline — sama treść jest na liście wyżej
    const label = g.level === 'block' ? 'BLOKADA' : g.emergency ? 'PRZEPUSZCZONE AWARYJNIE' : 'OSTRZEŻENIE';
    lines.push(`\n### ${name} (\`${key}\`) — ${label}\n`);
    lines.push(`Poprzednie dane z ${fmt((baseline.generated ?? '').slice(0, 10).replaceAll('-', ''))}, nowe z ${fmt((meta.generated ?? '').slice(0, 10).replaceAll('-', ''))}.\n`);
    lines.push('| Metryka | Było | Jest |', '|---|---|---|');
    for (const r of g.rows) lines.push(`| ${r.label} | ${r.was ?? '—'} | ${r.now ?? '—'} |`);
    if (meta.grid) lines.push(`| przystanki poza siatką | ${baseline.grid?.outsideStops ?? '—'} | ${meta.grid.outsideStops} |`);
    if (g.level === 'block') {
      lines.push(`\nAby przepuścić te dane mimo spadku: Actions → Odśwież dane rozkładowe → Run workflow → pole \`force\`: \`${key}\` (albo \`all\`). Po tym przebiegu punkt odniesienia przesuwa się na nowe dane.`);
    }
  }
  lines.push('\nRaport z `tools/check-data.mjs` (workflow `refresh-data.yml`).');
  return { code: 1, out: lines.join('\n') + '\n', gate };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const { code, out, gate } = run(argv);
  process.stdout.write(out);
  const gateOut = strArg(argv, '--gate-out');
  if (gateOut) fs.writeFileSync(gateOut, JSON.stringify(gate, null, 2));
  process.exit(code);
}
