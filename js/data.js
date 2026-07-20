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
/**
 * Promień węzła przesiadkowego [m] — tryb bez spaceru. Zespoły przystankowe
 * z GTFS klastrują się po DOKŁADNEJ nazwie, a jeden węzeł w terenie bywa
 * nazwany różnie w feedzie (Warszawa: stacja metra „Świętokrzyska" vs
 * przystanek autobusowy „Metro Świętokrzyska", „Pl. Wilsona" vs
 * „Plac Wilsona"). Przystanki bliżej niż ten promień traktujemy jak jeden
 * węzeł niezależnie od nazwy — i przy doborze przystanków startowych
 * (findAccessStops), i przy przesiadkach w trakcie podróży (sameGroupAdj).
 */
export const COMPLEX_MAX_M = 150;
/** Stała odwrócenia czasu dla wyszukiwania "do miejsca" [s]. */
export const REV_C = 48 * 3600;

export const M_PER_DEG_LAT = 111320;

const cache = new Map();

/** Konfiguracja miast (data/cities.json). */
export async function loadCities() {
  if (!cache.has('cities')) {
    cache.set('cities', fetch('data/cities.json').then(r => {
      if (!r.ok) throw new Error(`Brak konfiguracji miast (${r.status})`);
      return r.json();
    }));
  }
  return cache.get('cities');
}

export async function loadDay(cityKey, dayKey) {
  const key = `${cityKey}/${dayKey}`;
  if (cache.has(key)) return cache.get(key);
  const promise = fetch(`data/${cityKey}/${dayKey}.json`)
    .then(r => {
      if (!r.ok) throw new Error(`Nie udało się pobrać danych (${r.status})`);
      return r.json();
    })
    .then(raw => decodeNetwork(raw));
  cache.set(key, promise);
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

  // v3: czasy w sekundach + postoje (pole d); v2: minuty, bez postojów
  const scale = (raw.version | 0) >= 3 ? 1 : 60;
  const patterns = raw.patterns.map(p => decodePattern(p, scale));

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

  // przesiadki w ramach tego samego węzła (tryb bez spaceru): zespół przystankowy
  // z GTFS + pary bliżej niż COMPLEX_MAX_M, które klastrowanie po nazwie rozdzieliło
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
  // dołożenie par spoza zespołu, ale w promieniu węzła (transfers są ≤500 m,
  // więc zawierają komplet kandydatów; pary z tego samego zespołu już dodane)
  for (const [a, b, sec] of raw.transfers) {
    if (group[a] === group[b]) continue;
    if (distM(lat[a], lon[a], lat[b], lon[b]) > COMPLEX_MAX_M) continue;
    const s = Math.max(sec, MIN_TRANSFER_S);
    sameGroupAdj[a].push(b, s);
    sameGroupAdj[b].push(a, s);
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

/**
 * @param {object} p      wzorzec z JSON
 * @param {number} scale  1 dla v3 (sekundy), 60 dla v2 (minuty)
 */
function decodePattern(p, scale) {
  const stops = Int32Array.from(p.s);
  const nStops = stops.length;
  const flags = p.f === 0 ? null : Uint8Array.from(p.f);
  // profCum: skumulowane sekundy ODJAZDÓW od startu kursu
  const profCum = p.p.map(deltas => {
    const cum = new Int32Array(nStops);
    for (let i = 0; i < deltas.length; i++) cum[i + 1] = cum[i] + deltas[i] * scale;
    return cum;
  });
  // profArr: skumulowane sekundy PRZYJAZDÓW (odjazd − postój); brak pola d = postój 0.
  // Rozdzielenie: przejazd = arr[i+1]−dep[i], wysiadanie na przyjeździe (bez postoju).
  const profArr = profCum.map((cum, k) => {
    const arr = new Int32Array(nStops);
    const dw = p.d ? p.d[k] : null;
    for (let pos = 0; pos < nStops; pos++) arr[pos] = cum[pos] - (dw ? dw[pos] * scale : 0);
    return arr;
  });
  const nTrips = p.t.length;
  const tripStart = new Int32Array(nTrips);
  const tripProf = new Int32Array(nTrips);
  for (let i = 0; i < nTrips; i++) {
    tripStart[i] = p.t[i][0] * scale;
    tripProf[i] = p.t[i][1];
  }
  // odjazdy per pozycja×kurs — do szybkiego wyszukiwania najwcześniejszego kursu
  const depAt = new Int32Array(nStops * nTrips);
  for (let t = 0; t < nTrips; t++) {
    const cum = profCum[tripProf[t]];
    for (let pos = 0; pos < nStops; pos++) depAt[pos * nTrips + t] = tripStart[t] + cum[pos];
  }
  return { route: p.r, stops, flags, profCum, profArr, tripStart, tripProf, depAt, nTrips };
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
    // odwrócenie czasu zamienia role odjazd↔przyjazd (postój zachowany):
    // rev_odjazd(X) = REV_C − przyjazd_fwd(X), rev_przyjazd(X) = REV_C − odjazd_fwd(X)
    const profCum = p.profCum.map((depF, k) => {
      const arrF = p.profArr[k];
      const totalArr = arrF[nStops - 1];
      const rev = new Int32Array(nStops);
      for (let i = 0; i < nStops; i++) rev[i] = totalArr - arrF[nStops - 1 - i];
      return rev;
    });
    const profArr = p.profCum.map((depF, k) => {
      const arrF = p.profArr[k];
      const totalArr = arrF[nStops - 1];
      const rev = new Int32Array(nStops);
      for (let i = 0; i < nStops; i++) rev[i] = totalArr - depF[nStops - 1 - i];
      return rev;
    });
    // start kursu odwróconego = REV_C − (przyjazd na ostatni przystanek fwd)
    const trips = [];
    for (let t = 0; t < p.nTrips; t++) {
      const totalArr = p.profArr[p.tripProf[t]][nStops - 1];
      trips.push([REV_C - (p.tripStart[t] + totalArr), p.tripProf[t]]);
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
    return { route: p.route, stops, flags, profCum, profArr, tripStart, tripProf, depAt, nTrips: p.nTrips };
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
    routes: net.routes,
    lat: net.lat, lon: net.lon, group: net.group,
    patterns,
    patternsAtStop,
    transferAdj: net.transferAdj,   // przejścia piesze są symetryczne
    sameGroupAdj: net.sameGroupAdj,
    rideAdjCache: null,
  };
}

/**
 * Geometria wody: {polys, lines}, gdzie polys to zamknięte pierścienie akwenów,
 * a lines to linie rzek/kanałów (waterway=river/canal) uzupełniające dziury
 * w poligonach. Linie rysowane jako stroke ~100 m; poligony fill nonzero.
 */
export async function loadWater(cityKey) {
  const url = `data/${cityKey}/water.json`;
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(async r => {
      if (!r.ok) return null;
      const raw = await r.json();
      const dec = pts => pts.map(([la, lo]) => [la / 1e5, lo / 1e5]);
      return {
        polys: (raw.polys ?? []).map(dec),
        lines: (raw.lines ?? []).map(dec),
      };
    }));
  }
  return cache.get(url);
}

