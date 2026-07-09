/**
 * Ładowanie i dekodowanie prekompilowanych danych rozkładowych (data/*.json)
 * do struktur zoptymalizowanych pod algorytmy routingu.
 */

export const DAY_KEYS = ['workday', 'saturday', 'sunday'];
export const DAY_LABELS = { workday: 'dzień roboczy', saturday: 'sobota', sunday: 'niedziela' };

/** Prędkość spaceru w linii prostej [m/s] — 4,5 km/h ÷ współczynnik krętości 1,3. */
export const WALK_MPS = 4.5 / 3.6 / 1.3;
/** Minimalny czas przesiadki [s]. */
export const MIN_TRANSFER_S = 60;
/** Stała odwrócenia czasu dla wyszukiwania "do miejsca" [s]. */
export const REV_C = 48 * 3600;

export const M_PER_DEG_LAT = 111320;

const cache = new Map();

export async function loadDay(dayKey) {
  if (cache.has(dayKey)) return cache.get(dayKey);
  const promise = fetch(`data/${dayKey}.json`)
    .then(r => {
      if (!r.ok) throw new Error(`Nie udało się pobrać danych (${r.status})`);
      return r.json();
    })
    .then(raw => decodeNetwork(raw));
  cache.set(dayKey, promise);
  return promise;
}

/** Odległość w metrach (przybliżenie równokątne — wystarczające w skali miasta). */
export function distM(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  const dx = (lon2 - lon1) * M_PER_DEG_LAT * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

export function decodeNetwork(raw) {
  const n = raw.stops.lat.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = raw.stops.lat[i] / 1e5;
    lon[i] = raw.stops.lon[i] / 1e5;
  }
  const group = Int32Array.from(raw.stops.group);

  const patterns = raw.patterns.map(decodePattern);

  // indeks: przystanek -> [pattern, pozycja] (spłaszczone pary)
  const patternsAtStop = Array.from({ length: n }, () => []);
  patterns.forEach((p, pi) => {
    for (let pos = 0; pos < p.stops.length; pos++) {
      patternsAtStop[p.stops[pos]].push(pi, pos);
    }
  });

  // przesiadki piesze: listy sąsiedztwa w obu kierunkach [stop, sekundy]
  const transferAdj = Array.from({ length: n }, () => []);
  for (const [a, b, sec] of raw.transfers) {
    const s = Math.max(sec, MIN_TRANSFER_S);
    transferAdj[a].push(b, s);
    transferAdj[b].push(a, s);
  }

  // przesiadki w ramach tego samego zespołu przystankowego (tryb bez spaceru)
  const byGroup = new Map();
  for (let i = 0; i < n; i++) {
    if (!byGroup.has(group[i])) byGroup.set(group[i], []);
    byGroup.get(group[i]).push(i);
  }
  const sameGroupAdj = Array.from({ length: n }, () => []);
  for (const stopsInGroup of byGroup.values()) {
    for (let a = 0; a < stopsInGroup.length; a++) {
      for (let b = a + 1; b < stopsInGroup.length; b++) {
        const i = stopsInGroup[a], j = stopsInGroup[b];
        const sec = Math.max(Math.round(distM(lat[i], lon[i], lat[j], lon[j]) / WALK_MPS), MIN_TRANSFER_S);
        sameGroupAdj[i].push(j, sec);
        sameGroupAdj[j].push(i, sec);
      }
    }
  }

  const net = {
    day: raw.day,
    date: raw.date,
    routes: raw.routes,
    nStops: n,
    stopName: raw.stops.name,
    lat, lon, group,
    patterns,
    patternsAtStop,
    transferAdj,
    sameGroupAdj,
    rideAdjCache: null, // wypełniane leniwie przez router (tryb ogólny)
  };
  net.reversed = reverseNetwork(net);
  return net;
}

