/**
 * Spięcie UI: stan aplikacji, kontrolki, przeliczanie i rysowanie stref.
 */


import { loadMeta, loadWater, loadCities, dropCityCache, DAY_KEYS, DAY_LABELS, distM } from './data.js';
import { BANDS } from './isochrone.js';
import { createMap, ZoneLayer, ZONE_ALPHA } from './map.js';
import { Engine } from './engine.js';

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

const now = new Date();
const todayDay = now.getDay() === 0 ? 'sunday' : now.getDay() === 6 ? 'saturday' : 'workday';

const state = {
  city: DEFAULT_CITY,
  point: null,   // ustawiane z konfiguracji miasta poniżej
  point2: null,
  compare: false,
  direction: 'from',
  walk: true,
  mode: 'time',
  timeMin: now.getHours() * 60 + Math.floor(now.getMinutes() / 5) * 5,
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
{
  const q = new URLSearchParams(location.search);
  if (CITIES[q.get('city')]) state.city = q.get('city');
  state.point = L.latLng(...cityCfg().pointA);
  state.point2 = L.latLng(...cityCfg().pointB);
  state.veh = defaultVeh();

  const p = q.get('p')?.split(',').map(Number);
  if (p?.length === 2 && p.every(Number.isFinite)) {
    state.point = L.latLng(p[0], p[1]);
    pointFromUrl = true;
  }
  const p2 = q.get('p2')?.split(',').map(Number);
  if (p2?.length === 2 && p2.every(Number.isFinite)) state.point2 = L.latLng(p2[0], p2[1]);
  if (q.get('cmp') === '1') state.compare = true;
  if (q.get('dir') === 'to') state.direction = 'to';
  if (q.get('walk') === '0') state.walk = false;
  if (q.get('mode') === 'general') state.mode = 'general';
  const t = q.get('t')?.match(/^(\d{1,2}):(\d{2})$/);
  if (t) state.timeMin = Math.min(+t[1], 23) * 60 + Math.min(+t[2], 59);
  if (['workday', 'saturday', 'sunday'].includes(q.get('day'))) state.day = q.get('day');
  if (q.get('st') === '1') state.stats = true;
  if (q.get('safe') === '1') state.safe = true;
  const veh = q.get('veh');
  if (veh != null) {
    const on = new Set(veh.split(','));
    for (const k of Object.keys(state.veh)) state.veh[k] = on.has(k);
  }
}

function updateUrl() {
  const q = new URLSearchParams();
  q.set('city', state.city);
  q.set('p', `${state.point.lat.toFixed(5)},${state.point.lng.toFixed(5)}`);
  if (state.compare) {
    q.set('cmp', '1');
    q.set('p2', `${state.point2.lat.toFixed(5)},${state.point2.lng.toFixed(5)}`);
  }
  q.set('dir', state.direction);
  q.set('walk', state.walk ? '1' : '0');
  q.set('mode', state.mode);
  if (state.mode === 'time') {
    const h = Math.floor(state.timeMin / 60), m = state.timeMin % 60;
    q.set('t', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    q.set('day', state.day);
  }
  if (state.stats && !state.compare) q.set('st', '1');
  if (state.safe) q.set('safe', '1');
  const vehKeys = Object.keys(state.veh);
  const vehOn = vehKeys.filter(k => state.veh[k]);
  if (vehOn.length < vehKeys.length) q.set('veh', vehOn.join(','));
  history.replaceState(null, '', '?' + q.toString());
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
  state.point = latlng;
  marker.setLatLng(latlng);
  if (pan) map.setView(latlng, Math.max(map.getZoom(), 13));
  recompute();
}

function setPoint2(latlng, pan = false) {
  state.point2 = latlng;
  marker2.setLatLng(latlng);
  if (pan) map.setView(latlng, Math.max(map.getZoom(), 13));
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
  el.addEventListener('change', () => { state.direction = el.value; recompute(); });
}
for (const el of document.querySelectorAll('input[name="mode"]')) {
  el.addEventListener('change', () => {
    state.mode = el.value;
    $('timeRow').hidden = state.mode !== 'time';
    recompute();
  });
}
$('walkToggle').addEventListener('change', e => { state.walk = e.target.checked; recompute(); });

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
 * po zaznaczeniu dowolnego pojazdu).
 */
function syncWalkToggle() {
  const walkOnly = isWalkOnly();
  $('walkToggle').disabled = walkOnly;
  $('walkToggle').closest('fieldset').classList.toggle('dimmed', walkOnly);
}

$('safeToggle').addEventListener('change', e => { state.safe = e.target.checked; recompute(); });
$('statsToggle').addEventListener('change', e => {
  state.stats = e.target.checked;
  syncModeUi();
  recompute();
});
$('timeInput').addEventListener('change', e => {
  const [h, m] = e.target.value.split(':').map(Number);
  if (!Number.isNaN(h)) { state.timeMin = h * 60 + m; recompute(); }
});
$('daySelect').addEventListener('change', e => { state.day = e.target.value; recompute(); });

/** Dostosowuje panel do trybu: pola punktu B, statystyki, podpowiedź, znacznik. */
function syncModeUi() {
  $('searchRow2').hidden = !state.compare;
  if (!state.compare) $('searchResults2').hidden = true;
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

/** Podpina wyszukiwarkę adresu pod pole tekstowe i listę wyników. */
function attachSearch(inputId, listId, onPick) {
  const input = $(inputId), ul = $(listId);
  const showResults = items => {
    ul.innerHTML = '';
    ul.hidden = false;
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Nie znaleziono — spróbuj doprecyzować.';
      ul.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item.display_name.split(', ').slice(0, 4).join(', ');
      li.addEventListener('click', () => {
        ul.hidden = true;
        input.value = li.textContent;
        onPick(L.latLng(+item.lat, +item.lon));
      });
      ul.appendChild(li);
    }
  };
  input.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const query = input.value.trim();
    if (query.length < 3) return;
    try {
      showResults(await searchAddress(query));
    } catch (err) {
      console.error(err);
      $('status').textContent = 'Wyszukiwarka adresów chwilowo niedostępna.';
    }
  });
  input.addEventListener('input', () => {
    if (!input.value) ul.hidden = true;
  });
}