/** Granice administracyjne miasta (do statystyk powierzchni). */
export async function loadCity(cityKey) {
  return loadRings(`data/${cityKey}/city.json`);
}

/**
 * Sieć piesza z OSM (graf ulic i ścieżek) — `null`, gdy miasto jej nie ma
 * (wtedy zasięg pieszy liczy sam raster lądu, jak przed wprowadzeniem grafu).
 * Plik jest największym zasobem miasta (~1 MB po kompresji), więc ładowany
 * jest osobno i asynchronicznie — aplikacja działa, zanim dojedzie.
 */
export async function loadWalkNet(cityKey) {
  const url = `data/${cityKey}/walknet.json`;
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(async r => {
      if (!r.ok) return null;
      const { decodeWalkNet } = await import('./walknet.js');
      return decodeWalkNet(await r.json());
    }).catch(() => null));
  }
  return cache.get(url);
}

/** Mosty/kładki/mola (przejezdne korytarze przez wodę w siatce pieszej). */
export async function loadBridges(cityKey) {
  const url = `data/${cityKey}/bridges.json`;
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(async r => {
      if (!r.ok) return null;
      const raw = await r.json();
      return raw.lines.map(line => line.map(([la, lo]) => [la / 1e5, lo / 1e5]));
    }).catch(() => null));
  }
  return cache.get(url);
}

async function loadRings(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(async r => {
      if (!r.ok) return null;
      const raw = await r.json();
      return raw.polys.map(ring => ring.map(([la, lo]) => [la / 1e5, lo / 1e5]));
    }));
  }
  return cache.get(url);
}

export async function loadMeta(cityKey) {
  const r = await fetch(`data/${cityKey}/meta.json`);
  return r.ok ? r.json() : null;
}

/** Profile opóźnień linii: { "linia|typDnia|godzina": sekundy }. Może być pusty. */
export async function loadDelays(cityKey) {
  const key = `delays/${cityKey}`;
  if (!cache.has(key)) {
    cache.set(key, fetch(`data/${cityKey}/delays.json`)
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({})));
  }
  return cache.get(key);
}