function decodePattern(p) {
  const stops = Int32Array.from(p.s);
  const nStops = stops.length;
  const flags = p.f === 0 ? null : Uint8Array.from(p.f);
  // profile -> skumulowane sekundy od startu kursu
  const profCum = p.p.map(deltas => {
    const cum = new Int32Array(nStops);
    for (let i = 0; i < deltas.length; i++) cum[i + 1] = cum[i] + deltas[i] * 60;
    return cum;
  });
  const nTrips = p.t.length;
  const tripStart = new Int32Array(nTrips);
  const tripProf = new Int32Array(nTrips);
  for (let i = 0; i < nTrips; i++) {
    tripStart[i] = p.t[i][0] * 60;
    tripProf[i] = p.t[i][1];
  }
  // odjazdy per pozycja×kurs — do szybkiego wyszukiwania najwcześniejszego kursu
  const depAt = new Int32Array(nStops * nTrips);
  for (let t = 0; t < nTrips; t++) {
    const cum = profCum[tripProf[t]];
    for (let pos = 0; pos < nStops; pos++) depAt[pos * nTrips + t] = tripStart[t] + cum[pos];
  }
  return { route: p.r, stops, flags, profCum, tripStart, tripProf, depAt, nTrips };
}

/**
 * Sieć odwrócona (do zapytań "do miejsca"): czas t' = REV_C − t,
 * wzorce z odwróconą kolejnością przystanków. Forward-RAPTOR na tej sieci
 * odpowiada wyszukiwaniu "przyjazd najpóźniej o..." na sieci oryginalnej.
 */
function reverseNetwork(net) {
  const patterns = net.patterns.map(p => {
    const nStops = p.stops.length;
    const stops = Int32Array.from(p.stops).reverse();
    let flags = null;
    if (p.flags) {
      // zamiana ról: zakaz wsiadania <-> zakaz wysiadania
      flags = new Uint8Array(nStops);
      for (let i = 0; i < nStops; i++) {
        const f = p.flags[nStops - 1 - i];
        flags[i] = ((f & 1) ? 2 : 0) | ((f & 2) ? 1 : 0);
      }
    }
    const profCum = p.profCum.map(cum => {
      const total = cum[nStops - 1];
      const rev = new Int32Array(nStops);
      for (let i = 0; i < nStops; i++) rev[i] = total - cum[nStops - 1 - i];
      return rev;
    });
    // start kursu odwróconego = REV_C − (przyjazd na ostatni przystanek)
    const trips = [];
    for (let t = 0; t < p.nTrips; t++) {
      const total = p.profCum[p.tripProf[t]][nStops - 1];
      trips.push([REV_C - (p.tripStart[t] + total), p.tripProf[t]]);
    }
    trips.sort((a, b) => a[0] - b[0]);
    const tripStart = new Int32Array(p.nTrips);
    const tripProf = new Int32Array(p.nTrips);
    trips.forEach(([s, pr], i) => { tripStart[i] = s; tripProf[i] = pr; });
    const depAt = new Int32Array(nStops * p.nTrips);
    for (let t = 0; t < p.nTrips; t++) {
      const cum = profCum[tripProf[t]];
      for (let pos = 0; pos < nStops; pos++) depAt[pos * p.nTrips + t] = tripStart[t] + cum[pos];
    }
    return { route: p.route, stops, flags, profCum, tripStart, tripProf, depAt, nTrips: p.nTrips };
  });

  const patternsAtStop = Array.from({ length: net.nStops }, () => []);
  patterns.forEach((p, pi) => {
    for (let pos = 0; pos < p.stops.length; pos++) {
      patternsAtStop[p.stops[pos]].push(pi, pos);
    }
  });

  return {
    nStops: net.nStops,
    stopName: net.stopName,
    lat: net.lat, lon: net.lon, group: net.group,
    patterns,
    patternsAtStop,
    transferAdj: net.transferAdj,   // przejścia piesze są symetryczne
    sameGroupAdj: net.sameGroupAdj,
    rideAdjCache: null,
  };
}

/** Pierścienie wody do maskowania stref: [[ [lat,lon], ... ], ...]. */
export async function loadWater() {
  return loadRings('data/water.json');
}

/** Granica administracyjna Gdańska (do statystyk powierzchni). */
export async function loadCity() {
  return loadRings('data/city.json');
}

async function loadRings(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const raw = await r.json();
  return raw.polys.map(ring => ring.map(([la, lo]) => [la / 1e5, lo / 1e5]));
}

export async function loadMeta() {
  const r = await fetch('data/meta.json');
  return r.ok ? r.json() : null;
}
