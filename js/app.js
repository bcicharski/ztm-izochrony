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
  point: L.latLng(54.35540, 18.64450), // start: Dworzec Główny
  direction: 'from',
  walk: true,
  mode: 'general',
  timeMin: 8 * 60,
  day: 'workday',
};

// --- mapa ---------------------------------------------------------------

const map = createMap('map');
const zoneLayer = new ZoneLayer().addTo(map);

const marker = L.marker(state.point, { draggable: true, autoPan: true }).addTo(map);
marker.on('dragend', () => {
  state.point = marker.getLatLng();
  recompute();
});
map.on('click', e => {
  state.point = e.latlng;
  marker.setLatLng(e.latlng);
  recompute();
});

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
$('timeInput').addEventListener('change', e => {
  const [h, m] = e.target.value.split(':').map(Number);
  if (!Number.isNaN(h)) { state.timeMin = h * 60 + m; recompute(); }
});
$('daySelect').addEventListener('change', e => { state.day = e.target.value; recompute(); });

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

function renderStats(rows, walk) {
  $('areaHead').hidden = !walk;
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

    const tdDist = document.createElement('td');
    tdDist.className = 'num';
    tdDist.textContent = row.maxKm > 0 ? `${row.maxKm.toFixed(1)} km` : '—';
    tr.appendChild(tdDist);

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
  const status = $('status');
  status.textContent = 'Obliczam zasięg…';
  try {
    // tryb ogólny zawsze na rozkładzie dnia roboczego
    const dayKey = state.mode === 'time' ? state.day : 'workday';
    const net = await loadDay(dayKey);
    if (seq !== computeSeq) return; // w międzyczasie przyszło nowsze zapytanie

    const t0 = performance.now();
    const res = computeReachability(net, {
      lat: state.point.lat,
      lon: state.point.lng,
      direction: state.direction,
      walk: state.walk,
      mode: state.mode,
      timeMin: state.timeMin,
    });
    const zones = buildZones(net, res.minutes, {
      walk: state.walk,
      origin: { lat: state.point.lat, lon: state.point.lng },
    });
    zoneLayer.setZones(zones);

    const statRows = computeStats(net, res.minutes, {
      walk: state.walk,
      origin: { lat: state.point.lat, lon: state.point.lng },
    });
    renderStats(statRows, state.walk);
    if (state.walk) {
      // rasteryzacja powierzchni jest cięższa — poza ścieżką rysowania mapy
      setTimeout(() => {
        if (seq !== computeSeq) return;
        computeAreas(zones, statRows);
        renderStats(statRows, state.walk);
      }, 0);
    }

    const reachable = res.minutes.reduce((s, v) => s + (v <= 90 ? 1 : 0), 0);
    if (reachable === 0) {
      status.textContent = 'Brak przystanków w zasięgu — wybierz punkt bliżej Gdańska.';
    } else {
      const dirTxt = state.direction === 'from' ? 'z punktu' : 'do punktu';
      status.textContent =
        `${reachable} przystanków w zasięgu 90 min ${dirTxt} (${(performance.now() - t0).toFixed(0)} ms).`;
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

loadMeta().then(meta => {
  if (meta?.dates?.workday) {
    const d = meta.dates.workday;
    $('feedDate').textContent = `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}`;
  } else {
    $('feedDate').textContent = '—';
  }
}).catch(() => { $('feedDate').textContent = '—'; });

recompute();
