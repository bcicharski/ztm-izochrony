/**
 * Czyste funkcje prekompilacji GTFS wydzielone z tools/build-data.mjs.
 * Moduł nie czyta process.argv, nie dotyka systemu plików i niczego nie uruchamia
 * przy imporcie — dzięki temu da się go testować na danych syntetycznych
 * (tests/build-lib.test.mjs). Logika jest identyczna z dawną, wbudowaną w skrypt.
 */

import { holidayName, specialDayName, dateRegime, pickRepresentativeDate } from '../js/calendar.js';
import { distM, buildPatternEntries } from '../js/data.js';

export const WEEKDAY_COLS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// --- CSV i czas -------------------------------------------------------------

/** Parser linii CSV z obsługą cudzysłowów. */
export function splitCsv(line) {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Cały plik CSV (tekst) -> tablica obiektów {kolumna: wartość}; usuwa BOM. */
export function parseCsvText(text) {
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; // BOM
  const lines = body.split(/\r?\n/).filter(l => l.length);
  if (!lines.length) return [];
  const header = splitCsv(lines[0]);
  return lines.slice(1).map(l => {
    const cells = splitCsv(l);
    const row = {};
    header.forEach((h, i) => row[h.trim()] = cells[i] ?? '');
    return row;
  });
}

/** "28:16:30" -> sekundy od północy (może przekraczać 86400). */
export function timeToSec(t) {
  const [h, m, s] = t.split(':');
  return (+h) * 3600 + (+m) * 60 + (+s || 0);
}

/** "YYYYMMDD" -> dzień tygodnia (0 = nd, 6 = sob). */
export function dateToWeekday(yyyymmdd) {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// --- kalendarze -------------------------------------------------------------

/** Kolejne daty "YYYYMMDD" od min do max włącznie (twardy limit capDays). */
export function* datesBetween(min, max, capDays = 120) {
  const y = +min.slice(0, 4), m = +min.slice(4, 6) - 1, d = +min.slice(6, 8);
  const cur = new Date(Date.UTC(y, m, d));
  for (let i = 0; i < capDays; i++) {
    const s = cur.toISOString().slice(0, 10).replaceAll('-', '');
    if (s > max) return;
    yield s;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/**
 * Wpisuje usługi jednego feedu do `servicesByDate` (date -> Set("f:service_id")).
 * Pełna semantyka GTFS: calendar.txt (zakres + flagi dni tygodnia), potem wyjątki
 * z calendar_dates (1 = dodaje, 2 = usuwa). Zwraca zakres dat feedu {min, max}
 * ('99999999'/'00000000', gdy feed pusty).
 */
export function addFeedServices(servicesByDate, f, calendarRows, exceptionRows) {
  let min = '99999999', max = '00000000';
  const add = (date, sid) => {
    if (!servicesByDate.has(date)) servicesByDate.set(date, new Set());
    servicesByDate.get(date).add(`${f}:${sid}`);
    if (date < min) min = date;
    if (date > max) max = date;
  };
  const remove = (date, sid) => servicesByDate.get(date)?.delete(`${f}:${sid}`);

  for (const r of calendarRows) {
    if (!WEEKDAY_COLS.some(c => r[c] === '1')) continue; // np. SKM: same zera
    for (const date of datesBetween(r.start_date, r.end_date)) {
      if (r[WEEKDAY_COLS[dateToWeekday(date)]] === '1') add(date, r.service_id);
    }
  }
  for (const r of exceptionRows) {
    if (r.exception_type === '1') add(r.date, r.service_id);
    else if (r.exception_type === '2') remove(r.date, r.service_id);
  }
  return { min, max };
}

/** Zakres dat wspólny dla wszystkich feedów: {commonMin, commonMax}. */
export function commonDateRange(feedRanges) {
  return {
    commonMin: feedRanges.map(r => r.min).sort().at(-1),
    commonMax: feedRanges.map(r => r.max).sort()[0],
  };
}

/**
 * Daty kandydujące: ze wspólnego zakresu i od `today` (feedy z historią nie mogą
 * podsuwać starych rozkładów). Gdy nic nie zostaje — pełny wspólny zakres
 * (`fallback: true`). Wynik posortowany rosnąco.
 */
export function candidateDates(dates, commonMin, commonMax, today) {
  const all = [...dates];
  let out = all.filter(d => d >= commonMin && d <= commonMax && d >= today).sort();
  if (out.length) return { dates: out, fallback: false };
  out = all.filter(d => d >= commonMin && d <= commonMax).sort();
  return { dates: out, fallback: true };
}

/**
 * Typy dni (workday/saturday/sunday) z datą reprezentatywną + adnotacje dla
 * frontu (`dayInfo`: reżim, święto wybranej daty, święto, które ominęliśmy).
 * Typ bez żadnej pasującej daty jest pomijany.
 */
export function selectDayTypes(allDates, weekdayOf = dateToWeekday) {
  const pickDate = pred => pickRepresentativeDate(allDates, pred, weekdayOf);
  const dayTypes = [
    { key: 'workday', pred: w => w >= 2 && w <= 4, alt: w => w >= 1 && w <= 5 },
    { key: 'saturday', pred: w => w === 6 },
    { key: 'sunday', pred: w => w === 0 },
  ].map(t => ({ key: t.key, pred: t.pred, date: pickDate(t.pred) ?? (t.alt ? pickDate(t.alt) : null) }))
    .filter(d => d.date);
  const dayInfo = Object.fromEntries(dayTypes.map(d => {
    const first = allDates.find(x => d.pred(weekdayOf(x)));
    const avoided = first && first !== d.date ? (holidayName(first) ?? specialDayName(first)) : null;
    return [d.key, {
      date: d.date,
      weekday: weekdayOf(d.date),
      regime: dateRegime(d.date),
      holiday: holidayName(d.date) ?? specialDayName(d.date),
      ...(avoided ? { avoidedHoliday: avoided } : {}),
    }];
  }));
  return { dayTypes, dayInfo };
}

// --- przystanki -------------------------------------------------------------

/** "Wrzeszcz PKP 03" -> "Wrzeszcz PKP" (końcowy numer słupka). */
export function normalizeStopName(name) {
  return name.trim().replace(/ \d+$/, '');
}

/**
 * Zespoły przystankowe: ta sama nazwa + odległość ≤ maxM (klastrowanie
 * union-find w obrębie nazwy). Ustawia `stops[i].group`, zwraca liczbę zespołów.
 */
export function clusterStopGroups(stops, maxM = 300) {
  const byName = new Map();
  stops.forEach((s, i) => {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(i);
  });
  let groupCount = 0;
  for (const idxs of byName.values()) {
    const parent = idxs.map((_, k) => k);
    const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const sa = stops[idxs[a]], sb = stops[idxs[b]];
        if (distM(sa.lat, sa.lon, sb.lat, sb.lon) <= maxM) {
          parent[find(a)] = find(b);
        }
      }
    }
    const rootGroup = new Map();
    for (let k = 0; k < idxs.length; k++) {
      const root = find(k);
      if (!rootGroup.has(root)) rootGroup.set(root, groupCount++);
      stops[idxs[k]].group = rootGroup.get(root);
    }
  }
  return groupCount;
}

/**
 * Wiersz stop_times -> [stopSeq, stopIdx, depSec, arrSec, flags] albo null, gdy
 * przystanek nieznany. `cols` = indeksy kolumn (iDep, iStop, iSeq wymagane;
 * iArr/iPickup/iDrop mogą być -1). flags: bit0 = zakaz wsiadania
 * (pickup_type=1), bit1 = zakaz wysiadania (drop_off_type=1).
 */
export function parseStopTimeRow(c, cols, stopIdx, f) {
  const { iDep, iArr, iStop, iSeq, iPickup, iDrop } = cols;
  const sIdx = stopIdx.get(`${f}:${c[iStop]}`);
  if (sIdx === undefined) return null;
  const flags = ((iPickup >= 0 && c[iPickup] === '1') ? 1 : 0) |
                ((iDrop >= 0 && c[iDrop] === '1') ? 2 : 0);
  const depSec = timeToSec(c[iDep]);
  const arrSec = iArr >= 0 && c[iArr] ? timeToSec(c[iArr]) : depSec;
  return [+c[iSeq], sIdx, depSec, arrSec, flags];
}

/** Czy kurs ma ≥1 przystanek w prostokącie [minLat, minLon, maxLat, maxLon]. */
export function tripTouchesBbox(rows, stops, bb) {
  const [minLat, minLon, maxLat, maxLon] = bb;
  return rows.some(([, sIdx]) => {
    const s = stops[sIdx];
    return s.lat >= minLat && s.lat <= maxLat && s.lon >= minLon && s.lon <= maxLon;
  });
}

/**
 * Usuwa przystanki, których nie odwiedza żaden kurs z `tripStops`. Mutuje:
 * `stops` (zostają odwiedzane), indeksy w wierszach kursów i `stopIdx`
 * (usuwa klucze nieużywanych). Zwraca liczbę usuniętych przystanków.
 */
export function dropUnusedStops(stops, tripStops, stopIdx) {
  const used = new Uint8Array(stops.length);
  for (const arr of tripStops.values()) for (const row of arr) used[row[1]] = 1;
  const remap = new Int32Array(stops.length).fill(-1);
  const kept = [];
  for (let i = 0; i < stops.length; i++) if (used[i]) { remap[i] = kept.length; kept.push(stops[i]); }
  if (kept.length === stops.length) return 0;
  for (const arr of tripStops.values()) for (const row of arr) row[1] = remap[row[1]];
  for (const [key, idx] of stopIdx) { if (remap[idx] < 0) stopIdx.delete(key); else stopIdx.set(key, remap[idx]); }
  const removed = stops.length - kept.length;
  stops.length = 0;
  stops.push(...kept);
  return removed;
}

// --- wzorce tras ------------------------------------------------------------

/**
 * Wzorce jednego typu dnia. `tripStops`: tripKey -> [[seq, stopIdx, dep, arr, flags]]
 * (sortowane tu po seq, w miejscu), `tripMeta`: tripKey -> {routeKey, dayMask},
 * `frequencies`: tripKey -> [[start, end, headway]], `routeNameIndex`: routeKey -> indeks.
 * Zwraca {patterns, stats:{overtaking, extraEntries}}. Kursy z odjazdami
 * malejącymi albo z <2 przystankami są pomijane.
 */
export function buildDayPatterns({ tripStops, tripMeta, frequencies, routeNameIndex }, dayIdx) {
  const patterns = new Map();
  for (const [tripKey, arr] of tripStops) {
    const meta = tripMeta.get(tripKey);
    if (!(meta.dayMask & (1 << dayIdx))) continue;
    arr.sort((a, b) => a[0] - b[0]);
    const stopSeq = arr.map(x => x[1]);
    const flagSeq = arr.map(x => x[4]);
    const times = arr.map(x => x[2]); // odjazdy [s]
    const arrs = arr.map(x => x[3]);  // przyjazdy [s]
    let ok = true;
    for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) { ok = false; break; }
    if (!ok || times.length < 2) continue;
    const key = meta.routeKey + '|' + stopSeq.join(',') + '|' + flagSeq.join(',');
    let p = patterns.get(key);
    if (!p) {
      p = {
        route: routeNameIndex(meta.routeKey),
        stops: stopSeq,
        flags: flagSeq,
        profiles: new Map(),
        profileList: [],
        dwellList: [],
        trips: [],
      };
      patterns.set(key, p);
    }
    // delty odjazd-odjazd [s] + postoje [s] (dep−arr; skrajne przystanki = 0)
    const deltas = [];
    for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
    const dwell = times.map((dep, i) =>
      (i === 0 || i === times.length - 1) ? 0 : Math.max(0, dep - arrs[i]));
    const dKey = deltas.join(',') + ';' + dwell.join(',');
    let profIdx = p.profiles.get(dKey);
    if (profIdx === undefined) {
      profIdx = p.profileList.length;
      p.profiles.set(dKey, profIdx);
      p.profileList.push(deltas);
      p.dwellList.push(dwell);
    }
    const freq = frequencies.get(tripKey);
    if (freq) {
      // kurs częstotliwościowy: starty co headway w każdym oknie
      for (const [startSec, endSec, headway] of freq) {
        for (let s = startSec; s < endSec; s += headway) {
          p.trips.push([s, profIdx]);
        }
      }
    } else {
      p.trips.push([times[0], profIdx]);
    }
  }
  const out = [];
  let overtaking = 0, extraEntries = 0;
  for (const p of patterns.values()) {
    p.trips.sort((a, b) => a[0] - b[0]);
    // zwykle jeden wpis; przy wyprzedzaniu kursów — po jednym na łańcuch bez wyprzedzania
    const entries = buildPatternEntries(p);
    if (entries.length > 1) { overtaking++; extraEntries += entries.length - 1; }
    out.push(...entries);
  }
  return { patterns: out, stats: { overtaking, extraEntries } };
}

// --- przesiadki piesze i woda -----------------------------------------------

/**
 * Linie wody z water.json (współrzędne ×1e5) -> pierścienie z bboxem każdego.
 * Pierścienie krótsze niż 2 punkty są pomijane.
 */
export function parseWaterRings(raw) {
  const out = [];
  for (const ring of [...(raw.polys ?? []), ...(raw.lines ?? [])]) {
    if (ring.length < 2) continue;
    let latS = 90, latN = -90, lonW = 180, lonE = -180;
    const pts = ring.map(([la, lo]) => {
      const lat = la / 1e5, lon = lo / 1e5;
      if (lat < latS) latS = lat;
      if (lat > latN) latN = lat;
      if (lon < lonW) lonW = lon;
      if (lon > lonE) lonE = lon;
      return [lat, lon];
    });
    out.push({ pts, latS, latN, lonW, lonE });
  }
  return out;
}

/** Czy odcinki AB i CD się przecinają (test orientacji; stopnie wystarczą). */
export function segmentsCross(aLat, aLon, bLat, bLon, cLat, cLon, dLat, dLon) {
  const side = (pLat, pLon, qLat, qLon, rLat, rLon) =>
    Math.sign((qLon - pLon) * (rLat - pLat) - (qLat - pLat) * (rLon - pLon));
  return side(aLat, aLon, bLat, bLon, cLat, cLon) !== side(aLat, aLon, bLat, bLon, dLat, dLon)
    && side(cLat, cLon, dLat, dLon, aLat, aLon) !== side(cLat, cLon, dLat, dLon, bLat, bLon);
}

/** Czy linia prosta między dwoma punktami przecina jakąkolwiek linię wody. */
export function crossesWater(rings, aLat, aLon, bLat, bLon) {
  const latMin = Math.min(aLat, bLat), latMax = Math.max(aLat, bLat);
  const lonMin = Math.min(aLon, bLon), lonMax = Math.max(aLon, bLon);
  for (const r of rings) {
    if (latMin > r.latN || latMax < r.latS || lonMin > r.lonE || lonMax < r.lonW) continue;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const [pLat, pLon] = r.pts[k], [qLat, qLon] = r.pts[k + 1];
      if (segmentsCross(aLat, aLon, bLat, bLon, pLat, pLon, qLat, qLon)) return true;
    }
  }
  return false;
}

