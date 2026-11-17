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

/**
 * Powód niedostępności lokalizacji (przycisk #locateBtn): `null`, gdy działa.
 * Pokazywany jako trwały tekst — `title` nie istnieje na dotyku i nie czyta go czytnik.
 */
export const locateUnavailableReason = (secureContext, hasGeolocation) => {
  if (!secureContext) return 'Lokalizacja wymaga bezpiecznego połączenia (HTTPS).';
  if (!hasGeolocation) return 'Przeglądarka nie udostępnia lokalizacji.';
  return null;
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

// --- ostatnie punkty (Z-015) ---------------------------------------------------------

/** Klucz w localStorage; ksztalt `{v:1, items:[{label, lat, lng, city, ts}]}`. */
export const RECENT_POINTS_KEY = 'recent-points';

const DAY_MS = 86400000;
/** Klucz deduplikacji: te same współrzędne do 5 miejsc (jak w buildQuery, ~1 m). */
const pointKey = p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/**
 * Odczyt historii z surowego tekstu localStorage. Odporny na wszystko:
 * pusty tekst, zły JSON, inna wersja `v`, wpisy bez pól, starsze niż
 * `maxAgeDays` albo z przyszłości (zegar cofnięty) — takie wpisy odpadają.
 */
export function parseRecentPoints(raw, { nowMs = Date.now(), maxAgeDays = 90 } = {}) {
  let data;
  try { data = JSON.parse(raw); } catch { return []; }
  if (data?.v !== 1 || !Array.isArray(data.items)) return [];
  const oldest = nowMs - maxAgeDays * DAY_MS;
  return data.items
    .filter(e => e && typeof e.label === 'string' && e.label && typeof e.city === 'string'
      && Number.isFinite(e.lat) && Number.isFinite(e.lng) && Number.isFinite(e.ts)
      && e.ts >= oldest && e.ts <= nowMs)
    .map(e => ({ label: e.label, lat: e.lat, lng: e.lng, city: e.city, ts: e.ts }));
}

/** Nowy wpis na górze; dublet (te same współrzędne do 5 miejsc) wędruje na górę; ucina do `max`. Nie mutuje wejścia. */
export function pushRecentPoint(list, entry, { max = 12 } = {}) {
  const k = pointKey(entry);
  return [entry, ...list.filter(e => pointKey(e) !== k)].slice(0, max);
}

/** Wpisy danego miasta w kolejności listy (najnowsze pierwsze), najwyżej `limit`. */
export const recentForCity = (list, city, { limit = 5 } = {}) =>
  list.filter(e => e.city === city).slice(0, limit);

export const serializeRecentPoints = list => JSON.stringify({ v: 1, items: list });

// --- eksport stref do GeoJSON (Z-008) ------------------------------------------------

export const EXPORT_SOURCE = 'Dokąd dojadę? — transport.excelninja.pro';

const round5 = x => Math.round(x * 1e5) / 1e5;

/** Pole ze znakiem (wzór sznurowadłowy) na płaszczyźnie [lon, lat]: >0 = przeciwnie do ruchu wskazówek. */
function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

/**
 * Płaska lista [lat, lon, …] → pierścień GeoJSON [[lon, lat], …]: kolejność
 * lon/lat, zaokrąglenie do 5 miejsc (~1 m, poniżej rozdzielczości siatki;
 * bez tego plik rośnie ok. 3 razy), bez powtórzeń z zaokrąglenia, domknięty
 * i nawinięty wg RFC 7946 (zewnętrzny CCW, dziura CW). null, gdy zostało < 3 punktów.
 */
function toGeoRing(flat, outer) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) {
    const p = [round5(flat[i + 1]), round5(flat[i])];
    const prev = pts[pts.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) pts.push(p);
  }
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length < 3) return null;
  pts.push(pts[0]);
  // oś Y siatki jest odwrócona względem lat — kierunek liczymy z pola, nie zakładamy
  if ((signedArea(pts) > 0) !== outer) pts.reverse();
  return pts;
}

/**
 * Obrysy pasm (wynik `buildContours`) → FeatureCollection GeoJSON: jeden
 * MultiPolygon na pasmo, od najchłodniejszego (największego) do najcieplejszego,
 * czyli w kolejności rysowania. Pasma są KUMULATYWNE: „20–30 min" obejmuje też
 * obszar „do 10 min" i „10–20 min" — nakładają się, a nie sąsiadują.
 * Zagnieżdżenie bierzemy z `band.poly` (numer wielokąta każdego pierścienia),
 * nie z testów zawierania punktu — d3 już je policzył.
 * `meta` trafia jako `metadata` kolekcji i do `properties` każdego Feature
 * (QGIS pokazuje tylko atrybuty); `source` ma wartość domyślną.
 */
