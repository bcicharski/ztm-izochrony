/**
 * Silnik obliczeń izochron — bez DOM, żeby działał tak samo w Web Workerze
 * (js/worker.js) i, awaryjnie, w wątku głównym (przeglądarki bez
 * OffscreenCanvas). Trzyma zasoby bieżącego miasta (geometria, graf ulic,
 * sieci rozkładowe przez cache w data.js) i wynik ostatniego przeliczenia
 * (do dymka z trasą).
 *
 * Przepływ jednego przeliczenia (`compute`):
 *   RAPTOR/Dijkstra → fala piesza po siatce → raster (faza „zones", szybka)
 *   → obrysy wektorowe (faza „contours", ~1 s w dużym mieście).
 * Każda faza jest oddawana przez `emit`, więc UI pokazuje raster od razu,
 * a gładkie obrysy dokłada, gdy przyjdą.
 */

import { loadDay, loadWater, loadCity, loadBridges, loadWalkNet, loadDelays, dropCityCache, distM, WALK_MPS, BIKE_MPS } from './data.js';
import { decodeWalkNet, snapEdges, snapSeeds, snapTime, sameEdgeSec, computeNodeTimes, paintNetwork, SPREAD_M, NET_WALK_MPS, NET_BIKE_MPS } from './walknet.js';
import { computeReachability } from './router.js';
import { buildZones, NO_WALK_RADIUS_M, OUTSIDE_MAX_RADIUS_M } from './isochrone.js';
import { computeStats, rankMeetingPlaces } from './stats.js';
import { buildStopIndex, journeyShape } from './uilogic.js';
import { buildWalkGrid, dropGrid, computeTimeGrid, computeNoWalkGrid, pixelIndex, maxTimeGrid, renderTimeGrid, buildContours, areaPercents, maxBandDistances, UNREACH } from './walkgrid.js';

/** Cap fali pieszej [s] — jak CAP_SEC w walkgrid.js (pasmo „ponad 60" do 90 min). */
const WALK_CAP_SEC = 90 * 60;
/**
 * Cap dojazdu rowerem do przystanku [s] — 30 min ≈ 7,5 km. Powyżej tego nikt
 * nie jedzie rowerem po to, żeby się przesiąść, a bez capu rower sięgałby
 * 22 km i zasiewał RAPTOR przystankami z drugiego końca aglomeracji.
 */
const BIKE_ACCESS_CAP_SEC = 30 * 60;
const DAY_TYPE = { workday: 0, saturday: 1, sunday: 2 };

/**
 * Tempo dojścia (od punktu użytkownika do przystanku) i „wyjścia" (od
 * przystanku w teren) dla każdego trybu dojścia:
 *   foot         — pieszo w obie strony,
 *   bike         — rowerem do przystanku, dalej pieszo (rower zostaje w stojaku),
 *   bike-onboard — rowerem w obie strony (rower jedzie w pojeździe).
 * `crow*` to odpowiedniki w linii prostej — dla przystanków, których graf ulic
 * nie zna (dalekie stacje spoza gridBbox).
 */
const ACCESS_MODES = {
  foot: { accessMps: NET_WALK_MPS, egressMps: NET_WALK_MPS, cap: WALK_CAP_SEC, crowAccess: WALK_MPS, crowEgress: WALK_MPS },
  bike: { accessMps: NET_BIKE_MPS, egressMps: NET_WALK_MPS, cap: BIKE_ACCESS_CAP_SEC, crowAccess: BIKE_MPS, crowEgress: WALK_MPS },
  'bike-onboard': { accessMps: NET_BIKE_MPS, egressMps: NET_BIKE_MPS, cap: BIKE_ACCESS_CAP_SEC, crowAccess: BIKE_MPS, crowEgress: BIKE_MPS },
};