attachSearch('searchInput', 'searchResults', latlng => setPoint(latlng, true));
attachSearch('searchInput2', 'searchResults2', latlng => setPoint2(latlng, true));

$('locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    $('status').textContent = 'Przeglądarka nie udostępnia lokalizacji.';
    return;
  }
  $('status').textContent = 'Ustalam lokalizację…';
  navigator.geolocation.getCurrentPosition(
    pos => setPoint(L.latLng(pos.coords.latitude, pos.coords.longitude), true),
    () => { $('status').textContent = 'Nie udało się pobrać lokalizacji (brak zgody?).'; },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

$('shareBtn').addEventListener('click', async () => {
  const btn = $('shareBtn');
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = 'Skopiowano ✓';
  } catch {
    btn.textContent = location.href; // ostateczność: pokaż link do ręcznego skopiowania
  }
  setTimeout(() => { btn.textContent = 'Kopiuj link do tego widoku'; }, 2000);
});

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
  $('collapseBtn').setAttribute('aria-expanded', String(!collapsed));
});

// --- legenda (zawsze widoczna, kompaktowa) -----------------------------------

{
  const bar = $('legendBar');
  const short = ['≤10', '20', '30', '45', '60', '60+'];
  BANDS.forEach((band, i) => {
    const cell = document.createElement('div');
    cell.className = 'legend-cell';
    const sw = document.createElement('span');
    sw.className = 'swatch';
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
    && new URLSearchParams(location.search).get('engine') !== 'main'; // ?engine=main — tryb awaryjny do testów
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
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'result') { p.onPhase(m); return; }
    pending.delete(m.id);
    if (m.type === 'error' || m.message) p.reject(new Error(m.message));
    else if (m.type === 'city') p.resolve(m.ok);
    else if (m.type === 'journey') p.resolve(m.result);
    else p.resolve();
  };
  worker.onerror = err => {
    // worker padł (np. brak pliku, błąd modułu) — wszystkie oczekujące
    // wywołania kończą się błędem, a UI przełącza się na wątek główny
    console.error('Worker:', err.message ?? err);
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

map.on('contextmenu', async e => {
  e.originalEvent.preventDefault();
  if (!cityReady) return;
  const latlng = { lat: e.latlng.lat, lng: e.latlng.lng };
  let j = null;
  try { j = await engine.journey(latlng); } catch (err) { console.error(err); }
  if (!j) return;
  L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(journeyHtml(j)).openOn(map);
});

/** Sekundy doby → „GG:MM"; ujemne (wyjście przed północą przy „do miejsca") zawijane do poprzedniego dnia. */
const HHMM = s => {
  const d = ((Math.floor(s) % 86400) + 86400) % 86400;
  return `${String(Math.floor(d / 3600)).padStart(2, '0')}:${String(Math.floor(d / 60) % 60).padStart(2, '0')}`;
};
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const VEH_ICON = { 900: '🚊', 0: '🚊', 700: '🚌', 3: '🚌', 800: '🚎', 11: '🚎', 1: '🚇', 2: '🚆' };

/** Lista etapów trasy jako HTML (etapy z nazwami przystanków — patrz Engine.describeLegs). */
function legsHtml(legs, walkMin, targetName) {
  const direction = state.direction;
  const items = [];
  for (const leg of legs) {
    if (leg.kind === 'access') {
      const min = Math.round(leg.durSec / 60);
      if (min >= 1) {
        items.push(direction === 'from'
          ? `🚶 ${min} min do przystanku ${esc(leg.stopName)}`
          : `🚶 ${min} min od przystanku ${esc(leg.stopName)} do celu`);
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
      ? `🚶 ${wm} min do celu`
      : `🚶 ${wm} min do przystanku ${esc(targetName)}`;
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
  const unreach = why => `<div class="journey"><h4>Poza zasięgiem</h4><span class="muted">${why}</span></div>`;
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
function statusText(walkOnly) {
  if (walkOnly) {
    // rozkład i godzina nie mają wpływu na sam spacer
    return state.compare
      ? 'Wspólny zasięg pieszo dwóch punktów.'
      : (state.direction === 'from' ? 'Zasięg pieszo z punktu.' : 'Obszar z dojściem pieszo do punktu.');
  }
  const what = state.compare
    ? (state.direction === 'from' ? 'Wspólny zasięg dwóch punktów' : 'Obszar z dojazdem do obu punktów')
    : (state.direction === 'from' ? 'Zasięg z punktu' : 'Obszar z dojazdem do punktu');
  const when = state.mode === 'time'
    ? `${DAY_LABELS[state.day]}, ${$('timeInput').value}`
    : 'tryb ogólny (bez oczekiwania)';
  const safe = state.safe ? ' · z marginesem na opóźnienia' : '';
  return `${what} · ${when}${safe}.`;
}

/**
 * Przeliczenie w silniku. Wynik przychodzi w dwóch fazach: raster + koła
 * + statystyki (szybko), potem obrysy wektorowe. Nowsze żądanie unieważnia
 * starsze (`computeSeq`) — spóźnione fazy są ignorowane.
 */
async function recompute() {
  if (!cityReady) return; // loadCityAssets uruchomi przeliczenie, gdy miasto będzie gotowe
  const seq = ++computeSeq;
  updateUrl();
  const status = $('status');
  status.textContent = 'Obliczam zasięg…';
  map.closePopup();
  const walkOnly = isWalkOnly();
  const types = allowedTypes();
  const params = {
    city: state.city,
    dayKey: state.mode === 'time' ? state.day : 'workday', // tryb ogólny zawsze na dniu roboczym
    direction: state.direction,
    walk: state.walk,
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
      } else if (msg.phase === 'contours') {
        zoneLayer.update({ contours: msg.contours });
      }
    });
  } catch (err) {
    console.error(err);
    if (seq === computeSeq) status.textContent = 'Błąd wczytywania danych rozkładowych.';
  }
}

// --- miasto: zasoby (geometria, statystyki, stopka) i przełączanie -------------

function renderCredits() {
  $('creditsLinks').innerHTML = cityCfg().credits
    .map(c => `<a href="${c.url}" target="_blank" rel="noopener">${c.label}</a>`)
    .join(' · ');
}

const fmtDate = d => (d && /^\d{8}$/.test(d) ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : null);

/** Dzisiejsza data lokalna jako yyyymmdd — do porównania z datami z meta.json. */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
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
  $('feedDate').textContent = fmtDate(dates.workday) ?? '—';
  const end = fmtDate(meta?.feedEndDate);
  $('feedEnd').textContent = end ?? '—';

  const stale = !!meta?.feedEndDate && meta.feedEndDate < todayKey();
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
  $('feedDate').textContent = '…';
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
    if (state.city === key) $('status').textContent = 'Błąd wczytywania danych miasta.';
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
  map.setView(cityCfg().center, cityCfg().zoom);
  // zasoby poprzedniego miasta zwalnia silnik (setCity); tu tylko cache
  // meta/wody wątku głównego i warstwa stref
  cityReady = false;
  computeSeq++; // spóźnione fazy poprzedniego miasta do kosza
  zoneLayer.update({ grid: null, contours: null, zones: null });
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
// animate:false — animowany zoom bywa przerywany przez invalidateSize
// z ResizeObservera przy starcie i widok zostawał na zoomie domyślnym
if (pointFromUrl) map.setView(state.point, 13, { animate: false });

loadCityAssets(); // samo uruchamia przeliczenie po wczytaniu geometrii
