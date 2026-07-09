/**
 * Mapa Leaflet + warstwa canvas rysująca strefy czasowe.
 * Strefy malowane najpierw do bufora offscreen bez przezroczystości
 * (ciepłe nadpisują chłodne), potem komponowane na mapę z jedną alfą —
 * dzięki temu unie kół w ramach strefy są jednolite, bez plam.
 */

/* global L */

export const ZONE_ALPHA = 0.55;

const M_PER_DEG_LAT = 111320;

export function createMap(container) {
  const map = L.map(container, {
    center: [54.372, 18.63],
    zoom: 12,
    zoomControl: false,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' +
      ' | Dane rozkładowe: <a href="https://ckan.multimediagdansk.pl/dataset/tristar">ZTM Gdańsk</a> (CC BY)',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);
  return map;
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

  /** Pierścienie wody [[ [lat,lon], ... ], ...] — wycinane ze stref. */
  setWater(rings) {
    this._water = rings;
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
    if (!this._zones) return;

    const bctx = this._buffer.getContext('2d');
    bctx.clearRect(0, 0, this._buffer.width, this._buffer.height);
    bctx.scale(dpr, dpr);

    // metry -> piksele w bieżącym zoomie (na środku widoku)
    const center = map.getCenter();
    const pA = map.latLngToContainerPoint([center.lat, center.lng]);
    const pB = map.latLngToContainerPoint([center.lat + 1000 / M_PER_DEG_LAT, center.lng]);
    const pxPerM = Math.abs(pA.y - pB.y) / 1000;

    const bounds = map.getBounds().pad(0.3);

    for (const zone of this._zones) {
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
    if (this._water) {
      bctx.globalCompositeOperation = 'destination-out';
      bctx.beginPath();
      for (const ring of this._water) {
        for (let i = 0; i < ring.length; i++) {
          const p = map.latLngToContainerPoint(ring[i]);
          if (i === 0) bctx.moveTo(p.x, p.y);
          else bctx.lineTo(p.x, p.y);
        }
        bctx.closePath();
      }
      bctx.fill('nonzero');
      bctx.globalCompositeOperation = 'source-over';
    }

    ctx.globalAlpha = ZONE_ALPHA;
    ctx.drawImage(this._buffer, 0, 0);
    ctx.globalAlpha = 1;
  },
});
