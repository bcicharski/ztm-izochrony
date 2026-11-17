/**
 * Spięcie UI: stan aplikacji, kontrolki, przeliczanie i rysowanie stref.
 */


import { loadMeta, loadWater, loadCities, dropCityCache, DAY_KEYS, DAY_LABELS, distM } from './data.js';
import { BANDS } from './isochrone.js';
import { createMap, ZoneLayer, ZONE_ALPHA, prefersReducedMotion, addLocateControl } from './map.js';
import {
  warsawNow, dayTypeOf, HHMM, fmtClock, fmtDate, parseUrlState, wantsMainEngine, buildQuery,
  accessIcons as accessIconsFor, statusLine, dayInfoView,
  geoErrorMessage, locateUnavailableReason, ADDRESS_QUERY_MIN, ADDRESS_QUERY_HINT, nearestCity, inBbox, shouldVibrate, loadErrorMessage, zoneSummaryText,
  esc, optionId, createAsyncCache, STOP_QUERY_MIN, normalizeStopQuery, searchStops, mergeSearchResults, delayCoverageText, safeNoteText,
  RECENT_POINTS_KEY, parseRecentPoints, pushRecentPoint, recentForCity, serializeRecentPoints,
  zonesToGeoJSON, exportFileName, shouldShowIntro,
  PANEL_SECTIONS_KEY, PANEL_SECTION_IDS, parseSectionState, serializeSectionState,
  timeSectionSummary, accessSectionSummary, delaySectionSummary, dataSectionSummary,
} from './uilogic.js';
import { Engine } from './engine.js';
import { dayDataNotice } from './calendar.js';
import { report, records, setSink, installHandlers, formatReport, locate } from './diag.js';
import { delayCoverage } from './data.js';

// Diagnostyka (Z-025): handlery od razu, a rekordy złapane przez skrypt
// w <head> (zanim moduł się wczytał) przejmujemy do bufora modułu.
installHandlers(window);
for (const r of window.__diag ?? []) report({ src: r.src, msg: r.msg, at: r.at });

let CITIES;
try {
  CITIES = await loadCities();
} catch (err) {
  // bez konfiguracji miast nie ma czego rysować — powiedz to wprost zamiast
  // zostawiać pusty panel z „…" w stopce
  document.getElementById('status').textContent = 'Nie udało się wczytać konfiguracji miast. Odśwież stronę.';
  throw err;
}
const DEFAULT_CITY = 'trojmiasto';

// --- stan domyślny: „gdybym wyszedł teraz" -----------------------------------

const now = warsawNow();
const todayDay = dayTypeOf(now.weekday);

const state = {
  city: DEFAULT_CITY,
  point: null,   // ustawiane z konfiguracji miasta poniżej
  point2: null,
  compare: false,
  direction: 'from',
  walk: true,
  access: 'foot', // 'foot' | 'bike' (zostaje na przystanku) | 'bike-onboard'
  mode: 'time',
  timeMin: Math.floor(now.minutes / 5) * 5,
  day: todayDay,
  stats: false,
  safe: false,   // tryb ostrożny: margines na opóźnienia
  veh: {},       // klucze zależne od miasta
};

const cityCfg = () => CITIES[state.city];

function defaultVeh() {
  return Object.fromEntries(cityCfg().veh.map(v => [v.key, true]));
}

/** Zbiór dozwolonych route_type albo null, gdy wszystko dozwolone. */
function allowedTypes() {
  const groups = cityCfg().veh;
  if (groups.every(g => state.veh[g.key])) return null;
  return new Set(groups.filter(g => state.veh[g.key]).flatMap(g => g.types));
}

/**
 * Tryb „tylko pieszo": odznaczone wszystkie środki transportu. Zasięg to sama
 * fala piesza po lądzie z punktu (bez pojazdów), więc pomijamy routing —
 * czasy dojazdu do przystanków są wtedy nieistotne, a ich użycie jako źródeł
 * fali przepuszczałoby spacer przez wodę (dojście do przystanku liczy się
 * w linii prostej). Przełącznik „Uwzględnij spacer" traci w tym trybie sens.
 */
const isWalkOnly = () => cityCfg().veh.every(g => !state.veh[g.key]);

// --- stan z adresu URL (linki do udostępniania) -----------------------------

let pointFromUrl = false;
let dayFromUrl = false; // ?day= w adresie: nie podsuwamy przełączenia typu dnia
{
  const u = parseUrlState(location.search, CITIES);
  if (u.city) state.city = u.city;
  state.point = L.latLng(...cityCfg().pointA);
  state.point2 = L.latLng(...cityCfg().pointB);
  state.veh = defaultVeh();

  if (u.point) { state.point = L.latLng(u.point.lat, u.point.lng); pointFromUrl = true; }
  if (u.point2) state.point2 = L.latLng(u.point2.lat, u.point2.lng);
  for (const k of ['compare', 'direction', 'walk', 'access', 'mode', 'timeMin', 'day', 'stats', 'safe']) {
    if (k in u) state[k] = u[k];
  }
  dayFromUrl = u.dayFromUrl;
  if (u.veh) for (const k of Object.keys(state.veh)) state.veh[k] = u.veh.has(k);
}

function updateUrl() {
  history.replaceState(null, '', buildQuery(state));
}

// --- mapa ---------------------------------------------------------------

const map = createMap('map', cityCfg().center, cityCfg().zoom);
const zoneLayer = new ZoneLayer().addTo(map);

const marker = L.marker(state.point, { draggable: true, autoPan: true }).addTo(map);
marker.on('dragend', () => setPoint(marker.getLatLng()));

// drugi znacznik (tryb porównania) — pomarańczowy
const marker2 = L.marker(state.point2, {
  draggable: true,
  autoPan: true,
  icon: L.icon({
    iconUrl: 'vendor/leaflet/images/marker-icon.png',
    iconRetinaUrl: 'vendor/leaflet/images/marker-icon-2x.png',
    shadowUrl: 'vendor/leaflet/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    shadowSize: [41, 41],
    className: 'marker-b',
  }),
});
marker2.on('dragend', () => setPoint2(marker2.getLatLng()));

// w trybie porównania klik przesuwa znacznik bliższy miejscu kliknięcia
map.on('click', e => {
  if (!state.compare) { setPoint(e.latlng); return; }
  const dA = distM(e.latlng.lat, e.latlng.lng, state.point.lat, state.point.lng);
  const dB = distM(e.latlng.lat, e.latlng.lng, state.point2.lat, state.point2.lng);
  if (dA <= dB) setPoint(e.latlng);
  else setPoint2(e.latlng);
});

function setPoint(latlng, pan = false) {
  dismissIntro();
  state.point = latlng;
  marker.setLatLng(latlng);
  if (pan) map.setView(latlng, Math.max(map.getZoom(), 13), { animate: !prefersReducedMotion() });
  recompute();
}

function setPoint2(latlng, pan = false) {
  dismissIntro();
  state.point2 = latlng;
  marker2.setLatLng(latlng);
  if (pan) map.setView(latlng, Math.max(map.getZoom(), 13), { animate: !prefersReducedMotion() });
  recompute();
}

// --- kontrolki ------------------------------------------------------------

const $ = id => document.getElementById(id);

