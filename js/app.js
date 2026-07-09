/**
 * Spięcie UI: stan aplikacji, kontrolki, przeliczanie i rysowanie stref.
 */

/* global L */

import { loadDay, loadMeta, loadWater, loadCity } from './data.js';
import { computeReachability } from './router.js';
import { buildZones } from './isochrone.js';
import { createMap, ZoneLayer, ZONE_ALPHA } from './map.js';
import { initStats, computeStats, computeAreas } from './stats.js';

const state = {
  point: L.latLng(54.35540, 18.64450),  // start: Gdańsk Dworzec Główny
  point2: L.latLng(54.52070, 18.53100), // drugi punkt: Gdynia Dworzec Gł.
  compare: false,
  direction: 'from',
  walk: true,
  mode: 'general',
  timeMin: 8 * 60,
  day: 'workday',
};

// --- stan z adresu URL (linki do udostępniania) -----------------------------

let pointFromUrl = false;
{
  const q = new URLSearchParams(location.search);
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
  if (q.get('mode') === 'time') state.mode = 'time';
  const t = q.get('t')?.match(/^(\d{1,2}):(\d{2})$/);
  if (t) state.timeMin = Math.min(+t[1], 23) * 60 + Math.min(+t[2], 59);
  if (['workday', 'saturday', 'sunday'].includes(q.get('day'))) state.day = q.get('day');
}

function updateUrl() {
  const q = new URLSearchParams();
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
  history.replaceState(null, '', '?' + q.toString());
}

// --- mapa ---------------------------------------------------------------

const map = createMap('map');
const zoneLayer = new ZoneLayer().addTo(map);

const marker = L.marker(state.point, { draggable: true, autoPan: true }).addTo(map);
marker.on('dragend', () => setPoint(marker.getLatLng()));
map.on('click', e => setPoint(e.latlng));

// drugi znacznik (tryb porównania) — pomarańczowy, przesuwany tylko przeciąganiem
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
marker2.on('dragend', () => {
  state.point2 = marker2.getLatLng();
  recompute();
});

function setPoint(latlng, pan = false) {
  state.point = latlng;
  marker.setLatLng(latlng);
  if (pan) map.setView(latlng, Math.max(map.getZoom(), 13));
  recompute();
}

// --- kontrolki ------------------------------------------------------------

const $ = id => document.getElementById(id);

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
$('compareToggle').addEventListener('change', e => {
  state.compare = e.target.checked;
  syncCompareUi();
  recompute();
});

function syncCompareUi() {
  $('compareHint').hidden = !state.compare;
  if (state.compare) marker2.addTo(map);
  else marker2.remove();
}
$('timeInput').addEventListener('change', e => {
  const [h, m] = e.target.value.split(':').map(Number);
  if (!Number.isNaN(h)) { state.timeMin = h * 60 + m; recompute(); }
});
$('daySelect').addEventListener('change', e => { state.day = e.target.value; recompute(); });

// --- wyszukiwarka adresów, lokalizacja, udostępnianie ------------------------