/**
 * Tempa dla jednego przeliczenia. Przy kierunku „do miejsca" role się
 * zamieniają: podróżny startuje z klikniętego miejsca (i to on ma rower),
 * a kończy przy punkcie użytkownika — czyli szybszy środek lokomocji dotyczy
 * wtedy fali po mieście, nie doboru przystanków startowych.
 */
function speedsFor(access, direction) {
  const m = ACCESS_MODES[access] ?? ACCESS_MODES.foot;
  if (direction !== 'to') return m;
  return {
    ...m,
    accessMps: m.egressMps, egressMps: m.accessMps,
    crowAccess: m.crowEgress, crowEgress: m.crowAccess,
    cap: m.egressMps === NET_WALK_MPS ? WALK_CAP_SEC : m.cap,
  };
}

export class Engine {
  /**
   * @param {object} opts
   * @param {(w:number, h:number)=>object} opts.createCanvas  fabryka canvasu
   *   (OffscreenCanvas w workerze, <canvas> w oknie)
   * @param {(cityKey:string)=>void} [opts.onWalkNet]  wołane, gdy graf ulic
   *   miasta się wczyta — UI przelicza wtedy strefy jeszcze raz
   */
  constructor({ createCanvas, onWalkNet = () => {} }) {
    this.createCanvas = createCanvas;
    this.onWalkNet = onWalkNet;
    this.city = null;
    this.cfg = null;
    this.assets = null;   // {water, city, bridges}
    this.walkNet = null;  // graf ulic (null = fala po rastrze)
    this.last = null;     // wynik ostatniego przeliczenia (dymek trasy)
  }

  /**
   * Przełącza miasto: zwalnia zasoby poprzedniego, wczytuje geometrię
   * (wynik: gotowe do liczenia), a graf ulic dociąga w tle.
   */
  async setCity(cityKey, cfg) {
    if (this.city && this.city !== cityKey) {
      dropCityCache(this.city);
      dropGrid(this.city);
    }
    this.city = cityKey;
    this.cfg = cfg;
    this.assets = null;
    this.walkNet = null;
    this.last = null;
    const [water, city, bridges] = await Promise.all([loadWater(cityKey), loadCity(cityKey), loadBridges(cityKey)]);
    if (this.city !== cityKey) return false;
    this.assets = { water, city, bridges };
    loadWalkNet(cityKey).then(raw => {
      if (this.city !== cityKey || !raw) return;
      this.walkNet = decodeWalkNet(raw);
      this.onWalkNet(cityKey);
    });
    return true;
  }

  /**
   * Przyłączenie przystanków do sieci pieszej (rzut na krawędzie, patrz
   * `snapEdges`). Liczone raz na parę (sieć piesza × sieć rozkładowa)
   * i pamiętane przy grafie — snapowanie kilku tysięcy przystanków przy każdym
   * przeliczeniu byłoby marnotrawstwem.
   * @returns {Array<Array<object>>} lista kandydatek per przystanek (pusta = poza siecią)
   */
  stopSnaps(net) {
    const wnet = this.walkNet;
    wnet.stopCache ??= new WeakMap();
    let snaps = wnet.stopCache.get(net);
    if (!snaps) {
      snaps = new Array(net.nStops);
      for (let i = 0; i < net.nStops; i++) snaps[i] = snapEdges(wnet, net.lat[i], net.lon[i]);
      wnet.stopCache.set(net, snaps);
    }
    return snaps;
  }