for (const el of document.querySelectorAll('input[name="appmode"]')) {
  el.addEventListener('change', () => {
    state.compare = el.value === 'compare';
    syncModeUi();
    recompute();
  });
}
for (const el of document.querySelectorAll('input[name="direction"]')) {
  el.addEventListener('change', () => { state.direction = el.value; renderSafeNote(); recompute(); });
}
for (const el of document.querySelectorAll('input[name="mode"]')) {
  el.addEventListener('change', () => {
    state.mode = el.value;
    $('timeRow').hidden = state.mode !== 'time';
    recompute();
  });
}
$('walkToggle').addEventListener('change', e => {
  state.walk = e.target.checked;
  syncWalkToggle();
  recompute();
});
$('accessSelect').addEventListener('change', e => { state.access = e.target.value; recompute(); });

/** Buduje checkboxy środków transportu dla bieżącego miasta. */
function renderVehControls() {
  const grid = $('vehGrid');
  grid.innerHTML = '';
  // przy jednym środku transportu filtr nie ma sensu — ukryj całą sekcję
  grid.closest('fieldset').hidden = cityCfg().veh.length < 2;
  for (const group of cityCfg().veh) {
    const label = document.createElement('label');
    label.className = 'veh';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.veh[group.key] !== false;
    input.addEventListener('change', () => {
      state.veh[group.key] = input.checked;
      syncWalkToggle();
      recompute();
    });
    const span = document.createElement('span');
    span.textContent = group.label;
    label.append(input, span);
    grid.appendChild(label);
  }
  syncWalkToggle();
}

/**
 * W trybie „tylko pieszo" spacer jest jedynym środkiem lokomocji, więc
 * przełącznik „Uwzględnij spacer" nic nie zmienia — wygaszamy go, żeby nie
 * sugerował działania (stan w `state.walk` zostaje nietknięty, wraca sam
 * po zaznaczeniu dowolnego pojazdu). Wybór środka dojścia (pieszo/rower)
 * ma sens tylko wtedy, gdy dojście w ogóle jest liczone.
 */
function syncWalkToggle() {
  const walkOnly = isWalkOnly();
  $('walkToggle').disabled = walkOnly;
  $('walkToggle').closest('fieldset').classList.toggle('dimmed', walkOnly);
  const sel = $('accessSelect');
  sel.value = state.access;
  sel.disabled = walkOnly || !state.walk;
}

$('safeToggle').addEventListener('change', e => { state.safe = e.target.checked; renderSafeNote(); recompute(); });
$('statsToggle').addEventListener('change', e => {
  state.stats = e.target.checked;
  syncModeUi();
  recompute();
});
$('timeInput').addEventListener('change', e => {
  const [h, m] = e.target.value.split(':').map(Number);
  if (!Number.isNaN(h)) { state.timeMin = h * 60 + m; recompute(); }
});
$('daySelect').addEventListener('change', e => { state.day = e.target.value; renderDayInfo(); recompute(); });

/** Dostosowuje panel do trybu: pola punktu B, statystyki, podpowiedź, znacznik. */
function syncModeUi() {
  $('searchRow2').hidden = !state.compare;
  if (!state.compare) {
    $('searchResults2').hidden = true;
    $('searchStatus2').textContent = '';
    $('searchInput2').setAttribute('aria-expanded', 'false');
    $('searchInput2').removeAttribute('aria-activedescendant');
  }
  $('statsToggleRow').hidden = state.compare;
  $('statsBox').hidden = state.compare || !state.stats;
  $('hint').innerHTML = (state.compare
    ? 'Strefa pokazuje, dokąd dotrzecie <strong>oboje</strong>. Klik na mapie przesuwa bliższy znacznik.'
    : 'Kliknij punkt na mapie albo przeciągnij znacznik.')
    + ' Prawy klik / przytrzymanie pokazuje trasę.';
  if (state.compare) marker2.addTo(map);
  else marker2.remove();
}

// --- wyszukiwarka adresów, lokalizacja, udostępnianie ------------------------

