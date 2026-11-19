/**
 * Mapa Leaflet + warstwa canvas rysująca strefy czasowe.
 * Strefy malowane najpierw do bufora offscreen bez przezroczystości
 * (ciepłe nadpisują chłodne), potem komponowane na mapę z jedną alfą —
 * dzięki temu unie kół w ramach strefy są jednolite, bez plam.
 */


import { M_PER_DEG_LAT } from './data.js';
import { reducedMotionFrom, geoErrorMessage } from './uilogic.js';

export const ZONE_ALPHA = 0.55;

/**
 * Czy system prosi o ograniczenie ruchu. Pytanie zadawane w chwili wywołania,
 * nie raz na starcie — zmiana ustawienia systemu działa bez przeładowania.
 * Tylko wątek główny (worker.js nie ma `window`).
 */
export const prefersReducedMotion = () =>
  reducedMotionFrom(window.matchMedia?.('(prefers-reduced-motion: reduce)'));

export function createMap(container, center, zoom) {
  const calm = prefersReducedMotion();
  const map = L.map(container, {
    center,
    zoom,
    zoomControl: false,
    // prefers-reduced-motion: bez animowanego zoomu, zanikania kafelków,
    // animacji znaczników i bezwładności przesuwania (inertia)
    zoomAnimation: !calm,
    fadeAnimation: !calm,
    markerZoomAnimation: !calm,
    inertia: !calm,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Pinezki A/B (domyślny marker Leaflet 25x41) świadomie zostają poniżej
  // 44x44 px: kliknięcie mapy ustawia punkt równoważnie, więc pinezka nie jest
  // jedyną drogą do celu (WCAG 2.5.5 — równoważna alternatywa).
  // Standardowe kafelki OSM (bez klucza API). Jasny podkład CARTO light_all,
  // używany wcześniej, od 2026 wymaga klucza i bez niego oddaje znak wodny
  // „API KEY REQUIRED". Kolorystykę OSM wygasza filtr CSS na .leaflet-tile-pane
  // (css/style.css), żeby strefy pozostały czytelne jak na jasnym podkładzie.
  // Polityka użycia kafelków OSM: ruch tej strony jest niewielki, atrybucja
  // widoczna; przy dużym ruchu przejść na własny klucz (CARTO/MapTiler/Stadia).
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' +
      '<span class="attr-extra"> | Rozkłady: otwarte dane przewoźników (szczegóły w panelu)</span>',
    maxZoom: 19,
  }).addTo(map);
  return map;
}

/**
 * Kontrolka „Wyśrodkuj na mnie" (Z-002): jednorazowy getCurrentPosition (bez ciągłego
 * śledzenia), zgrubna pozycja wystarcza — oszczędza baterię. Przesuwa
 * widok i rysuje kółko dokładności; NIE zmienia punktu startowego ani nie
 * przelicza. Dymek kółka ma przycisk wywołujący `onSetStart`.
 * Wołający sprawdza wcześniej bezpieczny kontekst — bez geolokalizacji nie
 * dodaje kontrolki.
 */
export function addLocateControl(map, { onLocate, onError, onSetStart, label = 'Wyśrodkuj na mnie' }) {
  let circle = null;
  const Ctl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar locate-ctl');
      const a = L.DomUtil.create('a', 'locate-btn', bar);
      a.href = '#';
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', label);
      a.title = label;
      a.textContent = '◎';
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', e => {
        L.DomEvent.preventDefault(e);
        if (a.getAttribute('aria-busy') === 'true') return;
        a.setAttribute('aria-busy', 'true');
        navigator.geolocation.getCurrentPosition(
          pos => {
            a.removeAttribute('aria-busy');
            const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
            map.setView(ll, Math.max(map.getZoom(), 14), { animate: !prefersReducedMotion() });
            circle?.remove();
            circle = L.circle(ll, { radius: pos.coords.accuracy, weight: 1 }).addTo(map);
            if (onSetStart) {
              const btn = L.DomUtil.create('button', 'locate-set');
              btn.type = 'button';
              btn.textContent = 'Ustaw tu punkt startowy';
              L.DomEvent.on(btn, 'click', () => { map.closePopup(); onSetStart(ll); });
              circle.bindPopup(btn);
            }
            onLocate?.(ll, pos.coords.accuracy);
          },
          err => { a.removeAttribute('aria-busy'); onError?.(geoErrorMessage(err?.code)); },
          { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 },
        );
      });
      return bar;
    },
  });
  const ctl = new Ctl();
  ctl.addTo(map);
  return ctl;
}