  /**
   * Czasy dojścia od punktu do KAŻDEGO przystanku, liczone po sieci ulic.
   *
   * Punkt i przystanki są przyłączone rzutem na krawędzie (lista kandydatek):
   * fala startuje z końców każdej kandydatki punktu, a czas przystanku to
   * krótsza z dróg przez końce jego kandydatek (plus dojście z rzutu). Para na
   * tej samej krawędzi liczona wprost wzdłuż ulicy (`sameEdgeSec`).
   *
   * @param {number} mps     tempo dojścia (pieszo albo rowerem)
   * @param {number} capSec   horyzont dojścia — rower ma własny, krótszy; limit
   *   spaceru (`maxWalkSec`) obniża go dalej. Dla dojścia nie trzeba osobnego
   *   wymiaru stanu: fala startuje od 0, więc czas łączny JEST czasem marszu.
   * @returns {Float64Array|null} sekundy per przystanek: `Infinity` = graf zna
   *   przystanek, ale nie ma do niego dojścia w horyzoncie; `NaN` = przystanek
   *   poza grafem (router zostaje przy linii prostej). `null` = grafu nie ma
   *   albo punkt się do niego nie przyłączył — całość liczona w linii prostej.
   */
  accessTimesOnNet(net, point, mps = NET_WALK_MPS, capSec = WALK_CAP_SEC) {
    if (!this.walkNet) return null;
    const origin = snapEdges(this.walkNet, point.lat, point.lng);
    if (!origin.length) return null; // punkt daleko od jakiejkolwiek drogi (pole, plaża)
    const nodeTime = computeNodeTimes(this.walkNet, snapSeeds(origin, 0, mps), capSec, mps);
    const snaps = this.stopSnaps(net);
    const out = new Float64Array(net.nStops);
    for (let i = 0; i < net.nStops; i++) {
      const s = snaps[i];
      if (!s.length) { out[i] = NaN; continue; }
      const via = snapTime(nodeTime, s, mps);
      const t = Math.min(via < 0 ? Infinity : via, sameEdgeSec(origin, s, mps));
      out[i] = t > capSec ? Infinity : t;
    }
    return out;
  }

