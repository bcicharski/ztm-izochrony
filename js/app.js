/**
 * Spięcie UI: stan aplikacji, kontrolki, przeliczanie i rysowanie stref.
 */

/* global L */

import { loadDay, loadMeta, loadWater, loadCity, loadCities, DAY_LABELS, distM, WALK_MPS } from './data.js';
import { computeReachability } from './router.js';
import { buildZones, BANDS } from './isochrone.js';
import { createMap, ZoneLayer, ZONE_ALPHA } from './map.js';
import { initStats, resetStats, computeStats, computeAreas } from './stats.js';

const CITIES = await loadCities();
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
  for (const group of cityCfg().veh) {
    const label = document.createElement('label');
    label.className = 'veh';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.veh[group.key] !== false;
    input.addEventListener('change', () => {
      state.veh[group.key] = input.checked;
      recompute();
    });
    const span = document.createElement('span');
    span.textContent = group.label;
    label.append(input, span);
    grid.appendChild(label);
  }
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
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5' +
    '&accept-language=pl&countrycodes=pl' +
    `&viewbox=${cityCfg().viewbox}&bounded=1` + // okolice wybranego miasta
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

function renderStats(rows) {
  $('areaHead').hidden = !state.walk;
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

    if (state.walk) {
      const tdArea = document.createElement('td');
      tdArea.className = 'num';
      tdArea.textContent = row.areaPct == null ? '—'
        : row.areaPct >= 9.95 ? `${row.areaPct.toFixed(0)}%` : `${row.areaPct.toFixed(1)}%`;
      tr.appendChild(tdArea);
    }
    body.appendChild(tr);
  }
}

// --- dymek z trasą (prawy klik / przytrzymanie) --------------------------------

let lastCompute = null;

map.on('contextmenu', e => {
  e.originalEvent.preventDefault();
  showJourneyPopup(e.latlng);
});

