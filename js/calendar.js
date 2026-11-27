/**
 * Kalendarz polski: święta ustawowo wolne, reżim rozkładu (rok szkolny /
 * wakacje / przerwa świąteczna) i dobór daty reprezentatywnej dla typu dnia.
 * Czysty moduł bez zależności i bez dostępu do DOM — działa w przeglądarce
 * i w Node (build danych, testy). Daty to napisy 'YYYYMMDD', jak w GTFS.
 */

const pad = n => String(n).padStart(2, '0');
const toYmd = dt => `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
const fromYmd = ymd => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
const addDays = (ymd, n) => { const d = fromYmd(ymd); d.setUTCDate(d.getUTCDate() + n); return toYmd(d); };

/** Niedziela Wielkanocna (algorytm Meeusa/Jonesa/Butchera, kalendarz gregoriański). */
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}${pad(month)}${pad(day)}`;
}

const FIXED_HOLIDAYS = {
  '0101': 'Nowy Rok',
  '0106': 'Trzech Króli',
  '0501': 'Święto Pracy',
  '0503': 'Święto Konstytucji 3 Maja',
  '0815': 'Wniebowzięcie NMP',
  '1101': 'Wszystkich Świętych',
  '1111': '11 listopada',
  '1225': 'Boże Narodzenie',
  '1226': 'Drugi dzień Bożego Narodzenia',
};

/** Nazwa święta ustawowo wolnego od pracy albo null (14 dni w roku). */
export function holidayName(ymd) {
  const fixed = FIXED_HOLIDAYS[ymd.slice(4)];
  if (fixed) return fixed;
  // Wigilia: dzień ustawowo wolny dopiero od 2025 r. (Dz.U. 2024 poz. 1965)
  if (ymd.slice(4) === '1224' && +ymd.slice(0, 4) >= 2025) return 'Wigilia';
  const easter = easterSunday(+ymd.slice(0, 4));
  if (ymd === easter) return 'Wielkanoc';
  if (ymd === addDays(easter, 1)) return 'Poniedziałek Wielkanocny';
  if (ymd === addDays(easter, 49)) return 'Zielone Świątki';
  if (ymd === addDays(easter, 60)) return 'Boże Ciało';
  return null;
}

/** Dzień pracujący, ale z rozkładem zmienionym (Sylwester) albo null. */
export function specialDayName(ymd) {
  return ymd.slice(4) === '1231' ? 'Sylwester' : null;
}

/**
 * Reżim rozkładu: 'summer' (01.07–31.08), 'holiday-season' (22.12–06.01
 * oraz Wielkanoc−4 … Wielkanoc+1), inaczej 'school'. Bez ferii wojewódzkich —
 * są zmienne, a feed ich nie rozróżnia.
 */
export function dateRegime(ymd) {
  const md = ymd.slice(4);
  if (md >= '0701' && md <= '0831') return 'summer';
  if (md >= '1222' || md <= '0106') return 'holiday-season';
  const easter = easterSunday(+ymd.slice(0, 4));
  if (ymd >= addDays(easter, -4) && ymd <= addDays(easter, 1)) return 'holiday-season';
  return 'school';
}

/**
 * Najwcześniejsza data o pasującym dniu tygodnia, z pominięciem świąt i dni
 * specjalnych; gdy takich nie ma — najwcześniejsza w ogóle. Nigdy nie rzuca.
 * `dates` posortowane rosnąco, `weekdayOf(ymd)` → 0=nd … 6=sob.
 */
export function pickRepresentativeDate(dates, weekdayPred, weekdayOf) {
  const matching = dates.filter(d => weekdayPred(weekdayOf(d)));
  return matching.find(d => !holidayName(d) && !specialDayName(d)) ?? matching[0] ?? null;
}

/**
 * Co pokazać użytkownikowi o danych wybranego typu dnia. Stare meta.json bez
 * `dayInfo` → data z `dates`, reżim null (komunikaty milczą).
 */
export function dayDataNotice(meta, dayKey, todayYmd) {
  const info = meta?.dayInfo?.[dayKey] ?? null;
  const date = info?.date ?? meta?.dates?.[dayKey] ?? null;
  const regime = info?.regime ?? null;
  const todayRegime = dateRegime(todayYmd);
  // przerwa świąteczna po obu stronach jest zbyt zmienna, by ją flagować
  const regimeMismatch = regime !== null
    && (regime === 'summer') !== (todayRegime === 'summer')
    && regime !== 'holiday-season' && todayRegime !== 'holiday-season';
  return {
    date,
    regime,
    holiday: info?.holiday ?? null,
    regimeMismatch,
    todayHoliday: holidayName(todayYmd),
    todayShortened: todayYmd.slice(4) === '1224', // skrócony rozkład, nie niedzielny
  };
}