  /**
   * Fala piesza policzona po sieci ulic: czasy w węzłach grafu → źródła rastra
   * → rozlanie na `SPREAD_M` od sieci. Zwraca `grid.time` albo `null`, gdy grafu
   * nie ma (jeszcze się ładuje albo miasto go nie ma) — wtedy wywołujący spada
   * do fali po rastrze lądu.
   *
   * Każde źródło (punkt, przystanek) zasiewa oba końce swojej krawędzi, a przy
   * malowaniu (`paintNetwork`) wnętrze tej krawędzi dostaje czas liczony wprost
   * od rzutu — bez tego okolica źródła była kolorowana z czasem powiększonym
   * o marsz do skrzyżowania i z powrotem.
   * @param {Float64Array|null} mins  czasy dojazdu per przystanek; null = sam spacer
   * @param {{lat:number, lng:number}|null} origin  punkt użytkownika
   * @param {{accessMps:number, egressMps:number}} speeds  tempo od punktu i od
   *   przystanków; różne tempa = dwie fale nakładane na siebie (patrz niżej)
   * @param {number} maxWalkSec  limit jednego odcinka pieszego od przystanku [s];
   *   przy skończonym limicie punkt użytkownika idzie osobnym przebiegiem,
   *   zwolnionym z limitu (to jego własny spacer, nie dojście do komunikacji)
   */
  walkWaveOnNet(grid, net, mins, origin, speeds = ACCESS_MODES.foot, maxWalkSec = Infinity) {
    const wnet = this.walkNet;
    if (!wnet) return null;
    const { accessMps, egressMps } = speeds;

    // jedno źródło = lista kandydatek przyłączenia + czas startu; rozbite na
    // nasiona dla węzłów i na wpisy „wewnątrz krawędzi" dla malowania
    const collect = (sources, mps) => {
      const seeds = [];
      const edgeSeeds = new Map(); // krawędź -> [[t, sekundy w rzucie], ...]
      for (const [snaps, startSec] of sources) {
        seeds.push(...snapSeeds(snaps, startSec, mps));
        for (const s of snaps) {
          const list = edgeSeeds.get(s.edge) ?? [];
          list.push([s.t, startSec + s.perpM / mps, s.perpM / mps]);
          edgeSeeds.set(s.edge, list);
        }
      }
      return { seeds, edgeSeeds };
    };

    const fromOrigin = [];  // punkt użytkownika — porusza się tempem dojścia
    const fromStops = [];   // przystanki — dalej tempem „wyjścia"
    const extraSeeds = [];  // źródła nanoszone wprost na raster (okolica punktu)
    if (origin) {
      const snaps = snapEdges(wnet, origin.lat, origin.lng);
      if (snaps.length) fromOrigin.push([snaps, 0]);
      // punkt zawsze koloruje swoje najbliższe otoczenie, nawet gdy leży
      // daleko od jakiejkolwiek drogi (pole, plaża) i nie przyłączył się
      const oIdx = pixelIndex(grid, origin.lat, origin.lng);
      if (oIdx >= 0) extraSeeds.push([oIdx, 0]);
    }
    if (mins) {
      const snaps = this.stopSnaps(net);
      for (let i = 0; i < net.nStops; i++) {
        const t = mins[i];
        if (!(t <= 90) || !snaps[i].length) continue;
        fromStops.push([snaps[i], Math.round(t * 60)]);
      }
    }

    // jedno tempo (pieszo albo rower w pojeździe) = jedna fala; przy rowerze
    // zostawianym na przystanku trzeba dwóch, bo od punktu jedzie się szybciej
    // niż idzie od przystanku — druga fala dokłada się do pierwszej (min per piksel)
    // Trzeci element przebiegu = limit marszu. Z limitem rozdzielamy też przebiegi
    // o równym tempie (mechanizm ten sam co przy rowerze), bo punkt jest od limitu
    // zwolniony, a przystanki nie; bez limitu układ przebiegów jest jak dawniej.
    const limited = maxWalkSec < Infinity;
    const passes = (accessMps === egressMps && !limited)
      ? [[[...fromOrigin, ...fromStops], accessMps, Infinity]]
      : [[fromStops, egressMps, maxWalkSec], [fromOrigin, accessMps, Infinity]];
    let painted = false;
    for (const [sources, mps, passMax] of passes) {
      if (!sources.length) continue;
      const { seeds, edgeSeeds } = collect(sources, mps);
      const walkOut = passMax < Infinity ? new Int32Array(wnet.n) : null;
      const nodeTime = computeNodeTimes(wnet, seeds, WALK_CAP_SEC, mps, { maxWalkSec: passMax, walkOut });
      // paintNetwork zasiewa grid.time wprost, więc computeTimeGrid dostaje null
      paintNetwork(wnet, nodeTime, grid, pixelIndex, UNREACH, WALK_CAP_SEC,
        { edgeSeeds, mps, reset: !painted, walkTime: walkOut, maxWalkSec: passMax });
      painted = true;
    }
    if (!painted) return null; // nic nie przyłączyło się do sieci — raster poradzi sobie lepiej
    for (const [idx, sec] of extraSeeds) if (grid.land[idx] && sec < grid.time[idx]) grid.time[idx] = sec;
    return computeTimeGrid(grid, null, SPREAD_M);
  }

