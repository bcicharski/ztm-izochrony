# CURRENT_STATE — mechanizm przekraczania wody (zasięg pieszy)

Stan na 2026-07-15, na bazie commitu `994f52e` (wdrożony na https://transport.excelninja.pro). Niezacommitowane: naprawa `pickTargetStop` (dymek trasy po siatce) — patrz §2.

## 1. Cel bieżący

Problem wyjściowy (zgłoszony przez użytkownika): spacer liczony okręgami w linii prostej „przechodził przez wodę" — np. Westerplatte kolorowane z przystanków Nowego Portu przez kanał portowy. Maska wody (`data/<miasto>/water.json`) wycinała wodę tylko WIZUALNIE; ląd za wodą nadal wpadał w promień.

Rozwiązanie WDROŻONE: zasięg pieszy liczony falowo po siatce lądu (`js/walkgrid.js`), woda = bariera, mosty/kładki/mola = przejezdne korytarze. Zweryfikowane: Westerplatte (fiolet zamiast żółci przez kanał), Warszawa (Praga przez mosty, przewężenia przy przeprawach).

Pozostałe znane luki mechanizmu (kandydaci na dalszą pracę):
- **Tryb bez spaceru** (`walk=false`): przystanki rysowane stałymi kołami 200 m (`js/isochrone.js`, `NO_WALK_RADIUS_M`) — koło może przeciąć wąski kanał; siatka tam nie działa.
- **Przystanki poza bboxem miasta** (np. Lębork, Tczew w feedzie SKM; bbox z `data/cities.json`): fallback = stare koła crow-fly bez bariery wody (app.js, zmienna `outside`).
- ~~**Popup trasy** (`pickTargetStop` w app.js): dobór przystanku docelowego liczył dojście crow-fly przez wodę.~~ **NAPRAWIONE** (ta sesja, §2): wewnątrz siatki łączny czas z `gridTime[idx]`, crow-fly tylko poza bboxem / bez spaceru.
- **Szerokość korytarza mostu**: `ctx.lineWidth = max(1.5, 50/res)` px (~50 m) — przy równoległych bliskich brzegach (wąskie kanały portowe) korytarz może fałszywie połączyć oba brzegi wzdłuż mostu biegnącego równolegle do kanału.
- Brak siatki ulic: płoty, tory, tereny zamknięte (stocznia!) nieuwzględnione — pełny routing pieszy OSM to osobny, duży temat.

## 2. Ostatnie modyfikacje

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

## 3. Struktury danych

- **`data/<miasto>/water.json`**: `{polys: [[[lat*1e5, lon*1e5], ...], ...]}`. Pierścienie wody obieg CW (matematycznie, x=lon y=lat), wyspy CCW → wypełnianie canvas regułą **nonzero** daje dziury na wyspach i odporność na nakładanie. Generowane przez `tools/build-water.mjs` (Overpass: coastline + natural=water; miasta nadmorskie mają `seaClose` w cities.json).
- **`data/<miasto>/bridges.json`**: `{lines: [[[lat*1e5, lon*1e5], ...], ...]}` — polilinie (NIE poligony) mostów/kładek/mol.
- **Siatka (`buildWalkGrid` wynik)**: `{W, H, res(m), latS, lonW, latN, lonE, mPerDegLon, land: Uint8Array(W*H) 1=ląd 0=woda, cityMask: Uint8Array|null, cityLandPx, toX(lon), toY(lat), time: Uint16Array, imageData, canvas}`. Indeks piksela = `y*W + x`; `toX/toY` rzut równokątny od narożnika NW.
- **Seeds Dijkstry**: `[[pixelIndex, sekundyStartu], ...]` — sekundy = czas dojazdu do przystanku (z `computeReachability(...).minutes[i]*60`) albo 0 dla punktu użytkownika.
- **Czas w siatce**: Uint16 sekundy całkowitego czasu podróży; `65535 = UNREACH`; cap 5400 s (pasmo „ponad 60" rysowane do 90 min).
- **Stałe**: `WALK_MPS = 4.5/3.6/1.3 ≈ 0.96` (data.js); pasma `BANDS` w `js/isochrone.js` (limity 10/20/30/45/60/90 min + kolory).
- **Fallback kołowy**: `buildZones` (isochrone.js) — promień `(limit − t)*60*WALK_MPS`, crow-fly, bez bariery wody.

## 4. Zablokowane pomysły

- **Ray-casting / clipowanie okręgów do „widoczności" przez wodę** (cień 2D z pierścieni wody jako okluderów): odrzucone — blokuje także mosty (regresja w centrach miast), koszt promienie×segmenty wysoki. Każde podejście bez jawnych mostów przegrywa.
- **Stary raster statystyk (`stats.js: initStats/computeAreas`, koła na osobnej siatce 25 m)**: zastąpiony `areaPercents` na siatce pieszej — dwie osobne siatki dawałyby niespójne wyniki (koła przez wodę vs strefy po lądzie). Nie wracać.
- **Jedna siatka na całą Polskę / bbox obejmujący dalekie stacje SKM**: odpada — bbox Lębork–Tczew rozsadza limit komórek albo degraduje rozdzielczość; stąd fallback kołowy poza bboxem.
- **GNU tar do zipów na Windows** (`tar -xf C:\...`): traktuje `C:` jako host — używać `%SystemRoot%\System32\tar.exe` (bsdtar); już obsłużone w fetch-feeds.
- **Overpass pojedynczym endpointem**: GZM (bbox 2543 km²) stale 504 na overpass-api.de — działa tylko przez mirror kumi.systems + timeout 240 s (już w geo.mjs).
- **Synteza `dblclick`/`click` w preview-browser**: Leaflet ignoruje syntetyczne dblclick (zoom nie działa); klik przez `preview_click`/`computer` ma offset współrzędnych — testować przez `element.click()` w JS albo parametry URL, nie przez symulację myszy.

## 5. Kolejny krok

Dymek trasy (`pickTargetStop`) załatwiony (§2). Następny kandydat z §1 — **tryb bez spaceru** (`walk=false`): przystanki rysowane stałymi kołami `NO_WALK_RADIUS_M`=200 m w `js/isochrone.js`, bez bariery wody — koło może przeciąć wąski kanał (regresja tego samego typu co pierwotny problem, tylko dla `walk=false`). Do rozważenia: przyciąć koła geometrią `water.json` przy rysowaniu (warstwa i tak eraseuje wodę w `map.js`, więc wizualnie znika, ale statystyki/„osiągalność" liczą się z pełnego koła), albo — spójniej — zbudować siatkę pieszą też dla `walk=false` z zerowym promieniem dojścia (tylko piksel przystanku jako seed), co wymaga oddzielenia „progu dojścia" od budowy siatki. Alternatywnie: przystanki poza bboxem siatki (`outside` w `recompute()`) wciąż crow-fly — mniejszy priorytet (dalekie stacje SKM, rzadkie kliknięcia).