export function zonesToGeoJSON(contours, meta = {}) {
  const info = { ...meta, source: meta.source ?? EXPORT_SOURCE };
  for (const k of Object.keys(info)) if (info[k] === undefined) delete info[k];
  const features = [];
  contours.forEach((band, bi) => {
    const polys = new Map(); // numer wielokąta → pierścienie (pierwszy = zewnętrzny)
    band.rings.forEach((flat, i) => {
      const id = band.poly[i];
      const ring = toGeoRing(flat, !polys.has(id));
      if (!ring) {
        if (!polys.has(id)) polys.set(id, null); // zewnętrzny odpadł → cały wielokąt pomijamy
        return;
      }
      if (polys.get(id) === null) return;
      if (!polys.has(id)) polys.set(id, [ring]); else polys.get(id).push(ring);
    });
    const coordinates = [...polys.values()].filter(Boolean);
    if (!coordinates.length) return;
    const min = bi > 0 ? contours[bi - 1].limit : 0;
    features.push({
      type: 'Feature',
      properties: {
        minutes_max: band.limit,
        minutes_min: min,
        label: min === 0 ? `do ${band.limit} min` : `${min}–${band.limit} min`,
        color: band.color,
        fill: band.color,
        'fill-opacity': 0.55, // jak ZONE_ALPHA na mapie
        ...info,
      },
      geometry: { type: 'MultiPolygon', coordinates },
    });
  });
  features.reverse();
  return { type: 'FeatureCollection', metadata: info, features };
}

/** Nazwa pliku eksportu: `izochrona-<miasto>[-2pkt]-<yyyymmdd>-<HHMM>.geojson`. */
export function exportFileName(state, ymd) {
  const city = String(state.city).replace(/[^A-Za-z0-9_-]/g, '');
  const hhmm = fmtClock(state.timeMin).replace(':', '');
  return `izochrona-${city}${state.compare ? '-2pkt' : ''}-${ymd}-${hhmm}.geojson`;
}

// --- wskazówka pierwszej wizyty (Z-009) ---------------------------------------------

/** Wskazówka tylko gdy: nie widziana (`seen` = '1' z localStorage albo true; śmieci to „nie widziana"), pasek zgody nie czeka na decyzję i adres nie niesie punktu. */
export const shouldShowIntro = ({ seen, consentPending, pointFromUrl }) =>
  !(seen === '1' || seen === true) && !consentPending && !pointFromUrl;

// --- wyszukiwanie przystanków po nazwie (Z-056) --------------------------------

/** Najkrótsze zapytanie o przystanek (znaki po normalizacji). */
export const STOP_QUERY_MIN = 2;
/** Najkrótsze zapytanie o adres (znaki): krótsze marnowałoby zapytania do geokodera. */
export const ADDRESS_QUERY_MIN = 3;
/** Komunikat po Enterze przy zapytaniu krótszym niż `ADDRESS_QUERY_MIN`. */
export const ADDRESS_QUERY_HINT = 'Wpisz co najmniej 3 znaki, aby szukać adresu.';

/**
 * Normalizacja nazw do porównań: małe litery, bez znaków diakrytycznych
 * (NFD nie rozkłada „ł", stąd jawna mapa), niealfanumeryczne → spacja.
 */