  /**
   * Pełne przeliczenie.
   * @param {object} p  { city, dayKey, direction, walk, mode, timeMin, types (tablica|null),
   *   cautious, walkOnly, compare, meet (Z-004; liczone tylko z compare), point:{lat,lng}, point2:{lat,lng}, stats:boolean,
   *   access:'foot'|'bike'|'bike-onboard' }
   * @param {(msg:object)=>void} emit  fazy: 'zones' (raster + koła + statystyki),
   *   'contours' (obrysy wektorowe)
   */
  async compute(p, emit) {
    if (p.city !== this.city) throw new Error('Silnik ma inne miasto niż żądanie.');
    const [net, delays] = await Promise.all([
      loadDay(p.city, p.dayKey),
      p.cautious ? loadDelays(p.city) : Promise.resolve(null),
    ]);
    const speeds = speedsFor(p.access ?? 'foot', p.direction);
    // Limity (null = bez limitu; wynik wtedy identyczny jak przed Z-012).
    // Spacer: sekundy na JEDEN odcinek pieszy przy komunikacji (dojście,
    // przesiadka, końcówka) — bez znaczenia, gdy spaceru nie ma albo jest „tylko pieszo".
    const maxTransfers = Number.isInteger(p.maxTransfers) ? p.maxTransfers : null;
    const maxWalkSec = p.walk && !p.walkOnly && Number.isFinite(p.maxWalkSec) ? p.maxWalkSec : Infinity;
    const optsBase = {
      maxTransfers, maxWalkSec,
      direction: p.direction, walk: p.walk, mode: p.mode, timeMin: p.timeMin,
      types: p.types ? new Set(p.types) : null,
      cautious: p.cautious, delays, dayType: DAY_TYPE[p.dayKey],
      accessMps: speeds.crowAccess,
    };
    // tryb „tylko pieszo" pomija routing — zasięg wyznacza sama fala po lądzie
    let res = null, res2 = null, minutes;
    if (p.walkOnly) {
      minutes = new Float64Array(net.nStops).fill(Infinity);
    } else {
      res = computeReachability(net, {
        ...optsBase, lat: p.point.lat, lon: p.point.lng,
        accessSec: p.walk ? this.accessTimesOnNet(net, p.point, speeds.accessMps, Math.min(speeds.cap, maxWalkSec)) : null,
      });
      minutes = res.minutes;
      if (p.compare) {
        // wspólny zasięg: dla każdego miejsca liczy się czas wolniejszej osoby
        res2 = computeReachability(net, {
          ...optsBase, lat: p.point2.lat, lon: p.point2.lng,
          accessSec: p.walk ? this.accessTimesOnNet(net, p.point2, speeds.accessMps, Math.min(speeds.cap, maxWalkSec)) : null,
        });
        minutes = new Float64Array(res.minutes.length);
        for (let i = 0; i < minutes.length; i++) minutes[i] = Math.max(res.minutes[i], res2.minutes[i]);
      }
    }
    // limity TEGO przeliczenia — dymek trasy ma je widzieć, nie bieżący stan UI
    this.last = { net, res, res2, minutes, params: p, speeds, limits: { maxTransfers, maxWalkSec }, grid: null, gridTime: null };

    let gridTime = null, grid = null, zones = null, image = null, bbox = null;
    if (this.assets) {
      // strefy na siatce lądu: woda blokuje, mosty przepuszczają.
      // walk=true — fala pieszo (czas dojazdu + dojście); walk=false — koła 200 m
      // wokół przystanków przycięte wodą (bez czasu dojścia)
      grid = buildWalkGrid(p.city, this.cfg, this.assets.water, this.assets.bridges, this.assets.city, this.createCanvas);
      const seedsFor = (mins, origin) => {
        const seeds = [];
        for (let i = 0; mins && i < net.nStops; i++) {
          const t = mins[i];
          if (!(t <= 90)) continue;
          const idx = pixelIndex(grid, net.lat[i], net.lon[i]);
          if (idx >= 0) seeds.push([idx, Math.round(t * 60)]);
        }
        if (origin) {
          const oIdx = pixelIndex(grid, origin.lat, origin.lng);
          if (oIdx >= 0) seeds.push([oIdx, 0]);
        }
        return seeds;
      };
      // fala piesza: po sieci ulic, gdy graf jest już wczytany; inaczej po rastrze
      // (mins === null w trybie „tylko pieszo" — źródłem jest sam punkt)
      // Fallback rastrowy tnie limitem przez `maxSpreadM`; nasiona są w jednej
      // liście, więc ucina też spacer z samego punktu (graf ulic go oszczędza) —
      // przyjęty kompromis, bez trzeciego bufora siatki.
      const waveFor = (mins, origin) =>
        this.walkWaveOnNet(grid, net, mins, origin, speeds, maxWalkSec)
        ?? computeTimeGrid(grid, seedsFor(mins, origin), maxWalkSec * WALK_MPS);

      // tryb porównania liczy dwie fale w tym samym buforze grid.time — pierwszą
      // trzeba odłożyć; drugi bufor trzymany przy siatce zamiast kopii .slice()
      const keep = t => { (grid.time2 ??= new Uint16Array(t.length)).set(t); return grid.time2; };
      if (p.walkOnly || p.walk) {
        const minsA = p.walkOnly ? null : (p.compare ? res.minutes : minutes);
        if (p.compare) {
          const minsB = p.walkOnly ? null : res2.minutes;
          const t1 = keep(waveFor(minsA, p.point));
          const t2 = waveFor(minsB, p.point2);
          gridTime = maxTimeGrid(grid, t1, t2);
        } else {
          gridTime = waveFor(minsA, p.point);
        }
      } else if (p.compare) {
        // bez spaceru: origin nie jest źródłem (dojście tylko od przystanku)
        const t1 = keep(computeNoWalkGrid(grid, seedsFor(res.minutes, null), NO_WALK_RADIUS_M));
        const t2 = computeNoWalkGrid(grid, seedsFor(res2.minutes, null), NO_WALK_RADIUS_M);
        gridTime = maxTimeGrid(grid, t1, t2);
      } else {
        gridTime = computeNoWalkGrid(grid, seedsFor(minutes, null), NO_WALK_RADIUS_M);
      }
      image = renderTimeGrid(grid, gridTime);
      bbox = { latN: grid.latN, lonW: grid.lonW, latS: grid.latS, lonE: grid.lonE };
      // koła tylko dla przystanków poza bboxem siatki (np. Lębork, Tczew w feedzie
      // SKM). Promień ograniczony capem — pełny promień pasma (do 5,2 km) rysowany
      // bez bariery wody zlewał się w plamę większą niż zasięg siatki
      const outside = new Float64Array(minutes.length).fill(Infinity);
      let anyOutside = false;
      for (let i = 0; i < net.nStops; i++) {
        if (minutes[i] <= 90 && pixelIndex(grid, net.lat[i], net.lon[i]) < 0) {
          outside[i] = minutes[i];
          anyOutside = true;
        }
      }
      zones = anyOutside
        ? buildZones(net, outside, { walk: p.walk, origin: null, maxRadiusM: Math.min(OUTSIDE_MAX_RADIUS_M, maxWalkSec * WALK_MPS) })
        : null;
    } else {
      // brak geometrii miasta: koła crow-fly. W trybie „tylko pieszo" zostają
      // same koła wokół punktu (bez przystanków), więc origin jest niezbędny
      zones = buildZones(net, minutes, {
        walk: p.walk || p.walkOnly,
        origin: p.compare && !p.walkOnly ? null : { lat: p.point.lat, lon: p.point.lng },
      });
    }
    // dymek trasy korzysta z tej samej siatki co strefy (spójny dobór przystanku)
    this.last.grid = grid;
    this.last.gridTime = gridTime;

    let stats = null;
    if (!p.compare && p.stats) {
      stats = computeStats(net, minutes, {
        walk: p.walk || p.walkOnly,
        origin: { lat: p.point.lat, lon: p.point.lng },
        accessMps: speeds.crowAccess, egressMps: speeds.crowEgress,
        maxEgressSec: maxWalkSec,
      });
      if (gridTime && grid) {
        const pct = areaPercents(grid, gridTime);
        if (pct) stats.forEach((row, i) => { row.areaPct = pct[i]; });
        if (p.walkOnly) {
          // bez pojazdów nie ma przystanków, więc przybliżenie kołowe z
          // computeStats dałoby stałe limit×tempo niezależnie od wody; zasięg
          // bierzemy z siatki, spójnie z narysowanymi strefami
          const km = maxBandDistances(grid, gridTime, pixelIndex(grid, p.point.lat, p.point.lng));
          if (km) stats.forEach((row, i) => { row.maxKm = km[i]; });
        }
      }
    }
    let reachable = 0;
    for (let i = 0; i < minutes.length; i++) if (minutes[i] <= 90) reachable++;

    // miejsce spotkania (Z-004): tylko porównanie z pojazdami; oba kryteria naraz,
    // żeby przełączenie w UI nie wymagało przeliczenia
    const meet = p.compare && p.meet && res && res2
      ? rankMeetingPlaces(net, res.minutes, res2.minutes)
      : null;

    emit({ phase: 'zones', image, bbox, zones, stats, reachable, meet });
    if (grid && gridTime) emit({ phase: 'contours', contours: buildContours(grid, gridTime) });
  }

