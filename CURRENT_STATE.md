# CURRENT_STATE — mechanizm przekraczania wody (zasięg pieszy)

Stan na 2026-07-18, na bazie commitu `994f52e` (wdrożony na https://transport.excelninja.pro). Niezacommitowane: naprawa `pickTargetStop` (dymek trasy po siatce) — patrz §1 (sesja 2026-07-15) — oraz uszczelnienie maski wody o linie waterway=river/canal — patrz §1 (sesja 2026-07-18).

## 1. Ostatnie modyfikacje

### Sesja 2026-07-18 (cd., niezacommitowane) — SKM Gdańsk zawyżone czasy: sekundy + rozdział jazda/postój (backlog #1)

Problem: SKM Zaspa→Wrzeszcz pokazywał ~3 min, realnie ~1,6 min. Dwie przyczyny w prekompilacji: (1) `timeToMin` obcinał sekundy (feed SKM ma sekundy: dep 18:52:18, arr 18:53:54), (2) model trzymał jeden czas per przystanek i liczył deltę **odjazd−odjazd**, wliczając POSTÓJ na przystanku docelowym (Wrzeszcz dwell 66 s). Błąd hopu = 84 s = 66 s postój + 18 s obcięcie. Żaden feed poza SKM nie ma sub-minutowych czasów ani postojów (arr==dep) — bug dotyczył praktycznie tylko kolei SKM/PKM.

Rozwiązanie: format danych **v3** — czasy w SEKUNDACH + osobno odjazd i przyjazd per przystanek (postój = dep−arr). Czysty przejazd = `arr[i+1]−dep[i]`; wysiadanie w RAPTOR na przyjeździe (bez postoju).

- **`tools/build-data.mjs`**: `timeToMin`→`timeToSec` (h*3600+m*60+s). stop_times czyta `arrival_time` (fallback→dep). `buildDay`: delty odjazd−odjazd [s] + tablica postojów `dwell` (dep−arr, skrajne przystanki=0), dedup profilu po (delty;postoje). Wyjście `version:3`, pole `d`=postoje per profil, pomijane gdy wszystkie zerowe (feedy minutowe zostają lekkie). JSDoc w nagłówku.
- **`js/data.js`**: dekoder rozpoznaje wersję (`scale=1` v3 / `60` v2 — **wsteczna zgodność**: 16 miast bez lokalnych feedów zostaje na v2 do planowego rebuildu). `decodePattern(p, scale)` buduje `profCum` (odjazdy) + `profArr` (przyjazdy = odjazd−postój). `reverseNetwork`: odwrócenie czasu zamienia role odjazd↔przyjazd (`rev_odjazd(X)=REV_C−przyjazd_fwd(X)`), buduje oba profile.
- **`js/router.js`**: RAPTOR wysiada na `tripStartT + tripArr[pos]` (przyjazd); Dijkstra `rideAdjacency` krawędź = `profArr[pos+1]−profCum[pos]` (czysta jazda, clamp ≥0); mnożnik ostrożny liczony od przyjazdu.
- **`data/trojmiasto/*` + `data/warszawa/*`**: przebudowane do v3 (jedyne z feedami lokalnymi). Rozmiary bez zmian (~1.2/2.2 MB). Pozostałe 16 miast: v2, działają przez back-compat, przejdą na v3 przy najbliższym cotygodniowym workflow.
- **Weryfikacja (preview, import modułów)**: odcinek SKM Zaspa→Wrzeszcz `arr−dep` = **96 s** (dawniej dep−dep 162 s → v2 obcięte do 180 s) w trybie ogólnym I godzinowym; RAPTOR dep 12:02:18→arr 12:03:54 (realny rozkład, sekundy zachowane). Sieć odwrócona (kierunek „do") = 96 s. Bus (feed minutowy, arr==dep) = 60 s bez zmian. Warszawa v3 (metro frequencies) 2341 wzorców OK. Kraków **v2 back-compat** 538 wzorców, 3436 przystanków w zasięgu OK. Zero błędów konsoli.
- **Uwaga**: feedy minutowe (ZTM Gdańsk, ZKM Gdynia, tram/bus wszędzie) mają granulację 1 min i arr==dep — ich czasy pozostają minutowe (fix nic nie psuje ani nie poprawia; dwell=0). Realny zysk tylko tam, gdzie feed daje sekundy/postoje (SKM; potencjalnie inne koleje).

### Sesja 2026-07-18 (cd., niezacommitowane) — tryb bez spaceru (`walk=false`) na siatce lądu (backlog #7)

Problem: przy „Uwzględnij spacer" WYŁĄCZONYM strefy rysowano stałymi kołami `NO_WALK_RADIUS_M`=200 m (crow-fly, `js/isochrone.js buildZones walk:false`) — bez bariery wody. Koło mogło przeciąć wąski kanał (ta sama regresja co pierwotny problem, tylko dla `walk=false`; siatka piesza budowała się wyłącznie przy `state.walk`). Wybrany kierunek B: zbudować siatkę też dla `walk=false`, seed = same przystanki (bez origin), propagacja ograniczona do 200 m po lądzie.

- **`js/isochrone.js`**: `NO_WALK_RADIUS_M` (200 m) teraz `export` (używane przez app.js jako promień strefy no-walk).
- **`js/walkgrid.js` `computeNoWalkGrid(grid, seeds, radiusM)` (NOWA)**: flood po lądzie do `radiusM` (woda blokuje jak w `computeTimeGrid`), ale BEZ dodawania czasu dojścia — piksel dostaje czysty czas przyjazdu przystanku-źródła (kolor = pasmo przystanku, jak dawne koła, tylko przycięte wodą). Kubełki po czasie przyjazdu (rosnąco) → wcześniejszy przyjazd koloruje pierwszy; wewnątrz kubełka BFS po lądzie do promienia, `spread` (metry od źródła) w lokalnym `Uint16Array`. Seed na wodzie → przeniesienie na sąsiada lądowego (jak w computeTimeGrid). JSDoc opisuje zachowawcze podpikselowe niedopokrycie na styku dwóch stref.
- **`js/app.js`**: warunek siatki `state.walk && cityAssets` → `cityAssets` (obie gałęzie na siatce). `seedsFor(mins, origin)` wyciągnięte przed `if` (reużyte, no-walk woła z `origin=null`). Gałąź `else` (bez spaceru): `computeNoWalkGrid(..., NO_WALK_RADIUS_M)`, compare → `t1/t2` + `maxTimeGrid` (wspólny zasięg = oba przystanki w promieniu). Fallback kołowy poza bboxem: `buildZones(..., {walk: state.walk, origin:null})`. Import `computeNoWalkGrid`, `NO_WALK_RADIUS_M`.
- **Bez zmian**: `pickTargetStop` (klucz `walk` false → nadal crow-fly ≤300 m, siatka nie ruszona); statystyki % powierzchni (kolumna ukryta dla no-walk jak dotąd — `areaHead.hidden = !state.walk`).
- **Weryfikacja**: (1) syntetyczna siatka 11×1 z wodą w x=5, seed x=0, promień 200 m → lewy brzeg x0–4 = 300 s (jednolicie), woda i cały drugi brzeg x6–10 = UNREACH mimo <200 m. (2) cap: promień 100 m → x4 kolor, x5 UNREACH. (3) nakładanie: seedy arr 600 i 300 → środek = 300 (wcześniejszy wygrywa). (4) realna apka Trójmiasto Nowy Port `walk=0` tryb ogólny: raster 184k px, `walk=1` 780k px, zero błędów konsoli.
- **Poza bboxem siatki**: dalekie stacje (Lębork/Tczew) nadal koła crow-fly bez bariery — to udokumentowany backlog #10, nie ten temat.

### Sesja 2026-07-18 (niezacommitowane) — uszczelnienie maski wody o linie waterway=river/canal

Problem: raster wody (`data/<miasto>/water.json`) miał DZIURY na dużych rzekach. Overpass query pobierało tylko `natural=water` (poligony) i `natural=coastline` — a Wisła w Warszawie (poniżej Śródmieścia, lat < 52.249: Praga Południe, Siekierki, Wilanów), Motława/Kanał Portowy w Trójmieście i wiele fragmentów rzek w innych miastach ma w OSM głównie tag `waterway=river`/`waterway=canal` (linia, nie poligon). Skutek: fala pieszo w `js/walkgrid.js` przechodziła bezpośrednio przez rzekę, dając koncentryczne strefy zamiast obejść mostem (przykład: Warszawa Saska Kępa 52.242,21.055 → Bartycka Siekierki 52.204,21.055 (4225 m linia prosta) pieszo = **81 min** w apce, realny objazd mostem Łazienkowskim/Siekierkowskim ~5.5 km = >90 min pieszo).

Diagnoza: raster warszawa pokrywał Wisłę tylko lat 52.249–52.433 (trzy duże pierścienie `natural=water`), poza tym paskiem land=1 wszędzie. Trójmiasto podobnie — Motława, Kanał Portowy, dolna Wisła: linie w OSM, brak poligonów.

- **`tools/build-water.mjs`**:
  - Rozszerzone zapytanie Overpass o `way["waterway"~"^(river|canal)$"]`.
  - Nowa sekcja 3 (pod istniejące poligony): zbieranie linii waterway, `stitch()` (skleja segmenty relacji), `simplify(15m)`, `quantize`.
  - Format wyjścia zmieniony z `{polys}` na `{polys, lines}` (linie renderowane jako stroke ~100 m — patrz walkgrid.js).
  - JSDoc w nagłówku pliku opisuje nową sekcję.
- **`js/data.js` `loadWater`**: przepisane z `loadRings` na własną implementację. Zwraca `{polys, lines}` (obie tablice pierścieni `[lat,lon]`, każdy z osobna dekwantyzowany). Kompatybilność wsteczna: jeśli plik ma tylko `polys` bez `lines`, `lines=[]`.
- **`js/walkgrid.js` `buildWalkGrid`**: sygnatura `water` teraz `{polys, lines}`. Po `fill('nonzero')` poligonów — `stroke` linii z `lineWidth = max(3, 100/res)` (~100 m), `lineCap/lineJoin = 'round'`. Wybór 100 m: **2x korytarz mostu** (bridge cut = 50 m) — most-cut wycina rzekę wąskim korytarzem (fala przechodzi), ale poza mostem rzeka pozostaje ciągłą barierą.
- **`js/map.js` `_water`**: obsługa `{polys, lines}`; w `destination-out` bufora stref: fill poligonów + stroke linii z `lineWidth = max(3, 100 * pxPerM)` (~100 m w bieżącym zoomie).
- **`js/app.js`**: `zoneLayer.setWater(water ?? { polys: [], lines: [] })` zamiast `?? []`.
- **`data/*/water.json`**: rebuild wszystkich 18 miast (`node tools/build-water.mjs <miasto>`).
  Największe (linii): GZM 182, Trójmiasto 91, Warszawa 75, Szczecin 166, Wrocław 57, Białystok 50, Kraków 39.
- **Weryfikacja Warszawa** (preview, origin Saska Kępa 52.242,21.055, siatka piesza z samym origin bez pojazdów): Bartycka Siekierki (4225 m linia prosta) z **81 min → UNREACH** (fala nie przechodzi przez Wisłę w linii prostej; realna droga mostem >90 min = powyżej CAP_SEC).
- **Weryfikacja Trójmiasto**: Nowy Port (54.403,18.658) → Westerplatte pomnik / Twierdza Wisłoujście / Terminal promowy pieszo z samego origin = UNREACH (jak dotąd — fala nie przecieka kanału portowego; dodatkowe linie waterway wzmacniają barierę Motławy).
- **Nierozstrzygnięte** (do dalszej pracy): pomiar pokrycia rzek metodą sample co 200m wzdłuż osi lon wciąż niski (~9% Warszawa lon=21.045) — linia rzeki 100 m nie zawsze trafia w oś pomiarową, ale fala rzeczywiście nie przechodzi (dowód pierwszorzędny). Ewentualne szersze rzeki (Wisła 500 m) — linia 100 m to LATA DZIUR w istniejących poligonach, nie zastąpienie ich. Jeżeli pojawi się przeciek, zwiększyć `lineWidth` w `walkgrid.js` i `map.js` (np. 150-200 m); pamiętać o synchronizacji z bridge-cut (obecnie 50 m).

### Sesja 2026-07-17 (cd., niezacommitowane) — PKM/PolRegio dla Trójmiasta (poza tematem wody)

Problem: linia PKM (Pomorska Kolej Metropolitalna) miała w apce **stacje, ale zero kursów** — feed SKM Trójmiasta wypisuje przystanki PKM (Brętowo, Rębiechowo, Port Lotniczy…), lecz nie ma tam żadnych kursów. PKM obsługuje PolRegio. Brak dedykowanego feedu PKM/Pomorze (pkm-sa.pl = tylko PDF; PolRegio publikuje wyłącznie GTFS ogólnopolski z nietrwałym URL). Jedyne trwałe źródło: `mkuran.pl/gtfs/polish_trains.zip` (agencja `PR` = PolRegio, cała Polska).

- **`tools/build-data.mjs` (NOWA ZDOLNOŚĆ)**: opcjonalne per-feed filtry z `cities.json` (dopasowane po nazwie katalogu = `feed.name`, przez `feedCfg`):
  - `keepAgency: ["PR"]` — przy budowie `tripMeta` zostają tylko trasy o danym `agency_id` (dodano czytanie `agency_id` do `routeInfo`).
  - `keepBbox: [minLat, minLon, maxLat, maxLon]` — sekcja **4b** (po zbudowaniu `tripStops`, bo potrzebne współrzędne): zostają tylko kursy z ≥1 przystankiem w prostokącie; **cały przebieg kursu zachowany** (dalekie przystanki jak zwykle, fallback `outside`). Log: „filtr bbox — zostawiono N, usunięto M".
  - JSDoc w nagłówku pliku opisuje oba filtry.
- **`data/cities.json`**: do `trojmiasto.feeds` dodany `{ "name": "polregio", "url": "https://mkuran.pl/gtfs/polish_trains.zip", "keepAgency": ["PR"], "keepBbox": [54.25, 18.0, 54.72, 19.15] }` + credit „PolRegio / PKM". `veh` bez zmian — PolRegio `route_type 2` wpada w istniejący `rail` (🚆 SKM/PKM). Bbox = rdzeń metropolitalny (≈ bbox apki, poszerzony o Kartuzy): kurs kwalifikuje się, gdy realnie obsługuje aglomerację; kursy przybrzeżne/PKM (Gdynia–Hel/Słupsk/Elbląg, Gdańsk–Kartuzy–Somonino→Kościerzyna) wchodzą przez Gdańsk/Gdynię i zostają w całości, a trans-Polska kończące tylko w Słupsku (Zielona Góra→Słupsk) — odrzucone.
- **`data/trojmiasto/{workday,saturday,sunday,meta}.json`**: przebudowane (5 feedów). Filtr PolRegio: zostawiono **607**, usunięto **2778** kursów. Weryfikacja: trasa `REG` (PolRegio, type 2), 84 wzorce/dzień roboczy; PKM obsłużone (Brętowo 7, Kartuzy 5, Port Lotniczy 2, →Kościerzyna via Somonino); brak przecieków Szczecin/Zielona Góra/Koszalin (zostają tylko ogony Bydgoszcz/Piła kursów z Gdyni). Z Kartuz strefa sięga 21 km w głąb Gdańska w 30 min (dawniej tylko autobus ZTM), 84% obszaru w paśmie „ponad 60". Zero błędów konsoli.
- **Uwaga o klastrowaniu**: nazwy stacji różnią się wielkością liter między feedami (SKM „KARTUZY" vs PolRegio „Kartuzy") — klastrowanie zespołów jest po dokładnej nazwie, więc część stacji PKM nie scala się z istniejącymi (duplikat węzła, brak przesiadki między nimi). Do ewentualnego sprzątnięcia (normalizacja wielkości liter w `build-data.mjs` sekcja 3) — dotyczy wszystkich miast, więc świadomie pominięte tu.

### Sesja 2026-07-17 — WKD dla Warszawy (zacommitowane, `33b2097`)

- **`data/cities.json`**: do `warszawa.feeds` dodany feed `{ "name": "wkd", "url": "https://mkuran.pl/gtfs/wkd.zip" }`; drugi wpis w `credits` (WKD). `veh` bez zmian — WKD to `route_type 2`, wpada w istniejący klucz `rail` (🚆 Kolej). Trasa ZKA WKD (`route_type 3`) wpadłaby pod 🚌, ale nie kursuje w wybranych dniach.
- **`data/warszawa/{workday,saturday,sunday,meta}.json`**: przebudowane (`node tools/fetch-feeds.mjs warszawa gtfs-src/warszawa` + `node tools/build-data.mjs warszawa gtfs-src/warszawa/wtp gtfs-src/warszawa/wkd`). Wspólny zakres dat WTP∩WKD = 20260717–20260816. Weryfikacja: trasa `WKD`, 144 kursy/dzień roboczy, stacje Podkowa Leśna…Śródmieście WKD; z Podkowej strefa sięga w głąb Warszawy (70% powierzchni w paśmie „ponad 60"), zero błędów konsoli.
- **Koleje Mazowieckie: ODŁOŻONE.** Brak osiągalnego feedu tylko-KM (mkuran usunął `kolejemazowieckie.zip` 2026-03-31, przyjazdy.pl padł). Jedyne źródło z KM to ogólnopolski `mkuran.pl/gtfs/polish_trains.zip` (28 MB; też PKP IC/PolRegio/KD/…). `agency_id=KM` jest tam czyste (41 linii, prefiks `KM_`). **Filtr `keepAgency` już istnieje** (dodany przy PKM, patrz wyżej) — KM można teraz wpiąć wpisem `{ "name": "km", "url": ".../polish_trains.zip", "keepAgency": ["KM"] }` w `warszawa.feeds` (bez `keepBbox` — KM jest regionalne), gdy użytkownik zdecyduje. Decyzja z sesji: cała agencja KM (z ZKA).

### Sesja 2026-07-15 (niezacommitowane) — spójny dobór przystanku w dymku trasy

- **`js/walkgrid.js`**: `UNREACH` (65535) teraz `export` — używane przez app.js do rozpoznania piksela nieosiągalnego pieszo po lądzie.
- **`js/app.js`**:
  - `lastCompute` niesie teraz `grid` i `gridTime` (ustawiane po zbudowaniu stref w `recompute()`; `null` w trybie bez spaceru / poza siatką).
  - `pickTargetStop(latlng)` przepisane: dla punktu wewnątrz siatki bierze łączny czas z fali po lądzie (`gridTime[pixelIndex(...)]`) zamiast crow-fly przez wodę. Przystanek do rekonstrukcji trasy = najbliższy w linii prostej spośród tych, które mogły być źródłem fali (`minutes[i]*60 ≤ gridTime[idx]`); `walkMin = total − minutes[best]`. `gridTime[idx] ≥ UNREACH` (woda / za wodą) → `null` (bez crow-fly przez wodę). Gdy żaden przystanek nie jest źródłem fali (punkt osiągalny pieszo wprost od origin) → spadek do starej ścieżki crow-fly (żeby klik przy origin nie dawał „Poza zasięgiem"). Poza bboxem siatki (`idx<0`) i tryb bez spaceru — crow-fly bez zmian.
  - JSDoc na `pickTargetStop`.
- **Weryfikacja (preview, Trójmiasto, origin Nowy Port 54.403,18.658, tryb ogólny, spacer):** prawy klik na Westerplatte (54.4075,18.6723, za kanałem) → „≈ 35 min", 24 min dojścia naokoło + przejazd (dawniej „2 min pieszo przez kanał"). Klik dokładnie w origin → „≈ 8 min" (krótki spacer, nie „Poza zasięgiem"). Brak błędów konsoli.

### Poprzednia sesja (zacommitowane w `994f52e`)

- **`js/walkgrid.js` (NOWY)** — całość mechanizmu:
  - `buildWalkGrid(cityKey, cfg, water, bridges, city)`: raster nad bboxem miasta; rozdzielczość `res = max(25, ceil(sqrt(spanX*spanY/4e6)))` m (limit 4 mln komórek; GZM ~40 m); rasteryzacja przez canvas 2D: woda fill nonzero → `land=0`, potem mosty stroke `destination-out` (lineWidth `max(1.5, 50/res)`, round cap/join) → z powrotem ląd; maska granic miasta (`cityMask`, `cityLandPx`) na tej samej siatce do statystyk %; cache per miasto (`gridCache`), bufory reużywalne (`time` Uint16Array, `imageData`, `canvas`).
  - `computeTimeGrid(grid, seeds)`: multi-source Dijkstra kolejką kubełkową po sekundach (0..`CAP_SEC`=5400); koszt kroku `orth = round(res/WALK_MPS)`, `diag = round(orth*SQRT2)`; 8 sąsiadów; seed na pikselu wody → próba przeniesienia na sąsiada lądowego; `UNREACH=65535`.
  - `pixelIndex(grid, lat, lon)`: -1 poza siatką.
  - `maxTimeGrid(grid, a, b)`: max per piksel (tryb porównania; pisze w `grid.time`, b może === grid.time).
  - `renderTimeGrid(grid, time)`: pasma z `BANDS` (isochrone.js) → ImageData (Uint32 little-endian ABGR) → canvas siatki.
  - `areaPercents(grid, time)`: % powierzchni `cityMask∧land` per pasmo, kumulatywnie.
- **`tools/build-bridges.mjs` (NOWY)**: Overpass per miasto: `way["bridge"]["highway"]` + `way["man_made"="pier"]` w bboxie, filtr `NO_FOOT=/motorway|trunk|construction|proposed|raceway/`, simplify 8 m, quantize 1e5 → `data/<miasto>/bridges.json`. Argument `all` = wszystkie miasta. Timeout zapytania 240 s.
- **`data/<miasto>/bridges.json` (NOWE, 18 plików)**: wygenerowane dla wszystkich miast; GZM największy (5438 linii, 232 kB), Warszawa 3357, Trójmiasto 2019.
- **`js/data.js`**: `loadBridges(cityKey)` — fetch + dekwantyzacja, cache, null gdy brak pliku.
- **`js/app.js`**:
  - `cityAssets = {water, city, bridges}` ładowane w `loadCityAssets()` (Promise.all z `loadBridges`); czyszczone w `switchCity` (`cityAssets=null`, `zoneLayer.setGrid(null)`).
  - `recompute()`: gdy `state.walk && cityAssets` → `buildWalkGrid` + `seedsFor(minutes, origin)` (przystanki z `t≤90` → `[pixelIndex, round(t*60)]`, origin z sekundą 0) → `computeTimeGrid`; porównanie: `t1 = computeTimeGrid(seeds1).slice()`, `t2 = computeTimeGrid(seeds2)`, `maxTimeGrid(grid, t1, t2)`; `zoneLayer.setGrid({canvas: renderTimeGrid(...), latN, lonW, latS, lonE})`; przystanki z `pixelIndex<0` → tablica `outside` → `buildZones(net, outside, {walk:true, origin:null})` jako koła fallback; `walk=false` → stara ścieżka kół, `setGrid(null)`.
  - Statystyki %: `areaPercents(grid, gridTime)` wpisywane w `statRows[i].areaPct`; **`initStats`/`resetStats`/`computeAreas` ze `stats.js` już NIEUŻYWANE** (importy usunięte; stats.js zostawione z martwym kodem rastra — do ewentualnego sprzątnięcia).
  - Fix niezwiązany, odkryty przy testach: `map.setView(state.point, 13, {animate:false})` — animowany setView z linku był ubijany przez `invalidateSize` z ResizeObservera (linki nigdy nie przybliżały mapy).
- **`js/map.js`**: `ZoneLayer.setGrid(gridImage)`; w `_redraw` raster rysowany rozciągnięciem `drawImage(g.canvas, tl, br)` między narożnikami bboxa (imageSmoothingEnabled=true), PRZED kołami fallback; erase wody bez zmian (działa na buforze wspólnym dla rastra i kół).
- **`tools/geo.mjs`**: `fetchOverpass` — rotacja mirrorów `overpass-api.de` ↔ `overpass.kumi.systems` przy retry (GZM przechodził tylko przez kumi); obsługa błędów sieciowych (catch → pseudo-status).
- **`index.html`** (pomoc, sekcja „Dojście piesze") i **`README.md`** (Ograniczenia): opis „po lądzie, mosty przepuszczają".

## 2. Struktury danych

- **`data/<miasto>/water.json`**: `{polys: [[[lat*1e5, lon*1e5], ...], ...], lines: [[[lat*1e5, lon*1e5], ...], ...]}`. Pierścienie wody (`polys`) obieg CW (matematycznie, x=lon y=lat), wyspy CCW → wypełnianie canvas regułą **nonzero** daje dziury na wyspach i odporność na nakładanie. Linie rzek/kanałów (`lines`) uzupełniają dziury w poligonach — rysowane w `walkgrid.js` i `map.js` jako `stroke` szerokości ~100 m. Generowane przez `tools/build-water.mjs` (Overpass: coastline + natural=water + waterway=river/canal; miasta nadmorskie mają `seaClose` w cities.json).
- **`data/<miasto>/bridges.json`**: `{lines: [[[lat*1e5, lon*1e5], ...], ...]}` — polilinie (NIE poligony) mostów/kładek/mol.
- **Siatka (`buildWalkGrid` wynik)**: `{W, H, res(m), latS, lonW, latN, lonE, mPerDegLon, land: Uint8Array(W*H) 1=ląd 0=woda, cityMask: Uint8Array|null, cityLandPx, toX(lon), toY(lat), time: Uint16Array, imageData, canvas}`. Indeks piksela = `y*W + x`; `toX/toY` rzut równokątny od narożnika NW.
- **Seeds Dijkstry**: `[[pixelIndex, sekundyStartu], ...]` — sekundy = czas dojazdu do przystanku (z `computeReachability(...).minutes[i]*60`) albo 0 dla punktu użytkownika.
- **Czas w siatce**: Uint16 sekundy całkowitego czasu podróży; `65535 = UNREACH`; cap 5400 s (pasmo „ponad 60" rysowane do 90 min).
- **Stałe**: `WALK_MPS = 4.5/3.6/1.3 ≈ 0.96` (data.js); pasma `BANDS` w `js/isochrone.js` (limity 10/20/30/45/60/90 min + kolory).
- **Fallback kołowy**: `buildZones` (isochrone.js) — promień `(limit − t)*60*WALK_MPS`, crow-fly, bez bariery wody.

## 3. Zablokowane pomysły

- **Ray-casting / clipowanie okręgów do „widoczności" przez wodę** (cień 2D z pierścieni wody jako okluderów): odrzucone — blokuje także mosty (regresja w centrach miast), koszt promienie×segmenty wysoki. Każde podejście bez jawnych mostów przegrywa.
- **Stary raster statystyk (`stats.js: initStats/computeAreas`, koła na osobnej siatce 25 m)**: zastąpiony `areaPercents` na siatce pieszej — dwie osobne siatki dawałyby niespójne wyniki (koła przez wodę vs strefy po lądzie). Nie wracać.
- **Jedna siatka na całą Polskę / bbox obejmujący dalekie stacje SKM**: odpada — bbox Lębork–Tczew rozsadza limit komórek albo degraduje rozdzielczość; stąd fallback kołowy poza bboxem.
- **GNU tar do zipów na Windows** (`tar -xf C:\...`): traktuje `C:` jako host — używać `%SystemRoot%\System32\tar.exe` (bsdtar); już obsłużone w fetch-feeds.
- **Overpass pojedynczym endpointem**: GZM (bbox 2543 km²) stale 504 na overpass-api.de — działa tylko przez mirror kumi.systems + timeout 240 s (już w geo.mjs).
- **Synteza `dblclick`/`click` w preview-browser**: Leaflet ignoruje syntetyczne dblclick (zoom nie działa); klik przez `preview_click`/`computer` ma offset współrzędnych — testować przez `element.click()` w JS albo parametry URL, nie przez symulację myszy.

## 4. Backlog zadań (od użytkownika, 2026-07-17)

Kolejność wg priorytetu; doprecyzowania z rozmowy w nawiasach. Zadania 10–12 to pozostałe luki mechanizmu przekraczania wody (przeniesione z dawnej sekcji „Cel bieżący"). Zadanie 7 (tryb bez spaceru — koła bez bariery wody) rozwiązane, patrz §5.

### Priorytet WYSOKI

1. ~~**SKM Gdańsk — zawyżone czasy przejazdu.**~~ **ROZWIĄZANE** (2026-07-18, §1/§5): obcięcie sekund + delta odjazd−odjazd wliczająca postój. Format v3 (sekundy + rozdział jazda/postój).
2. **Koleje Mazowieckie dla Warszawy + weryfikacja czasów.** Mechanizm gotowy: filtr `keepAgency` w build-data (dodany przy PKM, §1). Wpis w `warszawa.feeds`: `{ "name": "km", "url": "https://mkuran.pl/gtfs/polish_trains.zip", "keepAgency": ["KM"] }` — bez `keepBbox` (KM regionalne, sięga Działdowa/Skierniewic — dalekie stacje jako fallback `outside`). Decyzja użytkownika (sesja 2026-07-17): cała agencja KM, z autobusami ZKA (wpadną pod 🚌). Po dodaniu zweryfikować czasy przejazdów (analogicznie do punktu 1).

### Priorytet ŚREDNI

3. **Przesiadki autobus/tramwaj → metro w Warszawie — weryfikacja.** Sprawdzić, czy przesiadki na metro działają poprawnie (zespoły przystankowe: nazwy stacji metra vs przystanków naziemnych mogą się nie sklejać; metro jest częstotliwościowe — `frequencies.txt`).
4. **Tryb „tylko pieszo".** Nowy środek transportu w panelu: izochrona samego spaceru (bez pojazdów). Siatka piesza już istnieje (`walkgrid.js`) — seed = tylko origin, cap 90 min.
5. **Rower jako dojście (rower + komunikacja).** Rower zamiast spaceru w dojściu do/od przystanków (wyższa prędkość na tej samej siatce z barierą wody; do rozstrzygnięcia: przewóz roweru w pojeździe czy rower zostaje na przystanku).
6. **Kolej podmiejska w Krakowie (dojazd z Wieliczki).** SKA/Koleje Małopolskie — w `polish_trains.zip` agencja `KML` (13 linii). Mechanizm: wpis w `krakow.feeds` z `keepAgency: ["KML"]` (ew. + `keepBbox` na Małopolskę, bo KML jeździ też np. do Tarnowa). Uwaga: pociągi wymagają klucza `rail` w `veh` Krakowa (dziś tylko tram/bus).
### Priorytet NISKI

8. **Ładne screenshoty.** Tryb „czysty widok": zwinięte menu, widoczna tylko legenda + adres strony + niezbędne informacje — do robienia zrzutów ekranu przez użytkowników.
9. **Stopka w menu.** Wyróżnić adres e-mail, dodać linki do social mediów, przenieść przycisk Suppi wyżej.
10. **Przystanki poza bboxem miasta.** Np. Lębork, Tczew w feedzie SKM (bbox z `data/cities.json`): fallback = stare koła crow-fly bez bariery wody (app.js, zmienna `outside`). Mniejszy priorytet — dalekie stacje SKM, rzadkie kliknięcia.
11. **Szerokość korytarza mostu.** `ctx.lineWidth = max(1.5, 50/res)` px (~50 m) — przy równoległych bliskich brzegach (wąskie kanały portowe) korytarz może fałszywie połączyć oba brzegi wzdłuż mostu biegnącego równolegle do kanału. Sprawdzone dla Nowego Portu / Trójmiasto (2026-07-18): fala z origin nie przecieka kanału portowego (wszystkie punkty za kanałem = UNREACH); dedykowany case nie potwierdzony, ale ryzyko teoretyczne pozostaje.
12. **Brak siatki ulic.** Płoty, tory, tereny zamknięte (stocznia!) nieuwzględnione — pełny routing pieszy OSM to osobny, duży temat.

## 5. ROZWIĄZANE

Zadania z backlogu i luki mechanizmu przekraczania wody domknięte w kolejnych sesjach (szczegóły techniczne w §1 „Ostatnie modyfikacje").

- **Zasięg pieszy po lądzie (rdzeń mechanizmu przekraczania wody).** Problem wyjściowy: spacer liczony okręgami w linii prostej „przechodził przez wodę" — np. Westerplatte kolorowane z przystanków Nowego Portu przez kanał portowy; maska `water.json` wycinała wodę tylko WIZUALNIE, ląd za wodą nadal wpadał w promień. Rozwiązanie: zasięg pieszy liczony falowo po siatce lądu (`js/walkgrid.js`), woda = bariera, mosty/kładki/mola = przejezdne korytarze. Zweryfikowane: Westerplatte (fiolet zamiast żółci przez kanał), Warszawa (Praga przez mosty, przewężenia przy przeprawach). Commit `994f52e`.
- **SKM Gdańsk — zawyżone czasy przejazdu (backlog #1).** Przyczyna: `timeToMin` obcinał sekundy + delta odjazd−odjazd wliczała postój na przystanku docelowym (feed SKM ma sekundy i realne postoje). Zaspa→Wrzeszcz: 180 s zamiast 96 s. Rozwiązanie: format danych v3 (sekundy + osobno odjazd/przyjazd, czysta jazda = arr[i+1]−dep[i]). Kod: `tools/build-data.mjs`, `js/data.js` (dekoder v2/v3 wstecznie zgodny), `js/router.js`; rebuild trojmiasto+warszawa. Sesja 2026-07-18 (§1, niezacommitowane).
- **Tryb bez spaceru — koła bez bariery wody (backlog #7).** `walk=false` rysował stałe koła 200 m crow-fly (mogły przeciąć wąski kanał). Rozwiązanie: siatka lądu też dla `walk=false` (`computeNoWalkGrid` w `js/walkgrid.js`) — strefa 200 m wokół przystanku mierzona po lądzie, woda blokuje, kolor = pasmo przyjazdu przystanku (bez czasu dojścia). Kod: `js/isochrone.js` (export `NO_WALK_RADIUS_M`), `js/walkgrid.js`, `js/app.js`. Zweryfikowane syntetycznie (bariera/cap/nakładanie) + realnie (Trójmiasto). Dalekie stacje poza bboxem nadal koła crow-fly = osobny backlog #10. Sesja 2026-07-18 (§1, niezacommitowane).
- **Popup trasy — spójny dobór przystanku (`pickTargetStop`).** Dobór przystanku docelowego w dymku trasy liczył dojście crow-fly przez wodę; przepisane na łączny czas z fali po lądzie (`gridTime[idx]`), crow-fly tylko poza bboxem siatki / w trybie bez spaceru. Sesja 2026-07-15 (§1, niezacommitowane).
- **Przekraczanie wody — czasy fali nierealnie krótkie (backlog #4).** Diagnoza (2026-07-18) rozdzieliła dwa przypadki użytkownika:
  - (a) Trójmiasto Nowy Port → Muzeum Westerplatte „21 min" = autobus (Terminal Promowy 20.58 min, objazd mostem Sucharskiego) + 1 min spacer. Fala pieszo z origin do Westerplatte / Twierdza Wisłoujście / Terminal Promowy = UNREACH — NIE przecieka. Wynik autobusowy poprawny. (Otwarte, osobno: dlaczego autobus w apce 20 min a Google „1h 30 min" transportem publicznym — prawdopodobnie różnica SKM vs autobus miejski w widoku Google.)
  - (b) Warszawa Saska Kępa → Bartycka Siekierki bez autobusów: apka „48 min" pieszo, Google „1h 12 min". FAKTYCZNY PRZECIEK — raster wody miał dziury na Wiśle poniżej Śródmieścia (tylko poligony `natural=water`, brak `waterway=river/canal`). Fix: dodane linie `waterway=river/canal` do maski wody + stroke ~100 m w rasterze. Po fixie Bartycka = UNREACH (realny objazd mostem >90 min). Kod: `tools/build-water.mjs`, `js/data.js`, `js/walkgrid.js`, `js/map.js`, `js/app.js`; rebuild wszystkich 18 miast. Commit `85c7121`.