async function searchAddress(query) {
  // viewbox Nominatim = lonW,latN,lonE,latS — liczony z bbox miasta [latS, lonW, latN, lonE]
  const [latS, lonW, latN, lonE] = cityCfg().bbox;
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5' +
    '&accept-language=pl&countrycodes=pl' +
    `&viewbox=${lonW},${latN},${lonE},${latS}&bounded=1` + // okolice wybranego miasta
    '&q=' + encodeURIComponent(query);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Nominatim: ${r.status}`);
  return r.json();
}

// Ostatnio wybrane punkty (Z-015): pamięć funkcjonalna w localStorage, wzorzec
// try/catch jak consentGet — bez pamięci funkcja milczy. Wpis tworzy wyłącznie
// wybór z listy wyników (klik w mapę, GPS i adres z linku nie mają etykiety).
function loadRecent() {
  try { return parseRecentPoints(localStorage.getItem(RECENT_POINTS_KEY)); } catch { return []; }
}
function saveRecent(list) {
  try { localStorage.setItem(RECENT_POINTS_KEY, serializeRecentPoints(list)); } catch { /* brak pamięci = bez historii */ }
}
function rememberPoint(label, latlng) {
  saveRecent(pushRecentPoint(loadRecent(), {
    label, lat: latlng.lat, lng: latlng.lng, city: state.city, ts: Date.now(),
  }));
}
function clearRecent() { saveRecent([]); }

// Indeks nazw przystanków (Z-056): buduje go silnik (worker trzyma sieć), tu tylko
// leniwie, raz na miasto+dzień. Przed gotowością miasta albo przy błędzie: null
// (wyszukiwarka działa wtedy jak dotąd — samym geokoderem).
const stopIdx = createAsyncCache(3); // klucz miasto/dzień; trzy typy dnia mieszczą się w limicie
const stopKey = () => `${state.city}/${state.mode === 'time' ? state.day : 'workday'}`;
async function getStopIndex() {
  if (!cityReady) return null;
  const city = state.city;
  const dayKey = state.mode === 'time' ? state.day : 'workday';
  const ix = await stopIdx.get(`${city}/${dayKey}`, () => engine.stopIndex(dayKey));
  return state.city === city ? ix : null;
}
/** Przystanki z już zbudowanego indeksu (bez czekania) — pusto, gdy go jeszcze nie ma. */
const cachedStops = query => searchStops(stopIdx.peek(stopKey()), query);

/**
 * Podpina wyszukiwarkę adresu pod pole tekstowe i listę wyników.
 * Klawiatura: Enter szuka (albo wybiera podświetlony wynik), ↑/↓ przesuwają
 * podświetlenie, Escape zamyka listę; klik poza listą też ją zamyka.
 * Pisanie (od 2 znaków) pokazuje od razu przystanki z danych już wczytanych
 * (bez sieci); Enter dokłada adresy z geokodera pod przystankami (Z-056).
 */
function attachSearch(inputId, listId, statusId, onPick) {
  const input = $(inputId), ul = $(listId);
  // czysta etykieta trzymana osobno od tekstu <li> (nagłówek i „Wyczyść" nie wpadną do pola)
  let rows = []; // [{li, latlng, label, kind}] — kind: 'result' | 'recent' | 'clear'
  let active = -1;
  let seq = 0;        // numer zapytania — spóźnione odpowiedzi są pomijane
  let typeTimer = 0;  // debounce pisania (150 ms), żeby role=status nie gadał co znak
  // komunikat „brak wyników" żyje poza listboxem (li.empty nie byłby poprawnym dzieckiem)
  const status = $(statusId);
  const hide = () => {
    clearTimeout(typeTimer);
    seq++;
    ul.hidden = true;
    status.textContent = '';
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const highlight = i => {
    active = i;
    if (i >= 0) input.setAttribute('aria-activedescendant', rows[i].li.id);
    else input.removeAttribute('aria-activedescendant');
    rows.forEach((r, k) => {
      r.li.classList.toggle('active', k === i);
      r.li.setAttribute('aria-selected', String(k === i));
    });
    if (i >= 0) rows[i].li.scrollIntoView({ block: 'nearest' });
  };
  const pick = i => {
    const r = rows[i];
    if (!r) return;
    hide();
    if (r.kind === 'clear') {
      clearRecent();
      status.textContent = 'Historia wyczyszczona.';
      return;
    }
    input.value = r.label;
    status.textContent = `Ustawiono punkt: ${r.label}.`;
    rememberPoint(r.label, r.latlng);
    onPick(r.latlng);
  };
  // historia ostatnich punktów (Z-015): w tym samym listboxie, na pustym polu
  const showHistory = () => {
    const items = recentForCity(loadRecent(), state.city);
    if (!items.length) { hide(); return; }
    ul.innerHTML = '';
    rows = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    status.textContent = '';
    const head = document.createElement('li');
    head.setAttribute('role', 'presentation');
    head.className = 'recent-head';
    head.textContent = 'Ostatnie punkty';
    ul.appendChild(head);
    const add = (li, extra) => {
      const i = rows.length;
      li.id = optionId(listId, i);
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.addEventListener('click', () => pick(i));
      ul.appendChild(li);
      rows.push({ li, ...extra });
    };
    for (const e of items) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'recent-label';
      span.textContent = e.label;
      span.title = e.label;
      li.appendChild(span);
      add(li, { latlng: L.latLng(e.lat, e.lng), label: e.label, kind: 'recent' });
    }
    const clear = document.createElement('li');
    clear.className = 'recent-clear';
    clear.textContent = 'Wyczyść historię';
    clear.setAttribute('aria-label', 'Wyczyść historię ostatnich punktów');
    add(clear, { kind: 'clear' });
    ul.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  /** @param items scalona lista [{label, lat, lng, source}] — numeracja id po tej tablicy */
  const showResults = (items, statusText = '') => {
    ul.innerHTML = '';
    rows = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    if (!items.length) {
      ul.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      status.textContent = statusText;
      return;
    }
    status.textContent = statusText;
    ul.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    items.forEach((item, i) => {
      const kind = item.source === 'stop' ? 'przystanek' : 'adres';
      const li = document.createElement('li');
      li.id = optionId(listId, i);
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.setAttribute('aria-label', `${item.label}, ${kind}`);
      const icon = document.createElement('span');
      icon.className = 'res-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = item.source === 'stop' ? '🚏' : '📍';
      const name = document.createElement('span');
      name.className = 'res-name';
      name.textContent = item.label;
      name.title = item.label;
      const chip = document.createElement('span');
      chip.className = 'res-kind';
      chip.textContent = kind;
      li.append(icon, name, chip);
      li.addEventListener('click', () => pick(i));
      ul.appendChild(li);
      rows.push({ li, latlng: L.latLng(item.lat, item.lng), label: item.label, kind: 'result' });
    });
  };
  const stopItems = stops => mergeSearchResults(stops, []);
  // wyniki z pisania: tylko przystanki, zero zapytań sieciowych
  const typeSearch = async () => {
    const mine = ++seq;
    const query = input.value.trim();
    const len = normalizeStopQuery(query).length;
    if (!query) return;
    if (len < STOP_QUERY_MIN) {
      showResults([], 'Wpisz co najmniej 2 znaki.');
      return;
    }
    const index = await getStopIndex();
    if (mine !== seq) return;
    if (!index) { showResults([], ''); return; } // dane miasta jeszcze się ładują
    const stops = searchStops(index, query);
    showResults(stopItems(stops), stops.length
      ? 'Enter szuka też adresów.'
      : 'Brak przystanku o takiej nazwie — naciśnij Enter, aby poszukać adresu.');
  };
  input.addEventListener('keydown', async e => {
    const open = !ul.hidden && rows.length > 0;
    if (e.key === 'Escape') { hide(); return; }
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      highlight((active + d + rows.length) % rows.length);
      return;
    }
    if (e.key !== 'Enter') return;
    if (open && active >= 0) { pick(active); return; }
    const query = input.value.trim();
    if (query.length < ADDRESS_QUERY_MIN) {
      // lista przystanków (jeśli jest) zostaje; tylko komunikat pod polem.
      // Odroczone wyszukiwanie z pisania doganiamy teraz, żeby nie nadpisało komunikatu.
      if (!query) return;
      clearTimeout(typeTimer);
      await typeSearch();
      status.textContent = ADDRESS_QUERY_HINT;
      return;
    }
    clearTimeout(typeTimer);
    const mine = ++seq;
    const stops = cachedStops(query);
    // przystanki zostają na ekranie na czas zapytania (bez migania listy)
    if (stops.length) showResults(stopItems(stops), 'Szukam adresu…');
    else status.textContent = 'Szukam adresu…';
    try {
      const found = await searchAddress(query);
      if (mine !== seq) return;
      const places = found.map(item => ({
        label: item.display_name.split(', ').slice(0, 4).join(', '), lat: +item.lat, lng: +item.lon,
      }));
      const merged = mergeSearchResults(stops, places);
      showResults(merged, merged.length ? '' : 'Nie znaleziono — spróbuj doprecyzować.');
    } catch (err) {
      console.error(err);
      if (mine !== seq) return;
      status.textContent = stops.length
        ? 'Wyszukiwarka adresów niedostępna — pokazuję tylko przystanki.'
        : 'Wyszukiwarka adresów niedostępna.';
    }
  });
  input.addEventListener('input', () => {
    clearTimeout(typeTimer);
    if (!input.value) { hide(); showHistory(); return; }
    seq++; // unieważnia trwające zapytanie z poprzedniego tekstu
    typeTimer = setTimeout(typeSearch, 150);
  });
  input.addEventListener('focus', () => {
    if (!input.value && ul.hidden) showHistory();
  });
  document.addEventListener('click', e => {
    if (!ul.hidden && !ul.contains(e.target) && e.target !== input) hide();
  });
}

attachSearch('searchInput', 'searchResults', 'searchStatus', latlng => setPoint(latlng, true));
attachSearch('searchInput2', 'searchResults2', 'searchStatus2', latlng => setPoint2(latlng, true));

// Lokalizacja (Z-002): geolokalizacja istnieje tylko w bezpiecznym kontekście.
// Dwie intencje, dwa przyciski: #locateBtn ustawia punkt startowy i przelicza,
// kontrolka na mapie tylko wyśrodkowuje widok (dymek kółka ma „Ustaw tu…").
const geoAvailable = window.isSecureContext && !!navigator.geolocation;

/** Komunikat w #status + ogłoszenie dla czytnika (debounce 1 s: szybka odpowiedź kasuje „Ustalam…"). */
function say(text) {
  $('status').textContent = text;
  announce(text);
}

/** Pozycja poza bieżącym miastem → komunikat z propozycją najbliższego; true = poza. */
function warnIfOutsideCity(lat, lng) {
  if (inBbox(lat, lng, cityCfg().bbox)) return false;
  const near = nearestCity(lat, lng, CITIES);
  say(`Jesteś poza obszarem: ${cityCfg().name}.` +
    (near && near !== state.city ? ` Najbliższe miasto: ${CITIES[near].name}.` : ''));
  return true;
}

if (geoAvailable) {
  $('locateBtn').addEventListener('click', () => {
    say('Ustalam lokalizację…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (warnIfOutsideCity(lat, lng)) return;
        setPoint(L.latLng(lat, lng), true);
      },
      err => { say(geoErrorMessage(err?.code)); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  addLocateControl(map, {
    label: 'Wyśrodkuj na mnie',
    onLocate: ll => { warnIfOutsideCity(ll.lat, ll.lng); },
    onError: msg => { say(msg); },
    onSetStart: ll => {
      if (!warnIfOutsideCity(ll.lat, ll.lng)) setPoint(ll, true);
    },
  });
} else {
  // aria-disabled zamiast disabled: przycisk zostaje w kolejności tabulatora,
  // a czytnik odczyta powód z aria-describedby (trwały tekst #locateHint)
  const btn = $('locateBtn');
  const hint = $('locateHint');
  hint.textContent = locateUnavailableReason(window.isSecureContext, !!navigator.geolocation);
  hint.hidden = false;
  btn.setAttribute('aria-disabled', 'true');
  btn.setAttribute('aria-describedby', 'locateHint');
  btn.removeAttribute('title');
}

$('shareBtn').addEventListener('click', async () => {
  const btn = $('shareBtn');
  const ta = $('shareText');
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = 'Skopiowano ✓';
    ta.hidden = true;
  } catch {
    // ostateczność (HTTP, iframe, odmowa): trwałe pole z zaznaczonym adresem — Ctrl+C
    ta.value = location.href;
    ta.hidden = false;
    ta.focus();
    ta.select();
    say('Nie udało się skopiować automatycznie — adres jest zaznaczony w polu, naciśnij Ctrl+C.');
  }
  setTimeout(() => { btn.textContent = 'Kopiuj link'; }, 2000);
});

// Eksport stref do GeoJSON (Z-008): źródłem są wektorowe obrysy z fazy
// „contours" — te same, które rysuje mapa. Zero zależności: Blob + <a download>.
let exportContours = null;
const EXPORT_LABEL = 'Pobierz strefy';

function setExportReady(contours) {
  exportContours = contours;
  const btn = $('exportBtn');
  btn.disabled = !contours;
  btn.title = contours ? '' : 'Najpierw przelicz zasięg';
}

$('exportBtn').addEventListener('click', async () => {
  const btn = $('exportBtn');
  if (!exportContours || btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Przygotowuję plik…';
  // oddaj sterowanie, żeby etykieta zdążyła się narysować przed pracą
  await new Promise(r => setTimeout(r, 0));
  try {
    const now = warsawNow();
    const dayKey = state.mode === 'time' ? state.day : 'workday';
    const geo = zonesToGeoJSON(exportContours, {
      city: state.city,
      city_name: cityCfg().name,
      point: [state.point.lat, state.point.lng],
      point2: state.compare ? [state.point2.lat, state.point2.lng] : undefined,
      compare: state.compare,
      direction: state.direction,
      mode: state.mode,
      time: state.mode === 'time' ? fmtClock(state.timeMin) : null,
      day: state.mode === 'time' ? state.day : null,
      walk: state.walk,
      access: state.access,
      vehicles: Object.keys(state.veh).filter(k => state.veh[k]),
      cautious: state.safe,
      feed_date: cityMeta?.dates?.[dayKey] ?? null,
      generated: new Date().toISOString(),
    });
    const name = exportFileName(state, now.ymd);
    const url = URL.createObjectURL(new Blob([JSON.stringify(geo)], { type: 'application/geo+json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(`Zapisano plik ${name}.`);
    btn.textContent = 'Pobrano ✓';
    setTimeout(() => { btn.textContent = EXPORT_LABEL; }, 2000);
  } catch (err) {
    console.error(err);
    say('Nie udało się przygotować pliku — spróbuj ponownie.');
    btn.textContent = EXPORT_LABEL;
  }
  btn.removeAttribute('aria-busy');
  btn.disabled = !exportContours;
});

// Wskazówka pierwszej wizyty (Z-009): niemodalna, bo showModal() robi resztę
// dokumentu inert i pasek zgody przestałby być klikalny.
function introSeen() {
  try { return localStorage.getItem('seen-intro'); } catch { return null; }
}
function refreshIntro() {
  $('intro').hidden = !shouldShowIntro({
    seen: introSeen(), consentPending: !$('consentBar').hidden, pointFromUrl,
  });
}
function dismissIntro() {
  $('intro').hidden = true;
  try { localStorage.setItem('seen-intro', '1'); } catch { /* bez pamięci pokaże się przy kolejnej wizycie */ }
}
$('introOk').addEventListener('click', dismissIntro);
$('introHelp').addEventListener('click', () => $('helpDialog').showModal());
// pasek zgody znika po decyzji — wtedy wskazówka może wejść (handler paska działa wcześniej)
for (const id of ['consentYes', 'consentNo']) $(id).addEventListener('click', refreshIntro);

{
  const dialog = $('helpDialog');
  $('helpBtn').addEventListener('click', () => dialog.showModal());
  $('helpClose').addEventListener('click', () => dialog.close());
  // klik w tło (backdrop) zamyka — cel kliknięcia jest wtedy samym <dialog>
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
}

$('collapseBtn').addEventListener('click', () => {
  const panel = $('panel');
  panel.classList.toggle('collapsed');
  const collapsed = panel.classList.contains('collapsed');
  document.body.classList.toggle('panel-collapsed', collapsed);
  $('collapseBtn').textContent = collapsed ? '+' : '−';
  $('collapseBtn').setAttribute('aria-label', collapsed ? 'Rozwiń panel' : 'Zwiń panel');
  $('collapseBtn').setAttribute('aria-expanded', String(!collapsed));
  // od razu, bez announce(): jego debounce 1 s dzieli licznik z podsumowaniem stref
  // i zgubiłby je; region czyszczony przed wstawieniem, żeby powtórka też była czytana
  const live = $('zoneSummary');
  live.textContent = '';
  setTimeout(() => {
    live.textContent = collapsed ? 'Panel zwinięty. Widać samą mapę i legendę.' : 'Panel rozwinięty.';
  }, 50);
});

// wysokość panelu -> --panel-h (offset zoomu i atrybucji na mobile); observer
// odpala się od razu po observe i łapie zwinięcie, zmianę treści, obrót ekranu
if (typeof ResizeObserver !== 'undefined') {
  let lastPanelH = -1;
  new ResizeObserver(() => {
    const h = Math.round($('panel').offsetHeight);
    if (h === lastPanelH) return;
    lastPanelH = h;
    document.documentElement.style.setProperty('--panel-h', h + 'px');
  }).observe($('panel'));
}

// --- zwijane sekcje panelu (Z-059) ---------------------------------------------
// Natywne <details>: otwieranie, klawiatura i stan dla czytnika robi przeglądarka.
// Tu tylko: pamięć stanu (jeden klucz localStorage, nic w adresie URL) i
// podsumowania w nagłówkach (czyste funkcje z uilogic.js).

const sectionPrefs = (() => {
  try { return parseSectionState(localStorage.getItem(PANEL_SECTIONS_KEY)); } catch { return {}; }
})();
const skipSave = new Set(); // sekcje otwarte automatycznie — nie zapisujemy tego jako wyboru użytkownika

for (const id of PANEL_SECTION_IDS) {
  const el = $(id);
  if (sectionPrefs[id] === true) el.open = true;
  el.addEventListener('toggle', () => {
    if (skipSave.delete(id)) return;
    sectionPrefs[id] = el.open;
    try { localStorage.setItem(PANEL_SECTIONS_KEY, serializeSectionState(sectionPrefs)); } catch { /* bez pamięci: układ domyślny */ }
  });
}

/** Otwiera sekcję bez zapisywania tego jako wyboru użytkownika (komunikat wymagający działania). */
function openSectionAuto(id) {
  const el = $(id);
  if (el.open) return;
  skipSave.add(id);
  el.open = true;
}

// domyślne = „gdybym wyszedł teraz” (sprzed stanu z linku), więc opcje z linku dostają znacznik
const initialDefaults = { timeMin: Math.floor(now.minutes / 5) * 5, day: todayDay };
let feedYmd = null;     // data rozkładu wybranego typu dnia (yyyymmdd) — do nagłówka „Dane i kontakt"
let feedStale = false;  // rozkład po terminie ważności

/** Bieżące wartości ustawień w nagłówkach sekcji; `data-changed` + kropka dla odbiegających od domyślnych. */
function renderSections() {
  const views = {
    secTime: timeSectionSummary(state, initialDefaults),
    secAccess: accessSectionSummary({ walk: state.walk, access: state.access, groups: cityCfg().veh, veh: state.veh }),
    secDelay: delaySectionSummary(state),
    secData: dataSectionSummary({ feedDate: feedYmd, stale: feedStale }),
  };
  for (const id of PANEL_SECTION_IDS) {
    const v = views[id];
    $(`${id}Sum`).textContent = v.text;
    $(id).toggleAttribute('data-changed', v.changed);
    $(id).querySelector('.sec-dot').hidden = !v.changed;
    $(`${id}Flag`).hidden = !v.changed;
  }
}

// --- legenda (zawsze widoczna, kompaktowa) -----------------------------------

{
  const bar = $('legendBar');
  const short = ['≤10', '20', '30', '45', '60', '60+'];
  BANDS.forEach((band, i) => {
    const cell = document.createElement('div');
    cell.className = 'legend-cell';
    cell.setAttribute('role', 'listitem');
    cell.setAttribute('aria-label', band.label);
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.setAttribute('aria-hidden', 'true');
    // swatch w tej samej przezroczystości, w jakiej strefa leży na mapie
    sw.style.background = band.color;
    sw.style.opacity = ZONE_ALPHA;
    const label = document.createElement('span');
    label.textContent = short[i];
    cell.append(sw, label);
    bar.appendChild(cell);
  });
}

// --- tabela statystyk ---------------------------------------------------------

function renderStats(rows, showArea) {
  $('areaHead').hidden = !showArea;
  const body = $('statsBody');
  body.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');

    const tdZone = document.createElement('td');
    const cell = document.createElement('span');
    cell.className = 'zone-cell';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.setAttribute('aria-hidden', 'true');
    sw.style.background = row.color;
    sw.style.opacity = ZONE_ALPHA;
    cell.append(sw, row.label);
    tdZone.appendChild(cell);
    tr.appendChild(tdZone);

    const tdDist = document.createElement('td');
    tdDist.className = 'num';
    tdDist.textContent = row.maxKm > 0 ? `${row.maxKm.toFixed(1)} km` : '—';
    tr.appendChild(tdDist);

    if (showArea) {
      const tdArea = document.createElement('td');
      tdArea.className = 'num';
      tdArea.textContent = row.areaPct == null ? '—'
        : row.areaPct >= 9.95 ? `${row.areaPct.toFixed(0)}%` : `${row.areaPct.toFixed(1)}%`;
      tr.appendChild(tdArea);
    }
    body.appendChild(tr);
  }
}

// --- silnik: Web Worker (albo wątek główny, gdy brak OffscreenCanvas) ----------

/**
 * Klient silnika o jednym interfejsie: `setCity`, `compute(params, onPhase)`,
 * `journey(latlng)`, `onWalkNet`. Domyślnie Web Worker — RAPTOR, fala po siatce
 * i obrysy (w GZM ~2 s) schodzą z wątku UI, więc mapa i panel reagują w trakcie
 * liczenia. Gdy przeglądarka nie ma OffscreenCanvas albo modułowych workerów,
 * ten sam `Engine` liczy w wątku głównym (jak dotąd).
 */
function createEngineClient() {
  const canWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
    && !wantsMainEngine(location.search); // ?engine=main — tryb awaryjny do testów
  if (canWorker) {
    try { return createWorkerClient(); } catch (err) { console.warn('Worker niedostępny — liczę w wątku głównym:', err); }
  }
  return createDirectClient();
}

function createDirectClient() {
  const client = { onWalkNet: null, kind: 'direct' };
  const eng = new Engine({
    createCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
    onWalkNet: city => client.onWalkNet?.(city),
  });
  client.setCity = (city, cfg) => eng.setCity(city, cfg);
  client.compute = (params, onPhase) => eng.compute(params, onPhase);
  client.journey = async latlng => eng.journey(latlng);
  client.stopIndex = dayKey => eng.stopIndex(dayKey);
  return client;
}

function createWorkerClient() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pending = new Map(); // id -> {onPhase, resolve, reject}
  let nextId = 1;
  const client = { onWalkNet: null, kind: 'worker' };
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'walknet') { client.onWalkNet?.(m.city); return; }
    if (m.type === 'diag') { report(m.record); return; } // bez id — przed pending.get
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'result') { p.onPhase(m); return; }
    pending.delete(m.id);
    if (m.type === 'error' || m.message) p.reject(new Error(m.message));
    else if (m.type === 'city') p.resolve(m.ok);
    else if (m.type === 'journey') p.resolve(m.result);
    else if (m.type === 'stops') p.resolve(m.index);
    else p.resolve();
  };
  worker.onerror = err => {
    // worker padł (np. brak pliku, błąd modułu) — wszystkie oczekujące
    // wywołania kończą się błędem, a UI przełącza się na wątek główny
    console.error('Worker:', err.message ?? err);
    report({ src: 'worker', msg: err.message ?? 'błąd workera', at: locate(err.filename, err.lineno, err.colno) });
    for (const p of pending.values()) p.reject(new Error('Worker: ' + (err.message ?? 'błąd')));
    pending.clear();
    client.broken = true;
    client.onBroken?.();
  };
  const call = (msg, onPhase) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { onPhase, resolve, reject });
    worker.postMessage({ ...msg, id });
  });
  client.setCity = (city, cfg) => call({ type: 'city', city, cfg });
  client.compute = (params, onPhase) => call({ type: 'compute', params }, onPhase);
  client.journey = latlng => call({ type: 'journey', latlng });
  client.stopIndex = dayKey => call({ type: 'stops', dayKey });
  return client;
}

let engine = createEngineClient();
let cityReady = false; // silnik ma geometrię bieżącego miasta — można liczyć

function attachEngine() {
  engine.onWalkNet = city => { if (city === state.city && cityReady) recompute(); };
  engine.onBroken = () => {
    engine = createDirectClient();
    attachEngine();
    loadCityAssets();
  };
}
attachEngine();

// --- dymek z trasą (prawy klik / przytrzymanie) --------------------------------

let journeyPopup = null; // {popup, latlng} — otwarty dymek, odświeżany po przeliczeniu

map.on('contextmenu', async e => {
  e.originalEvent.preventDefault();
  if (!cityReady) return;
  const latlng = { lat: e.latlng.lat, lng: e.latlng.lng };
  let j = null;
  try { j = await engine.journey(latlng); } catch (err) { console.error(err); }
  if (!j) return;
  const popup = L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(journeyHtml(j)).openOn(map);
  journeyPopup = { popup, latlng };
});

/**
 * Po przeliczeniu otwarty dymek dostaje świeżą trasę zamiast znikać —
 * dotąd dociągnięcie grafu ulic kilka sekund po starcie zamykało dymek,
 * który użytkownik właśnie czytał.
 */
async function refreshJourneyPopup() {
  const jp = journeyPopup;
  if (!jp || !jp.popup.isOpen()) { journeyPopup = null; return; }
  let j = null;
  try { j = await engine.journey(jp.latlng); } catch { /* bez dymka */ }
  if (journeyPopup !== jp || !jp.popup.isOpen()) return;
  if (!j) { map.closePopup(); journeyPopup = null; return; }
  jp.popup.setContent(journeyHtml(j));
}

const VEH_ICON = { 900: '🚊', 0: '🚊', 700: '🚌', 3: '🚌', 800: '🚎', 11: '🚎', 1: '🚇', 2: '🚆' };

/**
 * Ikony dwóch skrajnych etapów podróży. Rower ma ten, kto podróż zaczyna:
 * przy kierunku „z miejsca" jest to punkt użytkownika, przy „do miejsca" —
 * miejsce kliknięte na mapie. Drugi koniec dostaje rower tylko wtedy, gdy
 * jedzie w pojeździe; w wariancie „zostaje na przystanku" idzie się pieszo.
 * Przesiadki w trakcie podróży są zawsze piesze (patrz README).
 */
function accessIcons() {
  return accessIconsFor(state.access, state.direction);
}

/** Lista etapów trasy jako HTML (etapy z nazwami przystanków — patrz Engine.describeLegs). */
function legsHtml(legs, walkMin, targetName) {
  const direction = state.direction;
  const icons = accessIcons();
  const items = [];
  for (const leg of legs) {
    if (leg.kind === 'access') {
      const min = Math.round(leg.durSec / 60);
      if (min >= 1) {
        items.push(direction === 'from'
          ? `${icons.atPoint} ${min} min do przystanku ${esc(leg.stopName)}`
          : `${icons.atPoint} ${min} min od przystanku ${esc(leg.stopName)} do celu`);
      }
    } else if (leg.kind === 'walk') {
      const min = Math.max(1, Math.round(leg.durSec / 60));
      items.push(leg.fromName === leg.toName
        ? `🚶 przesiadka (${min} min)`
        : `🚶 ${min} min do: ${esc(leg.toName)}`);
    } else {
      const icon = VEH_ICON[leg.route.t] ?? '🚌';
      const times = leg.depSec != null
        ? ` · ${HHMM(leg.depSec)}–${HHMM(leg.arrSec)}`
        : ` · ${Math.round(leg.durSec / 60)} min`;
      items.push(`${icon} <strong>${esc(leg.route.n)}</strong>: ${esc(leg.fromName)} → ${esc(leg.toName)}${times}`);
    }
  }
  // spacer między klikniętym miejscem a przystankiem docelowym
  const wm = Math.round(walkMin);
  if (wm >= 1) {
    const walkItem = direction === 'from'
      ? `${icons.atTarget} ${wm} min do celu`
      : `${icons.atTarget} ${wm} min do przystanku ${esc(targetName)}`;
    if (direction === 'from') items.push(walkItem);
    else items.unshift(walkItem);
  }
  return '<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>';
}

function journeyHeader(totalMin) {
  let extra = '';
  if (state.mode === 'time') {
    const clock = state.direction === 'from'
      ? `przyjazd ok. ${HHMM(state.timeMin * 60 + totalMin * 60)}`
      : `wyjście ok. ${HHMM(state.timeMin * 60 - totalMin * 60)}`;
    extra = ` <span class="muted">(${clock})</span>`;
  } else {
    extra = ' <span class="muted">(bez czekania)</span>';
  }
  return `<h4>≈ ${Math.round(totalMin)} min${extra}</h4>`;
}

/** HTML dymka z wyniku `Engine.journey`. */
function journeyHtml(j) {
  const unreach = why => `<div class="journey"><h4>Poza zasięgiem</h4><span class="muted">${esc(why)}</span></div>`;
  if (j.kind === 'walkOnly') {
    // tryb „tylko pieszo": brak przystanków i etapów, czas wprost z fali po lądzie
    if (j.sec == null || j.sec / 60 > 90) return unreach(j.why ?? 'Spacer zająłby ponad 90 minut.');
    const who = state.compare ? ' (wolniejsza osoba)' : '';
    return `<div class="journey">${journeyHeader(j.sec / 60)}<ol><li>🚶 ${Math.round(j.sec / 60)} min pieszo${who}</li></ol></div>`;
  }
  if (j.kind === 'unreach') return unreach(j.reason);
  if (j.kind === 'single') {
    return `<div class="journey">${journeyHeader(j.total)}${j.legs ? legsHtml(j.legs, j.walkMin, j.targetName) : ''}</div>`;
  }
  const parts = j.persons.map((p, i) => {
    const [cls, name] = i === 0 ? ['dot-a', 'Punkt niebieski'] : ['dot-b', 'Punkt pomarańczowy'];
    return `<div class="person"><span class="dot ${cls}"></span>${name} · ≈ ${Math.round(p.totalMin)} min</div>`
      + (p.legs ? legsHtml(p.legs, j.walkMin, j.targetName) : '<span class="muted">brak trasy</span>');
  });
  return `<div class="journey"><h4>Wspólny czas: ≈ ${Math.round(j.total)} min</h4>${parts.join('')}</div>`;
}

// --- przeliczanie -------------------------------------------------------------

let computeSeq = 0;

/** Czytelny opis bieżącego widoku do paska statusu. */
/**
 * Komunikat dla czytników ekranu (#zoneSummary, Z-045): z opóźnieniem 1 s od
 * ostatniego wywołania, żeby seria przeliczeń (suwak godziny, przeciąganie
 * markera) dała jeden komunikat. Region czyszczony przed wstawieniem tekstu —
 * inaczej czytnik pomija identyczny komunikat powtórzony drugi raz.
 */
let announceTimer = 0;
function cancelAnnounce() { clearTimeout(announceTimer); }
function announce(text) {
  cancelAnnounce();
  announceTimer = setTimeout(() => {
    const el = $('zoneSummary');
    el.textContent = '';
    setTimeout(() => { el.textContent = text; }, 50);
  }, 1000);
}

function statusText(walkOnly) {
  return statusLine({
    walkOnly, compare: state.compare, direction: state.direction, mode: state.mode, safe: state.safe,
    whenTime: `${DAY_LABELS[state.day]}, ${$('timeInput').value}`,
  });
}

/**
 * Przeliczenie w silniku. Wynik przychodzi w dwóch fazach: raster + koła
 * + statystyki (szybko), potem obrysy wektorowe. Nowsze żądanie unieważnia
 * starsze (`computeSeq`) — spóźnione fazy są ignorowane.
 */
async function recompute() {
  renderSections(); // nagłówki sekcji pokazują bieżące ustawienia także w trakcie wczytywania miasta
  if (!cityReady) return; // loadCityAssets uruchomi przeliczenie, gdy miasto będzie gotowe
  const seq = ++computeSeq;
  const t0 = performance.now();
  setExportReady(null); // niegotowy do końca fazy „contours"
  $('shareText').hidden = true; // pole awaryjnego linku pokazywałoby nieaktualny adres
  updateUrl();
  const status = $('status');
  cancelAnnounce(); // nie ogłaszamy „Obliczam zasięg…" ani wyniku poprzedniego przeliczenia
  status.textContent = 'Obliczam zasięg…';
  const walkOnly = isWalkOnly();
  const types = allowedTypes();
  const params = {
    city: state.city,
    dayKey: state.mode === 'time' ? state.day : 'workday', // tryb ogólny zawsze na dniu roboczym
    direction: state.direction,
    walk: state.walk,
    access: state.access,
    mode: state.mode,
    timeMin: state.timeMin,
    types: types ? [...types] : null,
    cautious: state.safe,
    walkOnly,
    compare: state.compare,
    point: { lat: state.point.lat, lng: state.point.lng },
    point2: { lat: state.point2.lat, lng: state.point2.lng },
    stats: state.stats && !state.compare,
  };
  try {
    await engine.compute(params, msg => {
      if (seq !== computeSeq) return; // w międzyczasie przyszło nowsze zapytanie
      if (msg.phase === 'zones') {
        zoneLayer.update({
          grid: msg.image ? { canvas: msg.image, ...msg.bbox } : null,
          zones: msg.zones,
          contours: null,
        });
        if (msg.stats) renderStats(msg.stats, state.walk || walkOnly);
        status.textContent = (msg.reachable === 0 && !walkOnly)
          ? 'Brak przystanków w zasięgu — wybierz punkt bliżej miasta.'
          : statusText(walkOnly);
        announce(zoneSummaryText({
          statusText: statusText(walkOnly), city: cityCfg().name, reachable: msg.reachable,
          walkOnly, compare: state.compare, stats: msg.stats, showArea: state.walk || walkOnly,
        }));
        refreshJourneyPopup();
        if (shouldVibrate({
          supported: typeof navigator.vibrate === 'function',
          reduceMotion: prefersReducedMotion(),
          elapsedMs: performance.now() - t0,
          // brak API (undefined) nie blokuje; Chrome blokuje vibrate bez aktywacji i loguje interwencję
          userActivated: navigator.userActivation?.hasBeenActive,
        })) navigator.vibrate(20);
      } else if (msg.phase === 'contours') {
        zoneLayer.update({ contours: msg.contours });
        setExportReady(msg.contours);
      }
    });
  } catch (err) {
    console.error(err);
    if (seq === computeSeq) {
      status.textContent = loadErrorMessage(navigator.onLine, 'Błąd wczytywania danych rozkładowych.');
      announce(status.textContent);
    }
  }
}

// --- miasto: zasoby (geometria, statystyki, stopka) i przełączanie -------------

function renderCredits() {
  $('creditsLinks').innerHTML = cityCfg().credits
    .map(c => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label)}</a>`)
    .join(' · ');
}