const HHMM = s => `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const VEH_ICON = { 900: '🚊', 0: '🚊', 700: '🚌', 3: '🚌', 800: '🚎', 11: '🚎', 1: '🚇', 2: '🚆' };

/** Najlepszy przystanek docelowy dla klikniętego miejsca (wg łącznego czasu). */
function pickTargetStop(latlng) {
  const { net, minutes, walk } = lastCompute;
  let best = -1, bestTotal = Infinity, bestWalkMin = 0;
  for (let i = 0; i < net.nStops; i++) {
    if (!Number.isFinite(minutes[i])) continue;
    const d = distM(latlng.lat, latlng.lng, net.lat[i], net.lon[i]);
    if (!walk && d > 300) continue; // bez spaceru: tylko przystanek tuż obok
    const wm = walk ? d / WALK_MPS / 60 : 0;
    const total = minutes[i] + wm;
    if (total < bestTotal) { bestTotal = total; best = i; bestWalkMin = wm; }
  }
  return best < 0 ? null : { stop: best, total: bestTotal, walkMin: bestWalkMin };
}

/** Lista etapów trasy jako HTML. */
function legsHtml(legs, target) {
  const { net, direction } = lastCompute;
  const items = [];
  for (const leg of legs) {
    if (leg.kind === 'access') {
      const min = Math.round(leg.durSec / 60);
      if (min >= 1) {
        items.push(direction === 'from'
          ? `🚶 ${min} min do przystanku ${esc(net.stopName[leg.stop])}`
          : `🚶 ${min} min od przystanku ${esc(net.stopName[leg.stop])} do celu`);
      }
    } else if (leg.kind === 'walk') {
      const min = Math.max(1, Math.round(leg.durSec / 60));
      const same = net.stopName[leg.fromStop] === net.stopName[leg.toStop];
      items.push(same
        ? `🚶 przesiadka (${min} min)`
        : `🚶 ${min} min do: ${esc(net.stopName[leg.toStop])}`);
    } else {
      const icon = VEH_ICON[leg.route.t] ?? '🚌';
      const times = leg.depSec != null
        ? ` · ${HHMM(leg.depSec)}–${HHMM(leg.arrSec)}`
        : ` · ${Math.round(leg.durSec / 60)} min`;
      items.push(`${icon} <strong>${esc(leg.route.n)}</strong>: ${esc(net.stopName[leg.fromStop])} → ${esc(net.stopName[leg.toStop])}${times}`);
    }
  }
  // spacer między klikniętym miejscem a przystankiem docelowym
  const wm = Math.round(target.walkMin);
  if (wm >= 1) {
    const walkItem = direction === 'from'
      ? `🚶 ${wm} min do celu`
      : `🚶 ${wm} min do przystanku ${esc(net.stopName[target.stop])}`;
    if (direction === 'from') items.push(walkItem);
    else items.unshift(walkItem);
  }
  return '<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>';
}

function journeyHeader(totalMin) {
  const { mode, direction } = lastCompute;
  let extra = '';
  if (mode === 'time') {
    const clock = direction === 'from'
      ? `przyjazd ok. ${HHMM(state.timeMin * 60 + totalMin * 60)}`
      : `wyjście ok. ${HHMM(state.timeMin * 60 - totalMin * 60)}`;
    extra = ` <span class="muted">(${clock})</span>`;
  } else {
    extra = ' <span class="muted">(bez czekania)</span>';
  }
  return `<h4>≈ ${Math.round(totalMin)} min${extra}</h4>`;
}

function showJourneyPopup(latlng) {
  if (!lastCompute) return;
  const target = pickTargetStop(latlng);
  let html;
  if (!target || target.total > 90) {
    html = `<div class="journey"><h4>Poza zasięgiem</h4><span class="muted">${
      !target ? 'Brak osiągalnego przystanku w pobliżu.' : 'Podróż zajęłaby ponad 90 minut.'}</span></div>`;
  } else if (!state.compare) {
    const legs = lastCompute.res.journeyTo(target.stop);
    html = `<div class="journey">${journeyHeader(target.total)}${legs ? legsHtml(legs, target) : ''}</div>`;
  } else {
    const parts = [];
    for (const [res, cls, name] of [[lastCompute.res, 'dot-a', 'Punkt niebieski'], [lastCompute.res2, 'dot-b', 'Punkt pomarańczowy']]) {
      const totalMin = res.minutes[target.stop] + target.walkMin;
      const legs = res.journeyTo(target.stop);
      parts.push(`<div class="person"><span class="dot ${cls}"></span>${name} · ≈ ${Math.round(totalMin)} min</div>`
        + (legs ? legsHtml(legs, target) : '<span class="muted">brak trasy</span>'));
    }
    html = `<div class="journey"><h4>Wspólny czas: ≈ ${Math.round(target.total)} min</h4>${parts.join('')}</div>`;
  }
  L.popup({ maxWidth: 300 }).setLatLng(latlng).setContent(html).openOn(map);
}

// --- przeliczanie -------------------------------------------------------------

let computeSeq = 0;

/** Czytelny opis bieżącego widoku do paska statusu. */
function statusText() {
  const what = state.compare
    ? (state.direction === 'from' ? 'Wspólny zasięg dwóch punktów' : 'Obszar z dojazdem do obu punktów')
    : (state.direction === 'from' ? 'Zasięg z punktu' : 'Obszar z dojazdem do punktu');
  const when = state.mode === 'time'
    ? `${DAY_LABELS[state.day]}, ${$('timeInput').value}`
    : 'tryb ogólny (bez oczekiwania)';
  const safe = state.safe ? ' · z marginesem na opóźnienia' : '';
  return `${what} · ${when}${safe}.`;
}

async function recompute() {
  const seq = ++computeSeq;
  updateUrl();
  const status = $('status');
  status.textContent = 'Obliczam zasięg…';
  try {
    // tryb ogólny zawsze na rozkładzie dnia roboczego
    const dayKey = state.mode === 'time' ? state.day : 'workday';
    const net = await loadDay(state.city, dayKey);
    if (seq !== computeSeq) return; // w międzyczasie przyszło nowsze zapytanie

    const optsBase = {
      direction: state.direction,
      walk: state.walk,
      mode: state.mode,
      timeMin: state.timeMin,
      types: allowedTypes(),
      cautious: state.safe,
    };
    const res = computeReachability(net, {
      ...optsBase, lat: state.point.lat, lon: state.point.lng,
    });
    let minutes = res.minutes;
    let res2 = null;
    if (state.compare) {
      // wspólny zasięg: dla każdego miejsca liczy się czas wolniejszej osoby
      res2 = computeReachability(net, {
        ...optsBase, lat: state.point2.lat, lon: state.point2.lng,
      });
      minutes = new Float64Array(res.minutes.length);
      for (let i = 0; i < minutes.length; i++) {
        minutes[i] = Math.max(res.minutes[i], res2.minutes[i]);
      }
    }
    lastCompute = { net, res, res2, minutes, walk: state.walk, mode: state.mode, direction: state.direction };
    map.closePopup();
    const zones = buildZones(net, minutes, {
      walk: state.walk,
      origin: state.compare ? null : { lat: state.point.lat, lon: state.point.lng },
    });
    zoneLayer.setZones(zones);

    if (!state.compare && state.stats) {
      const statRows = computeStats(net, minutes, {
        walk: state.walk,
        origin: { lat: state.point.lat, lon: state.point.lng },
      });
      renderStats(statRows);
      if (state.walk) {
        // rasteryzacja powierzchni jest cięższa — poza ścieżką rysowania mapy
        setTimeout(() => {
          if (seq !== computeSeq) return;
          computeAreas(zones, statRows);
          renderStats(statRows);
        }, 0);
      }
    }

    const reachable = minutes.reduce((s, v) => s + (v <= 90 ? 1 : 0), 0);
    status.textContent = reachable === 0
      ? 'Brak przystanków w zasięgu — wybierz punkt bliżej Trójmiasta.'
      : statusText();
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

async function loadCityAssets() {
  const key = state.city;
  $('areaHead').textContent = cityCfg().areaLabel;
  renderCredits();
  renderVehControls();
  $('feedDate').textContent = '…';
  loadMeta(key).then(meta => {
    if (state.city !== key) return;
    const d = meta?.dates?.workday;
    $('feedDate').textContent = d ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : '—';
  }).catch(() => { if (state.city === key) $('feedDate').textContent = '—'; });
  try {
    const [water, city] = await Promise.all([loadWater(key), loadCity(key)]);
    if (state.city !== key) return; // w międzyczasie zmieniono miasto
    zoneLayer.setWater(water ?? []);
    if (city) {
      initStats(city, water);
      recompute(); // uzupełnij kolumnę "%" po zbudowaniu rastra
    }
  } catch { /* brak maski wody/granicy nie blokuje działania */ }
}

function switchCity(key) {
  if (!CITIES[key] || key === state.city) return;
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
  resetStats(); // raster poprzedniego miasta nie może liczyć nowych stref
  loadCityAssets();
  recompute();
}

{
  const sel = $('citySelect');
  for (const [key, cfg] of Object.entries(CITIES)) {
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
if (pointFromUrl) map.setView(state.point, 13);

loadCityAssets();
recompute();