/**
 * Kandydaci na przesiadkę pieszą po linii prostej (≤ maxM): Map i ->
 * [[j, sekundy, metry], ...], gdzie i poprzedza j w kolejności szerokości
 * geograficznej. Sekundy = round(metry / walkMps).
 */
export function transferCandidates(stops, maxM, walkMps, metersPerDegLat) {
  const idx = stops.map((_, i) => i).sort((a, b) => stops[a].lat - stops[b].lat);
  const maxDLat = maxM / metersPerDegLat;
  const cand = new Map();
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a];
    const si = stops[i];
    for (let b = a + 1; b < idx.length; b++) {
      const j = idx[b];
      const sj = stops[j];
      if (sj.lat - si.lat > maxDLat) break;
      const dist = distM(si.lat, si.lon, sj.lat, sj.lon);
      if (dist <= maxM) {
        if (!cand.has(i)) cand.set(i, []);
        cand.get(i).push([j, Math.round(dist / walkMps), dist]);
      }
    }
  }
  return cand;
}

/**
 * Pokrycie siatki pieszej: przystanki (lat/lon ×1e5) poza `bbox` =
 * [S, W, N, E] — znany tryb degradacji (router nie ma dla nich dojść pieszych).
 */
export function gridCoverage(stopsOut, bbox, metersPerDegLat) {
  const [gS, gW, gN, gE] = bbox;
  const cosLat = Math.cos(((gS + gN) / 2) * Math.PI / 180);
  let outsideStops = 0, maxOutsideM = 0;
  for (let i = 0; i < stopsOut.lat.length; i++) {
    const lat = stopsOut.lat[i] / 1e5, lon = stopsOut.lon[i] / 1e5;
    const dLatM = Math.max(gS - lat, lat - gN, 0) * metersPerDegLat;
    const dLonM = Math.max(gW - lon, lon - gE, 0) * metersPerDegLat * cosLat;
    if (dLatM === 0 && dLonM === 0) continue;
    outsideStops++;
    maxOutsideM = Math.max(maxOutsideM, Math.hypot(dLatM, dLonM));
  }
  return { outsideStops, maxOutsideM };
}