/** Dzisiejsza data (Europa/Warszawa) jako yyyymmdd — do porównania z datami z meta.json. */
const todayKey = () => warsawNow().ymd;

let cityMeta = null;       // meta bieżącego miasta (null: brak albo jeszcze się wczytuje)
let cityMetaReady = false; // applyMeta już zadziałało dla bieżącego miasta

/**
 * Stopka (data wybranego typu dnia, dopisek o reżimie) i komunikat #dayNote.
 * Wołana z applyMeta i przy zmianie typu dnia — bez ponownego pobierania meta.
 * Domyślny typ dnia zostaje po dniu tygodnia; w święto tylko proponujemy
 * przełączenie na niedzielę (nie przy ?day= w adresie).
 */
function renderDayInfo() {
  if (!cityMetaReady) return;
  const today = warsawNow();
  const n = dayDataNotice(cityMeta, state.day, today.ymd);
  const view = dayInfoView(n, { dayFromUrl, day: state.day, todayDay });
  feedYmd = n.date ?? null;
  $('feedDate').textContent = view.feedDate;
  $('feedDateNote').textContent = view.feedDateNote;

  const note = $('dayNote');
  // komunikat wymagający działania (np. „Pokaż niedzielę”) otwiera swoją sekcję — raz na nowy tekst
  if (view.text && view.text !== note.dataset.shown) openSectionAuto('secTime');
  note.dataset.shown = view.text;
  note.textContent = view.text;
  if (view.offerSunday) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Pokaż niedzielę';
    btn.addEventListener('click', () => {
      state.day = 'sunday';
      $('daySelect').value = 'sunday';
      renderDayInfo();
      recompute();
    });
    note.append(' ', btn);
  }
}