  /**
   * Najlepszy przystanek docelowy dla klikniętego miejsca (wg łącznego czasu).
   *
   * W trybie pieszym, dla punktu wewnątrz siatki, łączny czas bierze z fali po
   * lądzie (`gridTime[idx]`) — spójnie ze strefami i bez przechodzenia przez
   * wodę. Przystanek do rekonstrukcji trasy wybiera spośród tych, które mogły
   * być źródłem fali (`minutes[i]*60 ≤ gridTime[idx]`), biorąc najbliższy
   * w linii prostej. Poza siatką i w trybie bez spaceru — dobór crow-fly.
   * @returns {{stop:number, total:number, walkMin:number}|null}
   */
  pickTargetStop(latlng) {
    const { net, minutes, grid, gridTime, params } = this.last;
    const walk = params.walk;
    if (walk && grid && gridTime) {
      const idx = pixelIndex(grid, latlng.lat, latlng.lng);
      if (idx >= 0) {
        const totalSec = gridTime[idx];
        if (totalSec >= UNREACH) return null;
        let best = -1, bestD = Infinity;
        for (let i = 0; i < net.nStops; i++) {
          if (!Number.isFinite(minutes[i]) || minutes[i] * 60 > totalSec + 1) continue;
          const d = distM(latlng.lat, latlng.lng, net.lat[i], net.lon[i]);
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0) {
          const total = totalSec / 60;
          return { stop: best, total, walkMin: Math.max(0, total - minutes[best]) };
        }
        // brak przystanku-źródła: punkt osiągalny pieszo wprost od origin → crow-fly niżej
      }
    }
    let best = -1, bestTotal = Infinity, bestWalkMin = 0;
    for (let i = 0; i < net.nStops; i++) {
      if (!Number.isFinite(minutes[i])) continue;
      const d = distM(latlng.lat, latlng.lng, net.lat[i], net.lon[i]);
      if (!walk && d > 300) continue; // bez spaceru: tylko przystanek tuż obok
      const wm = walk ? d / (this.last.speeds?.crowEgress ?? WALK_MPS) / 60 : 0;
      if (walk && wm * 60 > (this.last.limits?.maxWalkSec ?? Infinity)) continue; // dymek nie obiecuje celu spoza stref
      const total = minutes[i] + wm;
      if (total < bestTotal) { bestTotal = total; best = i; bestWalkMin = wm; }
    }
    return best < 0 ? null : { stop: best, total: bestTotal, walkMin: bestWalkMin };
  }