/**
 * Pola meta.json, których build-data.mjs sam nie wylicza, a które dopisują inne
 * skrypty (dziś: `delays` z build-delays.mjs). Przy przebudowie meta.json od zera
 * trzeba je przenieść z poprzedniej wersji, inaczej znikają po każdym odświeżeniu.
 * `delays` przenosimy tylko, gdy nadal istnieje delays.json — pole opisuje jego
 * pokrycie, więc bez pliku byłoby nieprawdą (np. wypadł feed GTFS-RT).
 * @param {object|null} prevMeta  poprzedni meta.json (null = brak / nieczytelny)
 * @param {{delaysFileExists: boolean}} opts
 * @returns {object}  pola do dołączenia do nowego meta.json
 */
export function carryOverMeta(prevMeta, { delaysFileExists }) {
  const carried = {};
  if (prevMeta && typeof prevMeta === 'object' && prevMeta.delays && delaysFileExists) {
    carried.delays = prevMeta.delays;
  }
  return carried;
}

/**
 * Ładunki plików dnia (Z-080). `routeList` jest uzupełniana leniwie przez
 * `buildDay` (indeks linii przydzielany przy pierwszym użyciu), więc wszystkie
 * dni muszą zostać zbudowane ZANIM któryś ładunek dostanie listę — inaczej
 * każdy plik niesie stan listy z chwili własnego zapisu i różni się od
 * `meta.counts.routes`. Indeksy są tylko dopisywane, więc wzorce zbudowane
 * wcześniej zostają poprawne wobec pełnej listy. Zwraca [{payload, patterns}].
 */
export function assembleDayPayloads({ dayTypes, buildDay, routeList, stopsOut, transfers, version }) {
  const built = dayTypes.map((_, d) => buildDay(d));
  return dayTypes.map((dt, d) => ({
    patterns: built[d],
    payload: { version, day: dt.key, date: dt.date, routes: routeList, stops: stopsOut, transfers, patterns: built[d] },
  }));
}
