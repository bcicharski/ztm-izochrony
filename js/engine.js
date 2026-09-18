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

import { loadDay, loadWater, loadCity, loadBridges, loadWalkNet, loadDelays, dropCityCache, distM, WALK_MPS } from './data.js';
import { decodeWalkNet, snapEdges, snapSeeds, snapTime, sameEdgeSec, computeNodeTimes, paintNetwork, SPREAD_M } from './walknet.js';
import { computeReachability } from './router.js';
import { buildZones, NO_WALK_RADIUS_M, OUTSIDE_MAX_RADIUS_M } from './isochrone.js';
import { computeStats } from './stats.js';
import { buildWalkGrid, dropGrid, computeTimeGrid, computeNoWalkGrid, pixelIndex, maxTimeGrid, renderTimeGrid, buildContours, areaPercents, maxBandDistances, UNREACH } from './walkgrid.js';

/** Cap fali pieszej [s] — jak CAP_SEC w walkgrid.js (pasmo „ponad 60" do 90 min). */
const WALK_CAP_SEC = 90 * 60;
const DAY_TYPE = { workday: 0, saturday: 1, sunday: 2 };

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
   * @returns {Float64Array|null} sekundy per przystanek: `Infinity` = graf zna
   *   przystanek, ale nie ma do niego dojścia w horyzoncie; `NaN` = przystanek
   *   poza grafem (router zostaje przy linii prostej). `null` = grafu nie ma
   *   albo punkt się do niego nie przyłączył — całość liczona w linii prostej.
   */
  accessTimesOnNet(net, point) {
    if (!this.walkNet) return null;
    const origin = snapEdges(this.walkNet, point.lat, point.lng);
    if (!origin.length) return null; // punkt daleko od jakiejkolwiek drogi (pole, plaża)
    const nodeTime = computeNodeTimes(this.walkNet, snapSeeds(origin, 0), WALK_CAP_SEC);
    const snaps = this.stopSnaps(net);
    const out = new Float64Array(net.nStops);
    for (let i = 0; i < net.nStops; i++) {
      const s = snaps[i];
      if (!s.length) { out[i] = NaN; continue; }
      const via = snapTime(nodeTime, s);
      const t = Math.min(via < 0 ? Infinity : via, sameEdgeSec(origin, s));
      out[i] = t > WALK_CAP_SEC ? Infinity : t;
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
   */
  walkWaveOnNet(grid, net, mins, origin) {
    const wnet = this.walkNet;
    if (!wnet) return null;
    const seeds = [];
    const edgeSeeds = new Map(); // krawędź -> [[t, sekundy w rzucie], ...]
    const addSource = (snaps, startSec) => {
      seeds.push(...snapSeeds(snaps, startSec));
      for (const s of snaps) {
        const list = edgeSeeds.get(s.edge) ?? [];
        list.push([s.t, startSec + s.perpSec]);
        edgeSeeds.set(s.edge, list);
      }
    };
    const extraSeeds = []; // źródła nanoszone wprost na raster (okolica punktu)
    if (origin) {
      const snaps = snapEdges(wnet, origin.lat, origin.lng);
      if (snaps.length) addSource(snaps, 0);
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
        addSource(snaps[i], Math.round(t * 60));
      }
    }
    if (!seeds.length) return null; // nic nie przyłączyło się do sieci — raster poradzi sobie lepiej
    const nodeTime = computeNodeTimes(wnet, seeds, WALK_CAP_SEC);
    // paintNetwork zasiewa grid.time wprost, więc computeTimeGrid dostaje null
    paintNetwork(wnet, nodeTime, grid, pixelIndex, UNREACH, WALK_CAP_SEC, edgeSeeds);
    for (const [idx, sec] of extraSeeds) if (grid.land[idx] && sec < grid.time[idx]) grid.time[idx] = sec;
    return computeTimeGrid(grid, null, SPREAD_M);
  }

  /**
   * Pełne przeliczenie.
   * @param {object} p  { city, dayKey, direction, walk, mode, timeMin, types (tablica|null),
   *   cautious, walkOnly, compare, point:{lat,lng}, point2:{lat,lng}, stats:boolean }
   * @param {(msg:object)=>void} emit  fazy: 'zones' (raster + koła + statystyki),
   *   'contours' (obrysy wektorowe)
   */
  async compute(p, emit) {
    if (p.city !== this.city) throw new Error('Silnik ma inne miasto niż żądanie.');
    const [net, delays] = await Promise.all([
      loadDay(p.city, p.dayKey),
      p.cautious ? loadDelays(p.city) : Promise.resolve(null),
    ]);
    const optsBase = {
      direction: p.direction, walk: p.walk, mode: p.mode, timeMin: p.timeMin,
      types: p.types ? new Set(p.types) : null,
      cautious: p.cautious, delays, dayType: DAY_TYPE[p.dayKey],
    };
    // tryb „tylko pieszo" pomija routing — zasięg wyznacza sama fala po lądzie
    let res = null, res2 = null, minutes;
    if (p.walkOnly) {
      minutes = new Float64Array(net.nStops).fill(Infinity);
    } else {
      res = computeReachability(net, {
        ...optsBase, lat: p.point.lat, lon: p.point.lng,
        accessSec: p.walk ? this.accessTimesOnNet(net, p.point) : null,
      });
      minutes = res.minutes;
      if (p.compare) {
        // wspólny zasięg: dla każdego miejsca liczy się czas wolniejszej osoby
        res2 = computeReachability(net, {
          ...optsBase, lat: p.point2.lat, lon: p.point2.lng,
          accessSec: p.walk ? this.accessTimesOnNet(net, p.point2) : null,
        });
        minutes = new Float64Array(res.minutes.length);
        for (let i = 0; i < minutes.length; i++) minutes[i] = Math.max(res.minutes[i], res2.minutes[i]);
      }
    }
    this.last = { net, res, res2, minutes, params: p, grid: null, gridTime: null };

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
      const waveFor = (mins, origin) =>
        this.walkWaveOnNet(grid, net, mins, origin) ?? computeTimeGrid(grid, seedsFor(mins, origin));

      if (p.walkOnly || p.walk) {
        const minsA = p.walkOnly ? null : (p.compare ? res.minutes : minutes);
        if (p.compare) {
          const minsB = p.walkOnly ? null : res2.minutes;
          const t1 = waveFor(minsA, p.point).slice();
          const t2 = waveFor(minsB, p.point2);
          gridTime = maxTimeGrid(grid, t1, t2);
        } else {
          gridTime = waveFor(minsA, p.point);
        }
      } else if (p.compare) {
        // bez spaceru: origin nie jest źródłem (dojście tylko od przystanku)
        const t1 = computeNoWalkGrid(grid, seedsFor(res.minutes, null), NO_WALK_RADIUS_M).slice();
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
      zones = anyOutside ? buildZones(net, outside, { walk: p.walk, origin: null, maxRadiusM: OUTSIDE_MAX_RADIUS_M }) : null;
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

    emit({ phase: 'zones', image, bbox, zones, stats, reachable });
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
      const wm = walk ? d / WALK_MPS / 60 : 0;
      const total = minutes[i] + wm;
      if (total < bestTotal) { bestTotal = total; best = i; bestWalkMin = wm; }
    }
    return best < 0 ? null : { stop: best, total: bestTotal, walkMin: bestWalkMin };
  }

  /** Etapy trasy z nazwami przystanków (do przesłania do UI). */
  describeLegs(legs) {
    const names = this.last.net.stopName;
    return legs.map(l => l.kind === 'access'
      ? { kind: 'access', durSec: l.durSec, stopName: names[l.stop] }
      : l.kind === 'walk'
        ? { kind: 'walk', durSec: l.durSec, fromName: names[l.fromStop], toName: names[l.toStop] }
        : { kind: 'ride', durSec: l.durSec, route: l.route, fromName: names[l.fromStop], toName: names[l.toStop], depSec: l.depSec, arrSec: l.arrSec });
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
        sec = distM(latlng.lat, latlng.lng, p.point.lat, p.point.lng) / WALK_MPS;
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
      return { kind: 'single', total: target.total, walkMin: target.walkMin, targetName, legs: legs ? this.describeLegs(legs) : null };
    }
    const persons = [this.last.res, this.last.res2].map(res => {
      const legs = res.journeyTo(target.stop);
      return { totalMin: res.minutes[target.stop] + target.walkMin, legs: legs ? this.describeLegs(legs) : null };
    });
    return { kind: 'compare', total: target.total, walkMin: target.walkMin, targetName, persons };
  }
}