  /**
   * Etapy trasy z nazwami przystanków (do przesłania do UI) i współrzędnymi
   * [lat, lon] (5 miejsc ≈ 1 m) do schematycznej linii na mapie (Z-010).
   */
  describeLegs(legs) {
    const { stopName: names, lat, lon } = this.last.net;
    const pt = i => [Math.round(lat[i] * 1e5) / 1e5, Math.round(lon[i] * 1e5) / 1e5];
    return legs.map(l => l.kind === 'access'
      ? { kind: 'access', durSec: l.durSec, stopName: names[l.stop], pt: pt(l.stop) }
      : l.kind === 'walk'
        ? { kind: 'walk', durSec: l.durSec, fromName: names[l.fromStop], toName: names[l.toStop], path: [pt(l.fromStop), pt(l.toStop)] }
        : {
          kind: 'ride', durSec: l.durSec, route: l.route, fromName: names[l.fromStop], toName: names[l.toStop],
          depSec: l.depSec, arrSec: l.arrSec, path: (l.stops ?? [l.fromStop, l.toStop]).map(pt),
        });
  }

  /** Linia trasy dla jednej osoby: kotwice = rzeczywisty początek i koniec podróży. */
  shapeFor(legs, origin, latlng) {
    const o = [Math.round(origin.lat * 1e5) / 1e5, Math.round(origin.lng * 1e5) / 1e5];
    const c = [Math.round(latlng.lat * 1e5) / 1e5, Math.round(latlng.lng * 1e5) / 1e5];
    const direction = this.last.params.direction;
    const anchors = direction === 'to' ? { start: c, end: o } : { start: o, end: c };
    return { anchors, shape: journeyShape(legs, { anchors, direction }) };
  }

