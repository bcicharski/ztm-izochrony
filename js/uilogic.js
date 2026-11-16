/**
 * Logika interfejsu niezależna od DOM (Z-034): czas w Warszawie, parametry
 * URL, formatowanie, teksty komunikatów i kolejka zadań workera.
 *
 * Zasada modułu: funkcje dostają dane argumentem i zwracają wartość — nic tu
 * nie czyta z `document`, `window` ani `location`. Dzięki temu da się je
 * testować w `node --test` (tests/uilogic.test.mjs) bez przeglądarki.
 * Używane przez app.js, map.js i worker.js.
 */

// --- czas ------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * „Teraz" w strefie Europe/Warsaw (nie przeglądarki): data yyyymmdd, minuty od
 * północy i dzień tygodnia (0 = niedziela). Rozkład jest polski, więc turysta
 * z innej strefy też ma dostać dzisiejszy typ dnia i godzinę w Polsce.
 * `date` pozwala podać chwilę z zewnątrz (testy).
 */
export function warsawNow(date = new Date()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(date).map(x => [x.type, x.value]));
    const weekday = WEEKDAYS.indexOf(p.weekday);
    if (weekday < 0) throw new Error('weekday');
    return { ymd: `${p.year}${p.month}${p.day}`, minutes: +p.hour * 60 + +p.minute, weekday };
  } catch {
    // brak Intl/strefy: czas lokalny przeglądarki
    const pad = n => String(n).padStart(2, '0');
    return {
      ymd: `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
      minutes: date.getHours() * 60 + date.getMinutes(),
      weekday: date.getDay(),
    };
  }
}

/** Dzień tygodnia (0 = niedziela) → domyślny typ dnia rozkładu. */
export const dayTypeOf = weekday => (weekday === 0 ? 'sunday' : weekday === 6 ? 'saturday' : 'workday');

/** Sekundy doby → „GG:MM"; ujemne (wyjście przed północą przy „do miejsca") zawijane do poprzedniego dnia. */
export const HHMM = s => {
  const d = ((Math.floor(s) % 86400) + 86400) % 86400;
  return `${String(Math.floor(d / 3600)).padStart(2, '0')}:${String(Math.floor(d / 60) % 60).padStart(2, '0')}`;
};

/** Minuty od północy → „GG:MM" (parametr `t` adresu). */
export const fmtClock = min => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** „yyyymmdd" → „dd.mm.yyyy"; cokolwiek innego → null. */
export const fmtDate = d => (d && /^\d{8}$/.test(d) ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : null);

// --- adres URL ----------------------------------------------------------------

const DAYS = ['workday', 'saturday', 'sunday'];

const toParams = search => (search instanceof URLSearchParams ? search : new URLSearchParams(search));

/** „lat,lng" → {lat, lng} albo null (brak, zła liczba pól, nie-liczby). */
function parsePoint(s) {
  const p = s?.split(',').map(Number);
  return p?.length === 2 && p.every(Number.isFinite) ? { lat: p[0], lng: p[1] } : null;
}

/**
 * Parametry adresu → pola stanu. Zwraca tylko to, co adres faktycznie
 * ustawia (reszta zostaje domyślna), więc wynik można nałożyć na stan przez
 * Object.assign. `cities` to obiekt miast (klucze = identyfikatory); nieznane
 * `city` jest ignorowane. `veh` to zbiór włączonych kluczy pojazdów albo null.
 * `search` — string zapytania (`location.search`) albo URLSearchParams.
 */
export function parseUrlState(search, cities) {
  const q = toParams(search);
  const out = { dayFromUrl: false, pointFromUrl: false, veh: null };
  if (cities[q.get('city')]) out.city = q.get('city');
  const p = parsePoint(q.get('p'));
  if (p) { out.point = p; out.pointFromUrl = true; }
  const p2 = parsePoint(q.get('p2'));
  if (p2) out.point2 = p2;
  if (q.get('cmp') === '1') out.compare = true;
  if (q.get('dir') === 'to') out.direction = 'to';
  if (q.get('walk') === '0') out.walk = false;
  if (['bike', 'bike-onboard'].includes(q.get('acc'))) out.access = q.get('acc');
  if (q.get('mode') === 'general') out.mode = 'general';
  const t = q.get('t')?.match(/^(\d{1,2}):(\d{2})$/);
  if (t) out.timeMin = Math.min(+t[1], 23) * 60 + Math.min(+t[2], 59);
  if (DAYS.includes(q.get('day'))) { out.day = q.get('day'); out.dayFromUrl = true; }
  if (q.get('st') === '1') out.stats = true;
  if (q.get('safe') === '1') out.safe = true;
  const veh = q.get('veh');
  if (veh != null) out.veh = new Set(veh.split(','));
  return out;
}

/** Czy adres wymusza silnik w wątku głównym (`?engine=main`, tryb awaryjny do testów). */
export const wantsMainEngine = search => toParams(search).get('engine') === 'main';

/**
 * Stan → zapytanie adresu („?city=…"), do `history.replaceState`. Parametry
 * domyślne są pomijane, żeby linki były krótkie. Format zgodny z parseUrlState.
 */
export function buildQuery(state) {
  const q = new URLSearchParams();
  q.set('city', state.city);
  q.set('p', `${state.point.lat.toFixed(5)},${state.point.lng.toFixed(5)}`);
  if (state.compare) {
    q.set('cmp', '1');
    q.set('p2', `${state.point2.lat.toFixed(5)},${state.point2.lng.toFixed(5)}`);
  }
  q.set('dir', state.direction);
  q.set('walk', state.walk ? '1' : '0');
  if (state.access !== 'foot') q.set('acc', state.access);
  q.set('mode', state.mode);
  if (state.mode === 'time') {
    q.set('t', fmtClock(state.timeMin));
    q.set('day', state.day);
  }
  if (state.stats && !state.compare) q.set('st', '1');
  if (state.safe) q.set('safe', '1');
  const vehKeys = Object.keys(state.veh);
  const vehOn = vehKeys.filter(k => state.veh[k]);
  if (vehOn.length < vehKeys.length) q.set('veh', vehOn.join(','));
  return '?' + q.toString();
}

// --- teksty interfejsu -----------------------------------------------------------

/**
 * Preferencja „ogranicz ruch". `mq` to wynik `matchMedia(...)` albo
 * `undefined`, gdy API nie istnieje — wtedy fałsz.
 */
export const reducedMotionFrom = mq => mq?.matches ?? false;

/** Ikony dwóch skrajnych etapów: rower ma ten, kto podróż zaczyna (patrz README). */
export function accessIcons(access, direction) {
  const start = access !== 'foot' ? '🚲' : '🚶';
  const end = access === 'bike-onboard' ? '🚲' : '🚶';
  return direction === 'from'
    ? { atPoint: start, atTarget: end }
    : { atPoint: end, atTarget: start };
}

/**
 * Czytelny opis bieżącego widoku do paska statusu. `whenTime` to gotowy
 * fragment o czasie (np. „Dzień roboczy, 08:30"), bo etykiety dni i wartość
 * pola godziny należą do wywołującego.
 */
export function statusLine({ walkOnly, compare, direction, mode, safe, whenTime }) {
  if (walkOnly) {
    // rozkład i godzina nie mają wpływu na sam spacer
    return compare
      ? 'Wspólny zasięg pieszo dwóch punktów.'
      : (direction === 'from' ? 'Zasięg pieszo z punktu.' : 'Obszar z dojściem pieszo do punktu.');
  }
  const what = compare
    ? (direction === 'from' ? 'Wspólny zasięg dwóch punktów' : 'Obszar z dojazdem do obu punktów')
    : (direction === 'from' ? 'Zasięg z punktu' : 'Obszar z dojazdem do punktu');
  const when = mode === 'time' ? whenTime : 'tryb ogólny (bez oczekiwania)';
  return `${what} · ${when}${safe ? ' · z marginesem na opóźnienia' : ''}.`;
}

/** Liczba z przecinkiem dziesiętnym (czytnik ekranu czyta „2,5", nie „2.5"). */
const plComma = (n, digits = 1) => n.toFixed(digits).replace('.', ',');

/**
 * Komunikat dla czytników ekranu po przeliczeniu (Z-045, region #zoneSummary).
 * Używa wyłącznie danych, które strona ma po fazie `zones`: `reachable`
 * (liczba przystanków), `stats` (wiersze jak w tabeli; tylko gdy włączone
 * „Pokaż statystyki" i nie ma porównania), nazwa miasta i `statusText`.
 * `showArea` — czy w tabeli widać kolumnę „% miasta".
 */
export function zoneSummaryText({ statusText, city, reachable, walkOnly, compare, stats, showArea }) {
  if (reachable === 0 && !walkOnly) return 'Brak przystanków w zasięgu — wybierz punkt bliżej miasta.';
  const head = `${statusText} Miasto: ${city}.`;
  if (walkOnly) return head;
  if (stats?.length) {
    const bands = stats.filter(r => r.maxKm > 0).map(r => {
      const pct = showArea && r.areaPct != null
        ? `, ${plComma(r.areaPct, r.areaPct >= 9.95 ? 0 : 1)}% miasta` : '';
      return `${r.label} — ${plComma(r.maxKm)} km${pct}`;
    });
    const range = bands.length ? ` Zasięg w linii prostej od punktu: ${bands.join(', ')}.` : '';
    return `${head}${range} Przystanków w zasięgu: ${reachable}.`;
  }
  const hint = compare ? '' : ' Włącz „Pokaż statystyki", aby usłyszeć zasięgi w kilometrach.';
  return `${head} Przystanków w zasięgu: ${reachable}.${hint}`;
}

/**
 * Stopka i komunikat #dayNote z wyniku `dayDataNotice` (calendar.js).
 * W święto tylko proponujemy przełączenie na niedzielę (`offerSunday`) —
 * nie przy `?day=` w adresie i nie, gdy typ dnia wybrano ręcznie.
 */
export function dayInfoView(n, { dayFromUrl, day, todayDay }) {
  const parts = [];
  let offerSunday = false;
  if (n.todayHoliday && !dayFromUrl && day === 'workday' && todayDay === 'workday') {
    if (n.todayShortened) {
      parts.push(`Dziś ${n.todayHoliday} — komunikacja jedzie rozkładem skróconym, wyniki dla dnia roboczego mogą odbiegać.`);
    } else {
      parts.push(`Dziś święto (${n.todayHoliday}) — komunikacja jedzie zwykle rozkładem niedzielnym.`);
      offerSunday = true;
    }
  }
  if (n.regimeMismatch) {
    const d = fmtDate(n.date)?.slice(0, 5);
    parts.push(n.regime === 'summer'
      ? `Rozkład pochodzi z okresu wakacyjnego${d ? ` (${d})` : ''} — w ciągu roku szkolnego kursów jest więcej.`
      : `Rozkład pochodzi z roku szkolnego${d ? ` (${d})` : ''} — w wakacje kursów jest mniej.`);
  }
  if (n.holiday) parts.push(`Rozkład z dnia świątecznego (${n.holiday}) — może odbiegać od zwykłego.`);
  return {
    feedDate: fmtDate(n.date) ?? '—',
    feedDateNote: n.regime === 'summer' ? ' (rozkład wakacyjny)' : '',
    text: parts.join(' '),
    offerSunday,
  };
}

// --- worker ----------------------------------------------------------------------

/**
 * Kolejka „ostatni wygrywa": gdy w trakcie wykonywania `handler` przyjdą
 * kolejne zadania, po jego zakończeniu wykona się tylko najnowsze (starsze są
 * odrzucane). Błąd `handler` trafia do `onError` (jeśli podano), a pętla
 * działa dalej. `push` zwraca obietnicę pętli — można poczekać na opróżnienie.
 */
export function createLatestQueue(handler, onError) {
  let queued = null;
  let running = null;
  async function pump() {
    while (queued) {
      const job = queued;
      queued = null;
      try {
        await handler(job);
      } catch (err) {
        onError?.(err, job);
      }
    }
    running = null;
  }
  return {
    push(job) {
      queued = job;
      if (!running) running = pump();
      return running;
    },
  };
}

// --- geolokalizacja, wibracja, offline (Z-002 etap 2) ---------------------------

/** Kod `GeolocationPositionError.code` → komunikat; wspólny dla obu przycisków lokalizacji. */
export const geoErrorMessage = code => {
  switch (code) {
    case 1: return 'Odmówiono zgody na lokalizację. Zgodę można przywrócić w ustawieniach strony w przeglądarce.';
    case 2: return 'Brak sygnału lokalizacji — spróbuj ponownie na zewnątrz albo wskaż punkt na mapie.';
    case 3: return 'Ustalanie lokalizacji trwało zbyt długo — spróbuj jeszcze raz.';
    default: return 'Nie udało się pobrać lokalizacji.';
  }
};

/** Pozycja w prostokącie `bbox` = [latS, lonW, latN, lonE]. */
export const inBbox = (lat, lon, bbox) =>
  lat >= bbox[0] && lat <= bbox[2] && lon >= bbox[1] && lon <= bbox[3];

/**
 * Maksymalna odległość punktu od krawędzi `bbox` miasta (km), w której jeszcze
 * je proponujemy (Z-049). Dobrana z danych data/cities.json: odległość od
 * środka do krawędzi bbox to 5–27 km (typowo 8–20 km), największa — GZM,
 * 47,7 km (do rogu 62 km). Dawne „60 km od środka" proponowało Opole dla
 * punktu 53 km od jego bbox (np. za Odrą w Niemczech), a punkt 6 km za rogiem
 * GZM nie dostawał nic. Mierząc od krawędzi bbox, 15 km to pas podmiejski,
 * niezależny od rozmiaru miasta; najbliższe sąsiednie bbox-y są dalej niż 30 km.
 */
export const NEAREST_CITY_MAX_KM = 15;

/** Odległość (km) punktu od prostokąta `bbox` (0 wewnątrz). */
function kmToBbox(lat, lon, bbox) {
  const dy = Math.max(bbox[0] - lat, 0, lat - bbox[2]) * 111.32;
  const dx = Math.max(bbox[1] - lon, 0, lon - bbox[3]) * 111.32 * Math.cos(lat * Math.PI / 180);
  return Math.hypot(dx, dy);
}

/**
 * Klucz miasta, w którego `bbox` leży punkt; w razie braku — to, którego
 * `bbox` jest najbliżej, o ile nie dalej niż NEAREST_CITY_MAX_KM (włącznie);
 * inaczej null (np. Bałtyk). Miasto bez `bbox` jest mierzone od `center`.
 * `cities`: obiekt jak data/cities.json.
 */
export function nearestCity(lat, lon, cities) {
  const entries = Object.entries(cities);
  const inside = entries.find(([, c]) => c.bbox && inBbox(lat, lon, c.bbox));
  if (inside) return inside[0];
  let best = null, bestKm = NEAREST_CITY_MAX_KM;
  for (const [key, c] of entries) {
    let km;
    if (c.bbox) km = kmToBbox(lat, lon, c.bbox);
    else if (c.center) km = kmToBbox(lat, lon, [c.center[0], c.center[1], c.center[0], c.center[1]]);
    else continue;
    if (km <= bestKm) { best = key; bestKm = km; }
  }
  return best;
}

/**
 * Wibracja po długim przeliczeniu: nie przy szybkim wyniku (szum), nie przy
 * „ogranicz ruch" i nie przed pierwszym dotknięciem strony (Z-048: Chrome
 * odrzuca wtedy `navigator.vibrate` i wypisuje interwencję w konsoli).
 * `userActivated` blokuje tylko, gdy jest dokładnie `false`; `undefined`
 * (brak `navigator.userActivation`) znaczy „nie wiemy" i nie blokuje.
 */
export const shouldVibrate = ({ supported, reduceMotion, elapsedMs, userActivated }) =>
  supported && !reduceMotion && elapsedMs >= 1500 && userActivated !== false;

/** Komunikat błędu wczytywania danych: offline mówi wprost, że to brak sieci. */
export const loadErrorMessage = (online, fallback) =>
  (online === false ? 'Jesteś offline — rozkłady wymagają połączenia.' : fallback);

// --- HTML, ARIA, pokrycie opóźnień (Z-046) -------------------------------------------

/** Escapuje tekst do HTML (węzeł tekstowy i atrybut). `&` musi być pierwszy. */
export const esc = t => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Stabilny, unikalny w obrębie listy `id` opcji wyniku (aria-activedescendant). */
export const optionId = (listId, i) => `${listId}-opt-${i}`;

/**
 * Tekst stopki o pokryciu profilami opóźnień z wyniku `delayCoverage` (data.js).
 * Ułamek „N z M", nigdy procent — przy feedach zbiorczych M obejmuje też koleje.
 * Stan `unknown` (stare meta.json bez pola) daje pusty tekst: wpis ukryty.
 */
export function delayCoverageText(c) {
  return {
    profiles: () => {
      const n = c.routesTotal == null ? `${c.routes} linii` : `${c.routes} z ${c.routesTotal} linii`;
      const d = fmtDate(c.updated);
      return d ? `${n} (pomiary do ${d})` : n;
    },
    collecting: () => 'zbieramy pomiary',
    none: () => 'brak — margines szacunkowy',
  }[c.state]?.() ?? '';
}

/**
 * Podpowiedź pod przełącznikiem trybu ostrożnego (tylko gdy `safe`). Przy
 * stanie `unknown` milczy o pokryciu. Kierunek „do miejsca" dostaje zawsze
 * szacunek — router.js wyłącza profile dla direction === 'to'.
 */
export function safeNoteText({ safe, coverage: c, direction }) {
  if (!safe) return '';
  const parts = [];
  if (c.state === 'profiles') parts.push(`Margines z pomiarów dla ${c.routes} linii; dla pozostałych szacunek.`);
  else if (c.state !== 'unknown') parts.push('Margines szacunkowy — dla tego miasta nie mamy jeszcze pomiarów.');
  if (direction === 'to') parts.push('W kierunku „do miejsca" zawsze używany jest szacunek.');
  return parts.join(' ');
}
