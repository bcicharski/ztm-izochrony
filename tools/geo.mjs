/** Wspólne funkcje geometryczne dla skryptów budujących dane z OSM/Overpass. */

export const M_PER_DEG_LAT = 111320;

export const key = p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6);

/** Pole ze znakiem (shoelace, x=lon, y=lat); ujemne = obieg zgodny z zegarem. */
export function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.lon * q.lat - q.lon * p.lat;
  }
  return a / 2;
}

export function areaKm2(ring) {
  const latRef = ring[0].lat * Math.PI / 180;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(latRef);
  return Math.abs(signedArea(ring)) * M_PER_DEG_LAT * mPerDegLon / 1e6;
}

/** Douglas-Peucker w metrach. */
export function simplify(ring, tolM) {
  if (ring.length < 8) return ring;
  const latRef = ring[0].lat * Math.PI / 180;
  const kx = M_PER_DEG_LAT * Math.cos(latRef), ky = M_PER_DEG_LAT;
  const pts = ring.map(p => ({ x: p.lon * kx, y: p.lat * ky }));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dx * (pts[a].y - pts[i].y) - dy * (pts[a].x - pts[i].x)) / len;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tolM) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/**
 * Skleja otwarte łańcuchy po pasujących końcach; fragmenty mogą wymagać
 * odwrócenia (w relacjach OSM kierunek odcinków nie jest gwarantowany).
 */
export function stitch(lines) {
  const chains = lines.map(l => l.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < chains.length; i++) {
      const a = chains[i];
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        const b = chains[j];
        const aEnd = key(a[a.length - 1]);
        if (aEnd === key(b[0])) {
          chains[i] = a.concat(b.slice(1));
        } else if (aEnd === key(b[b.length - 1])) {
          chains[i] = a.concat(b.slice(0, -1).reverse());
        } else if (key(a[0]) === key(b[b.length - 1])) {
          chains[i] = b.concat(a.slice(1));
        } else if (key(a[0]) === key(b[0])) {
          chains[i] = b.slice().reverse().concat(a.slice(1));
        } else {
          continue;
        }
        chains.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return chains;
}

export const isClosed = c => c.length > 3 && key(c[0]) === key(c[c.length - 1]);

/** Normalizuje obieg: woda/obszar = zgodnie z zegarem (pole ujemne), dziura odwrotnie. */
export function orient(ring, filled) {
  const cw = signedArea(ring) < 0;
  return cw === filled ? ring : ring.slice().reverse();
}

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export async function fetchOverpass(query, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    // przy kolejnych próbach przełączaj się między mirrorami
    const url = OVERPASS_MIRRORS[(attempt - 1) % OVERPASS_MIRRORS.length];
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ztm-gdansk-isochrones-build/1.0',
      },
      body: 'data=' + encodeURIComponent(query),
    }).catch(err => ({ ok: false, status: err.message }));
    if (res.ok) return res.json();
    if (attempt >= tries || (typeof res.status === 'number' && ![429, 502, 503, 504].includes(res.status))) {
      throw new Error(`Overpass: HTTP ${res.status}`);
    }
    const waitS = attempt * 20;
    console.log(`Overpass ${res.status} (${url.split('/')[2]}) — ponawiam za ${waitS} s (próba ${attempt}/${tries})…`);
    await new Promise(r => setTimeout(r, waitS * 1000));
  }
}

/** Kwantyzacja pierścieni do formatu zapisu [[lat*1e5, lon*1e5], ...]. */
export function quantize(ring) {
  return ring.map(p => [Math.round(p.lat * 1e5), Math.round(p.lon * 1e5)]);
}