export function normalizeStopQuery(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Promień [km], w którym przystanki o tej samej nazwie to jeden zespół. */
export const STOP_CLUSTER_KM = 1;

/**
 * Kompaktowy indeks nazw przystanków z sieci `{nStops, stopName, lat, lon}`.
 * Jeden reprezentant (pierwszy) na zespół: kilka słupków tej samej nazwy bliżej
 * niż `STOP_CLUSTER_KM` daje jeden wpis, ta sama nazwa kilometry dalej osobny.
 * `lat`/`lon` jako Float64Array (bez utraty dokładności współrzędnych; bufory
 * i tak da się przenieść z workera transferem — koszt to ok. 28 KB dla GZM).
 */
export function buildStopIndex(net) {
  const names = [], la = [], lo = [];
  // Reprezentanci per znormalizowana nazwa. Klucz siatkowy odpadł: zespół leżący
  // na granicy komórki dawał dwa identyczne wpisy („Wrzeszcz PKP” w Trójmieście).
  // Liczymy odległość do już przyjętych o tej samej nazwie — poniżej progu to ten
  // sam zespół, powyżej (np. „Ratuszowa” w dwóch dzielnicach) osobne miejsce.
  const kept = new Map();
  for (let i = 0; i < (net?.nStops ?? 0); i++) {
    const name = net.stopName[i];
    const norm = normalizeStopQuery(name);
    if (!norm) continue;
    const lat = net.lat[i], lon = net.lon[i];
    const near = kept.get(norm);
    if (near) {
      let dup = false;
      for (const [plat, plon] of near) {
        const dy = (lat - plat) * 111.32;
        const dx = (lon - plon) * 111.32 * Math.cos(lat * Math.PI / 180);
        if (dx * dx + dy * dy <= STOP_CLUSTER_KM * STOP_CLUSTER_KM) { dup = true; break; }
      }
      if (dup) continue;
      near.push([lat, lon]);
    } else {
      kept.set(norm, [[lat, lon]]);
    }
    names.push(name);
    la.push(lat);
    lo.push(lon);
  }
  return { names, lat: Float64Array.from(la), lon: Float64Array.from(lo) };
}

/**
 * Mały cache asynchronicznych wyników po kluczu (Z-057): leniwie, z limitem
 * wpisów (najstarszy wypada) — przełączanie typu dnia tam i z powrotem nie
 * przelicza indeksu przystanków. Błąd i wynik `null` (miasto się zmieniło
 * w trakcie) nie zostają w cache; błąd kończy się `null`, nie wyjątkiem.
 * @param {number} [limit]
 */
export function createAsyncCache(limit = 3) {
  const map = new Map(); // klucz -> {index, promise}
  return {
    /** Wynik już policzony (bez czekania) albo null. */
    peek: key => map.get(key)?.index ?? null,
    /** Wynik z cache albo `load()` (jedno wywołanie na klucz naraz). */
    async get(key, load) {
      let entry = map.get(key);
      if (!entry) {
        entry = { index: null, promise: null };
        const mine = entry;
        entry.promise = Promise.resolve().then(load).then(ix => {
          if (ix == null) { if (map.get(key) === mine) map.delete(key); return null; }
          mine.index = ix;
          return ix;
        }, err => {
          console.error(err);
          if (map.get(key) === mine) map.delete(key);
          return null;
        });
        map.set(key, entry);
        while (map.size > limit) map.delete(map.keys().next().value);
      }
      return entry.index ?? entry.promise;
    },
  };
}

/**
 * Dopasowanie po nazwie: prefiks całej nazwy (0) → prefiks dowolnego słowa (1)
 * → podciąg (2); w obrębie rangi krótsza nazwa wyżej, potem kolejność w indeksie.
 * Znormalizowane nazwy liczone raz i pamiętane w `index._norm`.
 */
export function searchStops(index, query, { limit = 5 } = {}) {
  const q = normalizeStopQuery(query);
  if (!index || q.length < STOP_QUERY_MIN) return [];
  const norm = index._norm ??= index.names.map(normalizeStopQuery);
  const hits = [];
  for (let i = 0; i < norm.length; i++) {
    const n = norm[i];
    let rank = -1;
    if (n.startsWith(q)) rank = 0;
    else if (n.includes(' ' + q)) rank = 1;
    else if (n.includes(q)) rank = 2;
    if (rank >= 0) hits.push({ i, rank, len: n.length });
  }
  hits.sort((a, b) => a.rank - b.rank || a.len - b.len || a.i - b.i);
  return hits.slice(0, limit).map(h => ({
    name: index.names[h.i], lat: index.lat[h.i], lon: index.lon[h.i], rank: h.rank,
  }));
}

/**
 * Jedna lista do listboxa: przystanki zawsze na górze, potem adresy z geokodera.
 * `places`: [{label, lat, lng}]. Numeracja `optionId` idzie po tej finalnej tablicy.
 */
export function mergeSearchResults(stops, places, { limit = 8 } = {}) {
  return [
    ...(stops ?? []).map(s => ({ label: s.name, lat: s.lat, lng: s.lon, source: 'stop' })),
    ...(places ?? []).map(p => ({ label: p.label, lat: p.lat, lng: p.lng, source: 'place' })),
  ].slice(0, limit);
}

// --- zwijane sekcje panelu (Z-059) -----------------------------------------------

/** Klucz w localStorage: jedna mapa `{idSekcji: bool}`. Stan sekcji NIE trafia do adresu URL. */
export const PANEL_SECTIONS_KEY = 'panel-sections';
/** Znane sekcje (id elementów `<details>`); nieznane klucze z pamięci są odrzucane. */
export const PANEL_SECTION_IDS = ['secTime', 'secAccess', 'secDelay', 'secData'];

/**
 * Odczyt mapy stanu sekcji z surowego tekstu localStorage. Odporny na pusty
 * tekst, zły JSON, nieznane identyfikatory i wartości inne niż bool — takie
 * wpisy odpadają, brakujące sekcje zostają zamknięte (układ domyślny).
 */
export function parseSectionState(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return {}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  for (const id of PANEL_SECTION_IDS) if (typeof data[id] === 'boolean') out[id] = data[id];
  return out;
}

export const serializeSectionState = map => JSON.stringify(
  Object.fromEntries(PANEL_SECTION_IDS.filter(id => typeof map?.[id] === 'boolean').map(id => [id, map[id]])));

const SUMMARY_DAY = { workday: 'dzień roboczy', saturday: 'sobota', sunday: 'niedziela' };
const SUMMARY_ACCESS = { foot: 'pieszo', bike: 'rowerem', 'bike-onboard': 'rowerem w pojeździe' };

/** „Czas i kierunek": bieżące wartości; `changed`, gdy odbiegają od `defaults` ({ timeMin, day }). */
export function timeSectionSummary({ mode, timeMin, day, direction }, defaults = {}) {
  const dir = direction === 'to' ? 'do miejsca' : 'z miejsca';
  const head = mode === 'general' ? 'ogólnie' : `${fmtClock(timeMin)} · ${SUMMARY_DAY[day] ?? day}`;
  const changed = mode === 'general' || direction === 'to'
    || (defaults.timeMin != null && timeMin !== defaults.timeMin)
    || (defaults.day != null && day !== defaults.day);
  return { text: `${head} · ${dir}`, changed };
}

/** Nazwa środka bez ikony emoji z początku etykiety: „🚌 Autobus" → „autobus". */
const vehName = label => String(label).replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();

/**
 * „Dojście i środki transportu". `groups` = `cityCfg().veh`, `veh` = mapa
 * kluczy → bool. Do trzech nazw wprost, powyżej „N z M środków". Przy jednym
 * środku filtr jest ukryty w panelu, więc podsumowanie mówi tylko o dojściu.
 */
export function accessSectionSummary({ walk, access, groups, veh }) {
  const on = groups.filter(g => veh[g.key]);
  if (groups.length >= 2 && on.length === 0) return { text: 'tylko pieszo', changed: true };
  const walkPart = walk ? (SUMMARY_ACCESS[access] ?? 'pieszo') : 'bez spaceru';
  let vehPart = null;
  if (groups.length >= 2) {
    if (on.length === groups.length) vehPart = 'wszystkie środki';
    else vehPart = on.length <= 3 ? on.map(g => vehName(g.label)).join(', ') : `${on.length} z ${groups.length} środków`;
  }
  const changed = !walk || access !== 'foot' || (vehPart !== null && on.length !== groups.length);
  return { text: vehPart ? `${walkPart} · ${vehPart}` : walkPart, changed };
}

/** „Opóźnienia i statystyki". Statystyki liczą się tylko w trybie jednego punktu (w porównaniu przełącznik jest ukryty). */
export function delaySectionSummary({ safe, stats, compare }) {
  const showStats = !!stats && !compare;
  return {
    text: [safe ? 'ostrożny' : 'standardowo', showStats ? 'statystyki' : null].filter(Boolean).join(' · '),
    changed: !!safe || showStats,
  };
}

/** „yyyymmdd" → „yyyy-mm-dd"; cokolwiek innego → null. */
export const fmtIsoDate = d => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);

/** „Dane i kontakt": data rozkładu albo „rozkład nieaktualny" (wtedy `changed`, bo wymaga uwagi). */
export function dataSectionSummary({ feedDate, stale }) {
  if (stale) return { text: 'rozkład nieaktualny', changed: true };
  const iso = fmtIsoDate(feedDate);
  return { text: iso ? `rozkład z ${iso}` : 'źródła i kontakt', changed: false };
}
