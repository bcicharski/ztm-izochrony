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

/** Komunikaty w polu uwag Overpassa, które oznaczają przerwane lub odrzucone zapytanie. */
const OVERPASS_FAILURE = /runtime error|timed? ?out|rate_limited|out of memory|too many requests|too busy|dispatcher|server is probably (?:too )?busy/i;

/**
 * Overpass potrafi odpowiedzieć HTTP 200 i urwać wynik w połowie: zwraca wtedy
 * składniowo poprawną, ale niepełną listę elementów, a powód podaje w polu
 * `remark` ("runtime error: Query timed out…"). Dla XML jest to opisane w
 * dokumentacji; dla JSON nazwa pola nie jest potwierdzona — dlatego sprawdzamy
 * każde pole tekstowe poza znanymi (`remark`, `error`, `warning`, a także
 * dowolne inne), żeby inna nazwa też zadziałała.
 * @returns {string|null} treść komunikatu o błędzie albo null, gdy odpowiedź jest pełna
 */
export function overpassRemarkError(body) {
  if (!body || typeof body !== 'object') return null;
  for (const [k, v] of Object.entries(body)) {
    if (k === 'elements' || typeof v !== 'string') continue;
    if (k === 'generator' || k === 'version') continue;
    if (OVERPASS_FAILURE.test(v)) return `${k}: ${v}`;
  }
  return null;
}

const defaultSleep = s => new Promise(r => setTimeout(r, s * 1000));

/**
 * Pobiera zapytanie z Overpassa z ponawianiem (na przemian dwa mirrory).
 * Ponawia: błędy sieci, HTTP 429/502/503/504, ciało niebędące JSON-em oraz
 * odpowiedź 200 z komunikatem o błędzie w `remark` (urwany wynik).
 * @param {string} query
 * @param {number} [tries] liczba prób (domyślnie 6)
 * @param {{sleep?: (s:number)=>Promise<void>}} [opts] `sleep` — podmiana oczekiwania w testach
 */
export async function fetchOverpass(query, tries = 6, { sleep = defaultSleep } = {}) {
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
    let why = res.status;
    if (res.ok) {
      try {
        const body = await res.json();
        const remark = overpassRemarkError(body);
        if (!remark) return body;
        why = `200 z uwagą «${remark}» (wynik urwany)`;
      } catch (err) {
        why = `200, ale ciało nie jest JSON-em (${err.message})`;
      }
    } else if (typeof res.status === 'number' && ![429, 502, 503, 504].includes(res.status)) {
      throw new Error(`Overpass: HTTP ${res.status}`);
    }
    if (attempt >= tries) throw new Error(`Overpass: HTTP ${why}`);
    const waitS = attempt * 20;
    console.log(`Overpass ${why} (${url.split('/')[2]}) — ponawiam za ${waitS} s (próba ${attempt}/${tries})…`);
    await sleep(waitS);
  }
}

/** Kwantyzacja pierścieni do formatu zapisu [[lat*1e5, lon*1e5], ...]. */
export function quantize(ring) {
  return ring.map(p => [Math.round(p.lat * 1e5), Math.round(p.lon * 1e5)]);
}

// --- maska wody: zasięg pobierania i przycinanie -----------------------------
// Overpass zwraca pełną geometrię każdego obiektu, który ma choć jeden punkt
// w prostokącie zapytania (rzeki wystają o dziesiątki km). Maska musi więc
// kończyć się jednakowo w każdą stronę: pobieramy z zapasem i przycinamy do
// tego samego prostokąta.

/**
 * Zapas wokół siatki pieszej [km]: przystanek leży do 1 km za krawędzią siatki,
 * a jego koło ma promień ograniczony do 1 km — maska musi sięgać 2 km.
 */
export const WATER_MARGIN_KM = 2;

/** Prostokąt {s,w,n,e} (stopnie) poszerzony o `marginKm` w każdą stronę. */
export function waterQueryBbox([s, w, n, e], marginKm = WATER_MARGIN_KM) {
  const dLat = marginKm / (M_PER_DEG_LAT / 1000);
  const dLon = dLat / Math.cos(((s + n) / 2) * Math.PI / 180);
  return { s: s - dLat, w: w - dLon, n: n + dLat, e: e + dLon };
}

/** Przycina otwartą linię [[lat,lon],...] do prostokąta (Liang-Barsky); zwraca listę fragmentów. */
export function clipLineToBbox(line, { s, w, n, e }) {
  const out = [];
  let cur = null;
  for (let i = 0; i < line.length - 1; i++) {
    const [y0, x0] = line[i], [y1, x1] = line[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1, hit = true;
    for (const [p, q] of [[-dx, x0 - w], [dx, e - x0], [-dy, y0 - s], [dy, n - y0]]) {
      if (p === 0) { if (q < 0) { hit = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { hit = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { hit = false; break; } if (r < t1) t1 = r; }
    }
    if (!hit) { cur = null; continue; }
    if (!cur) { cur = [[Math.round(y0 + t0 * dy), Math.round(x0 + t0 * dx)]]; out.push(cur); }
    cur.push([Math.round(y0 + t1 * dy), Math.round(x0 + t1 * dx)]);
    if (t1 < 1) cur = null;
  }
  return out.filter(l => l.length >= 2);
}

/** Przycina pierścień [[lat,lon],...] do prostokąta (Sutherland-Hodgman); zachowuje obieg. null = poza. */
export function clipRingToBbox(ring, { s, w, n, e }) {
  const cut = (a, c, axis, v) => {
    const t = (v - a[axis]) / (c[axis] - a[axis]);
    return axis === 1 ? [a[0] + t * (c[0] - a[0]), v] : [v, a[1] + t * (c[1] - a[1])];
  };
  const edges = [
    [p => p[1] >= w, 1, w], [p => p[1] <= e, 1, e],
    [p => p[0] >= s, 0, s], [p => p[0] <= n, 0, n],
  ];
  let pts = ring;
  for (const [inside, axis, v] of edges) {
    const o = [];
    for (let i = 0; i < pts.length; i++) {
      const cu = pts[i], pr = pts[(i + pts.length - 1) % pts.length];
      if (inside(cu)) { if (!inside(pr)) o.push(cut(pr, cu, axis, v)); o.push(cu); }
      else if (inside(pr)) o.push(cut(pr, cu, axis, v));
    }
    pts = o;
    if (!pts.length) return null;
  }
  return pts.length >= 4 ? pts.map(p => [Math.round(p[0]), Math.round(p[1])]) : null;
}

/** Przycina maskę {polys, lines} (współrzędne *1e5) do prostokąta {s,w,n,e} (stopnie). */
export function clipWaterToBbox({ polys, lines }, bbox) {
  const b = { s: bbox.s * 1e5, w: bbox.w * 1e5, n: bbox.n * 1e5, e: bbox.e * 1e5 };
  return {
    polys: polys.map(r => clipRingToBbox(r, b)).filter(Boolean),
    lines: lines.flatMap(l => clipLineToBbox(l, b)),
  };
}