/** Warstwa stref na własnym canvasie w overlayPane. */
export const ZoneLayer = L.Layer.extend({
  initialize() {
    this._zones = null; // [{color, circles: [[lat, lon, rM]]}]
  },

  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'zone-canvas leaflet-zoom-hide');
    map.getPanes().overlayPane.appendChild(this._canvas);
    this._buffer = document.createElement('canvas');
    map.on('moveend zoomend resize', this._redraw, this);
    this._resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false }); // Leaflet cache'uje rozmiar kontenera
      this._redraw();
    });
    this._resizeObserver.observe(map.getContainer());
    this._redraw();
    return this;
  },

  onRemove(map) {
    map.off('moveend zoomend resize', this._redraw, this);
    this._resizeObserver.disconnect();
    this._canvas.remove();
    return this;
  },

  setZones(zones) {
    this._zones = zones;
    this._redraw();
  },

  /**
   * Raster stref (siatka piesza): {canvas, latN, lonW, latS, lonE} albo null.
   * Rysowany pod ewentualnymi kołami (fallback dla przystanków poza siatką).
   */
  setGrid(gridImage) {
    this._grid = gridImage;
    this._redraw();
  },

  /**
   * Wektorowe obrysy pasm (wynik `buildContours`) albo null. Gdy są, raster
   * z `setGrid` nie jest rysowany — obrysy mają ostre krawędzie w każdym zoomie.
   */
  setContours(bands) {
    this._contours = bands;
    this._redraw();
  },

  /**
   * Zbiorcza aktualizacja (raster, koła, obrysy) z jednym przerysowaniem —
   * pola pominięte zostają bez zmian.
   */
  update({ grid, zones, contours } = {}) {
    if (grid !== undefined) this._grid = grid;
    if (zones !== undefined) this._zones = zones;
    if (contours !== undefined) this._contours = contours;
    this._redraw();
  },

  /** Geometria wody {polys, lines} — wycinana ze stref (linie rzek stroke ~100 m). */
  setWater(water) {
    this._water = water;
    // bbox każdego pierścienia/linii — przy przesuwaniu mapy rysowane są tylko
    // te, które zahaczają o widok (Trójmiasto/GZM: dziesiątki tysięcy
    // wierzchołków wody na każde moveend)
    const bbox = pts => {
      let s = 90, n = -90, w = 180, e = -180;
      for (const [la, lo] of pts) { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
      return [s, w, n, e];
    };
    this._waterBbox = water ? { polys: (water.polys ?? []).map(bbox), lines: (water.lines ?? []).map(bbox) } : null;
    this._redraw();
  },

  _redraw() {
    const map = this._map;
    if (!map) return;
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return;
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);

    const dpr = window.devicePixelRatio || 1;
    for (const c of [this._canvas, this._buffer]) {
      c.width = size.x * dpr;
      c.height = size.y * dpr;
    }
    this._canvas.style.width = `${size.x}px`;
    this._canvas.style.height = `${size.y}px`;

    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    if (!this._zones && !this._grid && !this._contours) return;

    const bctx = this._buffer.getContext('2d');
    bctx.clearRect(0, 0, this._buffer.width, this._buffer.height);
    bctx.scale(dpr, dpr);

    // metry -> piksele w bieżącym zoomie (na środku widoku)
    const center = map.getCenter();
    const pA = map.latLngToContainerPoint([center.lat, center.lng]);
    const pB = map.latLngToContainerPoint([center.lat + 1000 / M_PER_DEG_LAT, center.lng]);
    const pxPerM = Math.abs(pA.y - pB.y) / 1000;

    const bounds = map.getBounds().pad(0.3);

    if (this._contours) this._drawContours(bctx, map, bounds);
    // raster siatki pieszej — rozciągnięty między narożnikami bboxa (tylko
    // zanim przyjdą obrysy wektorowe)
    else if (this._grid) {
      const g = this._grid;
      const tl = map.latLngToContainerPoint([g.latN, g.lonW]);
      const br = map.latLngToContainerPoint([g.latS, g.lonE]);
      bctx.imageSmoothingEnabled = true;
      bctx.drawImage(g.canvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    for (const zone of this._zones ?? []) {
      bctx.fillStyle = zone.color;
      bctx.beginPath();
      for (const [lat, lon, rM] of zone.circles) {
        if (!bounds.contains([lat, lon])) continue;
        const p = map.latLngToContainerPoint([lat, lon]);
        const r = Math.max(rM * pxPerM, 1.5);
        bctx.moveTo(p.x + r, p.y);
        bctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      bctx.fill();
    }

    // wytnij wodę (reguła nonzero: wyspy w pierścieniach wody zostają)
    if (this._water?.polys?.length || this._water?.lines?.length) {
      const vS = bounds.getSouth(), vN = bounds.getNorth(), vW = bounds.getWest(), vE = bounds.getEast();
      const outside = bb => bb[2] < vS || bb[0] > vN || bb[3] < vW || bb[1] > vE;
      bctx.globalCompositeOperation = 'destination-out';
      if (this._water.polys?.length) {
        bctx.beginPath();
        for (let k = 0; k < this._water.polys.length; k++) {
          if (outside(this._waterBbox.polys[k])) continue;
          const ring = this._water.polys[k];
          for (let i = 0; i < ring.length; i++) {
            const p = map.latLngToContainerPoint(ring[i]);
            if (i === 0) bctx.moveTo(p.x, p.y);
            else bctx.lineTo(p.x, p.y);
          }
          bctx.closePath();
        }
        bctx.fill('nonzero');
      }
      if (this._water.lines?.length) {
        bctx.lineWidth = Math.max(3, 100 * pxPerM);
        bctx.lineCap = 'round';
        bctx.lineJoin = 'round';
        bctx.beginPath();
        for (let k = 0; k < this._water.lines.length; k++) {
          if (outside(this._waterBbox.lines[k])) continue;
          const line = this._water.lines[k];
          for (let i = 0; i < line.length; i++) {
            const p = map.latLngToContainerPoint(line[i]);
            if (i === 0) bctx.moveTo(p.x, p.y);
            else bctx.lineTo(p.x, p.y);
          }
        }
        bctx.stroke();
      }
      bctx.globalCompositeOperation = 'source-over';
    }

    ctx.globalAlpha = ZONE_ALPHA;
    ctx.drawImage(this._buffer, 0, 0);
    ctx.globalAlpha = 1;
  },

  /**
   * Obrysy pasm jako ścieżki: od najchłodniejszego do najcieplejszego
   * (ciepłe nadpisują chłodne), reguła evenodd (dziury i wyspy w dziurach).
   *
   * Rzut lat/lon → piksel liczony wprost (Mercator: x liniowe w lon, y liniowe
   * w ln tan(π/4 + φ/2)) z dwóch punktów odniesienia z Leafleta — kilkaset
   * tysięcy wierzchołków przez `latLngToContainerPoint` byłoby za wolne.
   * Pierścienie poza widokiem (bbox) są pomijane, a kolejne wierzchołki bliżej
   * niż ~0,7 px od poprzedniego — zlewane.
   */
  _drawContours(bctx, map, bounds) {
    const bands = this._contours;
    const p0 = map.latLngToContainerPoint([bounds.getNorth(), bounds.getWest()]);
    const p1 = map.latLngToContainerPoint([bounds.getSouth(), bounds.getEast()]);
    const mercY = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
    const mN = mercY(bounds.getNorth()), mS = mercY(bounds.getSouth());
    const sx = (p1.x - p0.x) / (bounds.getEast() - bounds.getWest());
    const sy = (p1.y - p0.y) / (mS - mN);
    const lonW = bounds.getWest();
    const vS = bounds.getSouth(), vN = bounds.getNorth(), vW = bounds.getWest(), vE = bounds.getEast();
    for (let b = bands.length - 1; b >= 0; b--) {
      const band = bands[b];
      if (!band.rings.length) continue;
      bctx.fillStyle = band.color;
      bctx.beginPath();
      for (let r = 0; r < band.rings.length; r++) {
        const bb = band.bbox[r];
        if (bb[2] < vS || bb[0] > vN || bb[3] < vW || bb[1] > vE) continue; // poza widokiem
        const ring = band.rings[r];
        let lx = NaN, ly = NaN, count = 0;
        for (let i = 0; i < ring.length; i += 2) {
          const x = p0.x + (ring[i + 1] - lonW) * sx;
          const y = p0.y + (mercY(ring[i]) - mN) * sy;
          if (count && Math.abs(x - lx) < 0.7 && Math.abs(y - ly) < 0.7) continue;
          if (count === 0) bctx.moveTo(x, y); else bctx.lineTo(x, y);
          lx = x; ly = y; count++;
        }
        if (count) bctx.closePath();
      }
      bctx.fill('evenodd');
    }
  },
});

// --- schematyczna linia trasy (Z-010) -----------------------------------------

/**
 * Własny pane linii trasy: nad strefami (overlayPane, 400), pod pinezkami
 * (markerPane, 600) i dymkami (popupPane, 700).
 */
export function createJourneyPane(map) {
  const pane = map.createPane('journeyPane');
  pane.style.zIndex = 450;
  return pane;
}

/**
 * Grubości [px] i promienie to stałe geometrii, nie kolory. Kolory siedzą w
 * css/style.css (klasy .jl-*) na tokenach --ink / --surface / --dot-a / --dot-b.
 * Ciemna otoczka (--ink) pod jasnym rdzeniem działa na wszystkich pasmach stref;
 * jasna otoczka dawałaby ok. 1,4:1 na paśmie „do 10 min". Tryb porównania
 * odróżnia osoby grubością i kształtem kropek, nie tylko kolorem (--dot-b jest
 * bliski kolorowi pasma 10–20 min, więc B zawsze ma otoczkę).
 */
export const JOURNEY_STYLE = {
  single: { halo: 8, core: 4, dash: '8 6', dashOffset: '0', dotR: 5, dotW: 2 },
  a: { halo: 5, core: 3, dash: '8 6', dashOffset: '0', dotR: 5, dotW: 2 },
  b: { halo: 12, core: 8, dash: '10 6', dashOffset: '8', dotR: 6, dotW: 2.5 },
};

/**
 * Warstwa linii trasy. Wszystkie ścieżki `interactive: false` — inaczej
 * polilinia przechwytywałaby prawy klik (nie dałoby się otworzyć dymka dla
 * miejsca leżącego na trasie) i wchodziła do kolejności tabulacji.
 * Linia żyje razem z dymkiem trasy (app.js), który jest jej tekstowym
 * odpowiednikiem.
 */
export function createJourneyLayer(map) {
  const group = L.layerGroup().addTo(map);
  const renderer = L.svg({ pane: 'journeyPane' });
  const base = { pane: 'journeyPane', renderer, interactive: false, lineJoin: 'round', fill: false };
  const poly = (pts, cls, opt) => L.polyline(pts, { ...base, className: cls, ...opt });

  function drawVariant(shape, variant) {
    const st = JOURNEY_STYLE[variant] ?? JOURNEY_STYLE.single;
    const core = variant === 'a' ? 'jl-core-a' : variant === 'b' ? 'jl-core-b' : 'jl-core';
    // 1. otoczka, ciągła, pod wszystkim (także pod odcinkiem pieszym)
    for (const seg of shape) {
      poly(seg.pts, 'jl-halo', { weight: st.halo, lineCap: 'round' }).addTo(group);
    }
    // 2. rdzeń: przejazd ciągły, spacer kreskowany
    for (const seg of shape) {
      if (seg.kind === 'ride') {
        poly(seg.pts, core, { weight: st.core, lineCap: 'round' }).addTo(group);
      } else {
        poly(seg.pts, core, {
          weight: st.core, lineCap: 'butt', dashArray: st.dash, dashOffset: st.dashOffset,
        }).addTo(group);
      }
    }
    // 3. kropki na przystankach (wsiadanie, pośrednie, wysiadanie)
    const dotCls = variant === 'a' ? 'jl-dot jl-dot-a' : 'jl-dot';
    for (const seg of shape) {
      if (seg.kind !== 'ride') continue;
      for (const pt of seg.pts) {
        L.circleMarker(pt, {
          ...base, fill: true, radius: st.dotR, weight: st.dotW, className: dotCls, fillOpacity: 1,
        }).addTo(group);
      }
    }
  }

  return {
    /** @param {Array<{shape:Array, variant:'a'|'b'|'single'}>} items; [] czyści */
    setShapes(items) {
      group.clearLayers();
      // B pod spodem, A nad nim — na wspólnym odcinku widać cienki pasek A w grubym B
      const order = { b: 0, a: 1, single: 2 };
      [...(items ?? [])]
        .filter(it => it?.shape?.length)
        .sort((x, y) => order[x.variant] - order[y.variant])
        .forEach(it => drawVariant(it.shape, it.variant));
    },
    clear() { group.clearLayers(); },
  };
}