/**
 * Metadane builda → stopka, ostrzeżenie o nieaktualnym rozkładzie i lista
 * typów dnia. Rozkład ma termin ważności (`feedEndDate`); po jego minięciu
 * wyniki pochodzą ze starego (np. wakacyjnego) rozkładu i trzeba to powiedzieć
 * wprost. Typ dnia, którego build nie wygenerował (np. feed za krótki, żeby
 * trafić w weekend), jest wyłączany w selektorze zamiast kończyć się błędem
 * albo starym plikiem z poprzedniego builda.
 */
function applyMeta(meta) {
  const dates = meta?.dates ?? {};
  const end = fmtDate(meta?.feedEndDate);
  $('feedEnd').textContent = end ?? '—';

  const stale = !!meta?.feedEndDate && meta.feedEndDate < todayKey();
  feedStale = stale;
  const warn = $('dataWarn');
  warn.hidden = !stale;
  warn.textContent = stale
    ? `Uwaga: rozkład tego miasta jest nieaktualny (ważny do ${end}). Wyniki mogą odbiegać od dzisiejszych kursów.`
    : '';

  // typy dnia: bez meta nie wiemy nic → wszystko dozwolone (jak dotąd)
  const available = meta ? DAY_KEYS.filter(k => dates[k]) : DAY_KEYS.slice();
  const sel = $('daySelect');
  for (const opt of sel.options) opt.disabled = !available.includes(opt.value);
  if (available.length && !available.includes(state.day)) {
    state.day = available.includes('workday') ? 'workday' : available[0];
    sel.value = state.day;
  }
  cityMeta = meta;
  cityMetaReady = true;
  renderDayInfo();
  renderDelayCoverage();
  renderSections();
}