async function searchAddress(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5' +
    '&accept-language=pl&countrycodes=pl' +
    '&viewbox=18.30,54.55,19.10,54.20&bounded=1' + // okolice Trójmiasta
    '&q=' + encodeURIComponent(query);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Nominatim: ${r.status}`);
  return r.json();
}

function showSearchResults(items) {
  const ul = $('searchResults');
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
      $('searchInput').value = li.textContent;
      setPoint(L.latLng(+item.lat, +item.lon), true);
    });
    ul.appendChild(li);
  }
}

$('searchInput').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const query = e.target.value.trim();
  if (query.length < 3) return;
  try {
    showSearchResults(await searchAddress(query));
  } catch (err) {
    console.error(err);
    $('status').textContent = 'Wyszukiwarka adresów chwilowo niedostępna.';
  }
});
$('searchInput').addEventListener('input', e => {
  if (!e.target.value) $('searchResults').hidden = true;
});

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

// --- tabela statystyk ---------------------------------------------------------

function renderStats(rows, walk, compare) {
  $('areaHead').hidden = !walk;
  $('distHead').hidden = compare;
  const body = $('statsBody');
  body.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');

    const tdZone = document.createElement('td');
    const cell = document.createElement('span');
    cell.className = 'zone-cell';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    // swatch w tej samej przezroczystości, w jakiej strefa leży na mapie
    sw.style.background = row.color;
    sw.style.opacity = ZONE_ALPHA;
    cell.append(sw, row.label);
    tdZone.appendChild(cell);
    tr.appendChild(tdZone);

    if (!compare) {
      const tdDist = document.createElement('td');
      tdDist.className = 'num';
      tdDist.textContent = row.maxKm > 0 ? `${row.maxKm.toFixed(1)} km` : '—';
      tr.appendChild(tdDist);
    }

    if (walk) {
      const tdArea = document.createElement('td');
      tdArea.className = 'num';
      tdArea.textContent = row.areaPct == null ? '—'
        : row.areaPct >= 9.95 ? `${row.areaPct.toFixed(0)}%` : `${row.areaPct.toFixed(1)}%`;
      tr.appendChild(tdArea);
    }
    body.appendChild(tr);
  }
}

// --- przeliczanie -------------------------------------------------------------

let computeSeq = 0;

async function recompute() {
  const seq = ++computeSeq;
  updateUrl();
  const status = $('status');
  status.textContent = 'Obliczam zasięg…';
  try {
    // tryb ogólny zawsze na rozkładzie dnia roboczego
    const dayKey = state.mode === 'time' ? state.day : 'workday';
    const net = await loadDay(dayKey);
    if (seq !== computeSeq) return; // w międzyczasie przyszło nowsze zapytanie

    const t0 = performance.now();
    const optsBase = {
      direction: state.direction,
      walk: state.walk,
      mode: state.mode,
      timeMin: state.timeMin,
    };
    const res = computeReachability(net, {
      ...optsBase, lat: state.point.lat, lon: state.point.lng,
    });
    let minutes = res.minutes;
    if (state.compare) {
      // wspólny zasięg: dla każdego miejsca liczy się czas wolniejszej osoby
      const res2 = computeReachability(net, {
        ...optsBase, lat: state.point2.lat, lon: state.point2.lng,
      });
      minutes = new Float64Array(res.minutes.length);
      for (let i = 0; i < minutes.length; i++) {
        minutes[i] = Math.max(res.minutes[i], res2.minutes[i]);
      }
    }
    const zones = buildZones(net, minutes, {
      walk: state.walk,
      origin: state.compare ? null : { lat: state.point.lat, lon: state.point.lng },
    });
    zoneLayer.setZones(zones);

    const statRows = computeStats(net, minutes, {
      walk: state.walk,
      origin: state.compare ? null : { lat: state.point.lat, lon: state.point.lng },
    });
    renderStats(statRows, state.walk, state.compare);
    if (state.walk) {
      // rasteryzacja powierzchni jest cięższa — poza ścieżką rysowania mapy
      setTimeout(() => {
        if (seq !== computeSeq) return;
        computeAreas(zones, statRows);
        renderStats(statRows, state.walk, state.compare);
      }, 0);
    }

    const reachable = minutes.reduce((s, v) => s + (v <= 90 ? 1 : 0), 0);
    if (reachable === 0) {
      status.textContent = 'Brak przystanków w zasięgu — wybierz punkt bliżej Trójmiasta.';
    } else {
      const dirTxt = state.compare
        ? (state.direction === 'from' ? 'osiągalnych przez oboje' : 'z dojazdem do obu punktów')
        : (state.direction === 'from' ? 'w zasięgu z punktu' : 'w zasięgu do punktu');
      status.textContent =
        `${reachable} przystanków ${dirTxt} w 90 min (${(performance.now() - t0).toFixed(0)} ms).`;
    }
  } catch (err) {
    console.error(err);
    if (seq === computeSeq) status.textContent = 'Błąd wczytywania danych rozkładowych.';
  }
}

// --- start ---------------------------------------------------------------------

Promise.all([loadWater(), loadCity()])
  .then(([water, city]) => {
    if (water) zoneLayer.setWater(water);
    if (city) {
      const landKm2 = initStats(city, water);
      console.log(`Powierzchnia lądowa Gdańska (raster): ${landKm2.toFixed(1)} km²`);
      recompute(); // uzupełnij kolumnę "% miasta" po zbudowaniu rastra
    }
  })
  .catch(() => { /* brak maski wody/granicy nie blokuje działania */ });

// odtworzenie stanu kontrolek (np. po wejściu z linku)
$('dirFrom').checked = state.direction === 'from';
$('dirTo').checked = state.direction === 'to';
$('walkToggle').checked = state.walk;
$('modeGeneral').checked = state.mode === 'general';
$('modeTime').checked = state.mode === 'time';
$('timeRow').hidden = state.mode !== 'time';
$('timeInput').value =
  `${String(Math.floor(state.timeMin / 60)).padStart(2, '0')}:${String(state.timeMin % 60).padStart(2, '0')}`;
$('daySelect').value = state.day;
$('compareToggle').checked = state.compare;
syncCompareUi();
if (pointFromUrl) map.setView(state.point, 13);

loadMeta().then(meta => {
  if (meta?.dates?.workday) {
    const d = meta.dates.workday;
    $('feedDate').textContent = `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}`;
  } else {
    $('feedDate').textContent = '—';
  }
}).catch(() => { $('feedDate').textContent = '—'; });

recompute();