  /**
   * Indeks nazw przystanków do wyszukiwarki (Z-056). Dane dnia są zwykle już
   * w cache (`loadDay`), więc to tylko przejście po sieci. null = brak miasta.
   */
  async stopIndex(dayKey) {
    const city = this.city;
    if (!city) return null;
    const net = await loadDay(city, dayKey);
    return this.city === city ? buildStopIndex(net) : null;
  }

  /**
   * Dane do dymka z trasą dla klikniętego miejsca. Zwraca obiekt czysty
   * (przesyłalny z workera); HTML składa UI.
   */
  journey(latlng) {
    if (!this.last) return null;
    const { params: p, grid, gridTime } = this.last;
    if (p.walkOnly) {
      // brak przystanków i etapów — czas wprost z fali po lądzie; poza siatką
      // przybliżenie w linii prostej od punktu (jak rysowane wtedy koła)
      let sec = null, why = null;
      const idx = grid && gridTime ? pixelIndex(grid, latlng.lat, latlng.lng) : -1;
      if (idx >= 0) {
        if (gridTime[idx] < UNREACH) sec = gridTime[idx];
        else why = 'Nie da się tam dojść pieszo (woda lub brak przejścia).';
      } else if (!p.compare) {
        sec = distM(latlng.lat, latlng.lng, p.point.lat, p.point.lng) / (this.last.speeds?.crowAccess ?? WALK_MPS);
      } else {
        why = 'Miejsce poza obszarem analizy pieszej.';
      }
      return { kind: 'walkOnly', sec, why };
    }
    const target = this.pickTargetStop(latlng);
    if (!target) return { kind: 'unreach', reason: 'Brak osiągalnego przystanku w pobliżu.' };
    if (target.total > 90) return { kind: 'unreach', reason: 'Podróż zajęłaby ponad 90 minut.' };
    const targetName = this.last.net.stopName[target.stop];
    if (!p.compare) {
      const legs = this.last.res.journeyTo(target.stop);
      const desc = legs ? this.describeLegs(legs) : null;
      return {
        kind: 'single', total: target.total, walkMin: target.walkMin, targetName, legs: desc,
        ...(desc ? this.shapeFor(desc, p.point, latlng) : {}),
      };
    }
    const persons = [this.last.res, this.last.res2].map((res, i) => {
      const legs = res.journeyTo(target.stop);
      const desc = legs ? this.describeLegs(legs) : null;
      return {
        totalMin: res.minutes[target.stop] + target.walkMin, legs: desc,
        ...(desc ? this.shapeFor(desc, i === 0 ? p.point : p.point2, latlng) : {}),
      };
    });
    return { kind: 'compare', total: target.total, walkMin: target.walkMin, targetName, persons };
  }
}