/** Stan pokrycia profilami opóźnień bieżącego miasta (kontrakt: delayCoverage w data.js). */
const coverage = () => delayCoverage(cityMeta, cityCfg());

/**
 * Stopka: ile linii ma profile opóźnień. Ułamek „N z M", nigdy procent —
 * przy feedach zbiorczych M obejmuje też koleje. Stan `unknown` (stare meta.json
 * bez pola): wpis ukryty, stopka wygląda jak dawniej.
 */
function renderDelayCoverage() {
  const text = delayCoverageText(coverage());
  $('delayCoverage').textContent = text;
  $('delayCoverageRow').hidden = !text;
  renderSafeNote();
}

/**
 * Podpowiedź pod przełącznikiem trybu ostrożnego (tylko gdy włączony). Przy
 * stanie `unknown` milczy o pokryciu. Kierunek „do miejsca" dostaje zawsze
 * szacunek — router.js wyłącza profile dla direction === 'to'.
 */
function renderSafeNote() {
  $('safeNote').textContent = safeNoteText({ safe: state.safe, coverage: coverage(), direction: state.direction });
}

/**
 * Wczytuje miasto: meta + maska wody dla mapy (małe pliki, wątek główny),
 * geometria siatki i graf ulic w silniku. Pierwsze rysowanie po geometrii,
 * drugie — gdy silnik zgłosi graf ulic (`onWalkNet`).
 */
async function loadCityAssets() {
  const key = state.city;
  cityReady = false;
  $('areaHead').textContent = cityCfg().areaLabel;
  renderCredits();
  renderVehControls();
  cityMeta = null;
  cityMetaReady = false;
  feedYmd = null;
  feedStale = false;
  $('dayNote').dataset.shown = '';
  renderSections();
  $('feedDate').textContent = '…';
  $('feedDateNote').textContent = '';
  $('dayNote').textContent = '';
  $('delayCoverage').textContent = '';
  $('delayCoverageRow').hidden = true;
  $('feedEnd').textContent = '…';
  $('status').textContent = 'Wczytuję dane miasta…';

  // loadery zwracają null przy braku pliku/błędzie — nic tu nie rzuca
  const [meta, water] = await Promise.all([loadMeta(key), loadWater(key)]);
  if (state.city !== key) return; // w międzyczasie zmieniono miasto
  applyMeta(meta);
  zoneLayer.setWater(water ?? { polys: [], lines: [] });
  try {
    const ok = await engine.setCity(key, cityCfg());
    if (!ok || state.city !== key) return;
  } catch (err) {
    console.error(err);
    report({ src: 'app', msg: err?.message ?? String(err), ctx: { phase: 'city' } });
    if (state.city === key) {
      $('status').textContent = loadErrorMessage(navigator.onLine, 'Błąd wczytywania danych miasta.');
      announce($('status').textContent);
    }
    return;
  }
  cityReady = true;
  recompute();
}

function switchCity(key) {
  if (!CITIES[key] || key === state.city) return;
  const prev = state.city;
  state.city = key;
  state.veh = defaultVeh();
  state.point = L.latLng(...cityCfg().pointA);
  state.point2 = L.latLng(...cityCfg().pointB);
  marker.setLatLng(state.point);
  marker2.setLatLng(state.point2);
  for (const id of ['searchInput', 'searchInput2']) $(id).value = '';
  for (const id of ['searchResults', 'searchResults2']) $(id).hidden = true;
  map.closePopup();
  map.setView(cityCfg().center, cityCfg().zoom, { animate: !prefersReducedMotion() });
  // zasoby poprzedniego miasta zwalnia silnik (setCity); tu tylko cache
  // meta/wody wątku głównego i warstwa stref
  cityReady = false;
  computeSeq++; // spóźnione fazy poprzedniego miasta do kosza
  zoneLayer.update({ grid: null, contours: null, zones: null });
  setExportReady(null);
  dropCityCache(prev);
  loadCityAssets();
}

{
  const sel = $('citySelect');
  const sorted = Object.entries(CITIES)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'pl'));
  for (const [key, cfg] of sorted) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = cfg.name;
    sel.appendChild(opt);
  }
  sel.value = state.city;
  sel.addEventListener('change', () => switchCity(sel.value));
}

// --- start ---------------------------------------------------------------------

// odtworzenie stanu kontrolek (domyślne wartości albo stan z linku)
$('appSingle').checked = !state.compare;
$('appCompare').checked = state.compare;
$('dirFrom').checked = state.direction === 'from';
$('dirTo').checked = state.direction === 'to';
$('walkToggle').checked = state.walk;
$('modeGeneral').checked = state.mode === 'general';
$('modeTime').checked = state.mode === 'time';
$('timeRow').hidden = state.mode !== 'time';
$('timeInput').value =
  `${String(Math.floor(state.timeMin / 60)).padStart(2, '0')}:${String(state.timeMin % 60).padStart(2, '0')}`;
$('daySelect').value = state.day;
$('statsToggle').checked = state.stats;
$('safeToggle').checked = state.safe;
syncModeUi();
renderSafeNote();
renderSections();
refreshIntro();
// animate:false — animowany zoom bywa przerywany przez invalidateSize
// z ResizeObservera przy starcie i widok zostawał na zoomie domyślnym
if (pointFromUrl) map.setView(state.point, 13, { animate: false });

loadCityAssets(); // samo uruchamia przeliczenie po wczytaniu geometrii

// --- diagnostyka błędów (Z-025) ----------------------------------------------

// ?diag=1 pokazuje blok od razu (pusty); parametr nie trafia do updateUrl
const diagForced = new URLSearchParams(location.search).get('diag') === '1';
let diagShown = false;

/** Rysuje blok diagnostyki; odsłania go przy pierwszym rekordzie spoza `data` albo przy ?diag=1. */
function renderDiag() {
  const recs = records();
  if (!diagShown && (diagForced || recs.some(r => r.src !== 'data'))) {
    diagShown = true;
    $('diagBox').hidden = false;
  }
  if (!diagShown) return;
  $('diagCount').textContent = recs.length;
  const list = $('diagList');
  list.replaceChildren(...recs.reverse().map(r => {
    const li = document.createElement('li');
    li.textContent = `${r.src}${r.n > 1 ? ` ×${r.n}` : ''} — ${r.msg}${r.at ? ` (${r.at})` : ''}`;
    return li;
  }));
}

const gaSent = new Set(); // klucze rekordów już wysłanych do GA (max 1 zdarzenie na klucz)
const GA_MAX_EVENTS = 5;  // limit zdarzeń app_error na sesję

/**
 * Zanonimizowany rekord → GA. Zgodę sprawdzamy przy KAŻDYM zdarzeniu (bez cache)
 * i nigdy nie kolejkujemy zdarzenia w gtag przed zgodą: dataLayer zachowuje wpisy i po
 * późniejszym loadGA() zostałyby wysłane. Rekordy sprzed zgody żyją tylko w buforze.
 * Do GA nie idą współrzędne, wpisany tekst, pełny URL ani user agent.
 */
function sendDiagToGA(rec) {
  try {
    if (window.consentGet?.() === 'granted' && typeof window.gtag === 'function') {
      const key = `${rec.src}|${rec.msg}|${rec.at}`;
      if (gaSent.has(key) || gaSent.size >= GA_MAX_EVENTS) return;
      gaSent.add(key);
      window.gtag('event', 'app_error', {
        error_source: rec.src,
        error_message: rec.msg.slice(0, 100),
        error_where: rec.at,
        error_phase: rec.ctx?.phase ?? '',
        app_city: state.city,
        app_engine: engine.kind,
      });
    }
  } catch { /* diagnostyka nie może psuć strony */ }
}

setSink(rec => { renderDiag(); sendDiagToGA(rec); });
renderDiag();
for (const r of records()) sendDiagToGA(r); // rekordy sprzed startu modułu (zgoda sprawdzana osobno)

$('diagCopy').addEventListener('click', async () => {
  const btn = $('diagCopy');
  const text = formatReport({ city: state.city, day: state.day, mode: state.mode, engine: engine.kind });
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Skopiowano ✓';
  } catch {
    // ostateczność: pokaż tekst do ręcznego skopiowania
    const ta = $('diagText');
    ta.value = text;
    ta.hidden = false;
    ta.focus();
    ta.select();
  }
  setTimeout(() => { btn.textContent = 'Kopiuj raport diagnostyczny'; }, 2000);
});

window.__appReady = true; // skrypt w <head> nie pokaże komunikatu o niedziałającej stronie
