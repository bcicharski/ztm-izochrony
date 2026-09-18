# Dokąd dojadę? — izochrony komunikacji miejskiej

Statyczna strona pokazująca, jak daleko można dotrzeć komunikacją miejską
(z przesiadkami, opcjonalnie z dojściem pieszym) w ciągu
10 / 20 / 30 / 45 / 60 / ponad 60 minut. Obsługiwane są 18 miast i aglomeracji:
**Trójmiasto** (ZTM Gdańsk + ZKM Gdynia + SKM/PKM + MZK Wejherowo + PolRegio),
**Warszawa** (tramwaje, autobusy, metro, SKM, WKD, Koleje Mazowieckie),
**Kraków** (z autobusami aglomeracyjnymi i koleją SKA), **aglomeracja śląska
(GZM)**, Wrocław, Poznań, Łódź, Szczecin, Lublin, Bydgoszcz, Białystok,
Rzeszów, Olsztyn, Toruń, Kielce, Opole, Zielona Góra i Gorzów Wielkopolski.
Całość liczy się w przeglądarce — bez backendu, w Web Workerze (mapa reaguje
w trakcie liczenia; przeglądarki bez OffscreenCanvas liczą w wątku głównym,
to samo wymusza parametr URL `engine=main`); wszystko, co miejskie
(feedy GTFS, granice, maski wody, punkty domyślne, grupy pojazdów, atrybucje),
definiuje `data/cities.json`, a dane leżą w `data/<miasto>/`.

## Uruchomienie lokalne

Dwuklik na `start.bat` (uruchamia serwer i otwiera przeglądarkę), albo ręcznie:

```
node tools/serve.mjs
```

i otwarcie `http://localhost:8123`.

**Uwaga:** otwarcie `index.html` bezpośrednio z dysku (`file://`) nie zadziała —
strona wymaga serwera HTTP (moduły ES i pobieranie danych są wtedy blokowane
przez przeglądarkę). Strona pokazuje wówczas stosowny komunikat.

## Opcje na stronie

Na górze panelu wybiera się tryb: **Zasięg transportu** (jeden punkt) albo
**Porównaj dwa punkty** (drugi znacznik z własną wyszukiwarką; strefa = czas
wolniejszej osoby, klik na mapie przesuwa bliższy znacznik). Domyślnie aktywne
są „O godzinie" (bieżąca godzina i dzisiejszy typ dnia) oraz „Uwzględnij
spacer". Legenda kolorów jest zawsze widoczna; tabela statystyk (tylko w trybie
jednego punktu) pojawia się po włączeniu „Pokaż statystyki".

- **Kierunek** — *Z miejsca*: dokąd dotrę z punktu; *Do miejsca*: skąd zdążę
  dotrzeć do punktu.
- **Dojście piesze** — wliczone dojście do przystanków i od przystanku
  docelowego, liczone **po realnej sieci ulic, chodników i ścieżek z OSM**
  (4,5 km/h); po wyłączeniu liczy się wyłącznie od najbliższego zespołu
  przystankowego, a przesiadki tylko w ramach tego samego zespołu.
- **Ogólnie** — suma czasów przejazdu i przejść, bez czekania na pojazdy
  (algorytm Dijkstry na minimalnych czasach odcinków).
- **O godzinie** — rzeczywisty rozkład z oczekiwaniem na przesiadki
  (algorytm RAPTOR, maks. 4 przesiadki) + wybór typu dnia
  (roboczy / sobota / niedziela).
- **Porównanie dwóch punktów** — drugi znacznik; strefa pokazuje miejsca
  osiągalne przez obie osoby (czas = wolniejsza z nich). Przy kierunku
  „do miejsca": obszar z dojazdem do obu punktów.
- **Środki transportu** — analiza może być ograniczona do wybranych pojazdów
  (tramwaj / autobus / trolejbus / kolej SKM/PKM); parametr URL `veh=`.
  Odznaczenie wszystkich włącza tryb **tylko pieszo**: izochrona samego
  spaceru (do 90 min), liczona falowo po lądzie z pominięciem routingu.
- **Trasa** — prawy klik (na telefonie przytrzymanie) w dowolne miejsce mapy
  pokazuje proponowaną trasę: dojścia piesze, linie, przesiadki i godziny
  (rekonstrukcja ścieżki z RAPTOR-a/Dijkstry); w porównaniu — trasy obu osób.
- **Tryb ostrożny** — heurystyczny margines na opóźnienia: bufor przesiadkowy
  4 min (zamiast 1) i czasy jazdy +15% autobusy/trolejbusy, +5% tramwaje,
  +2% kolej/metro; URL `safe=1`. Docelowo zastąpią go rzeczywiste profile
  opóźnień: workflow `collect-delays.yml` zbiera co ~15 min obserwacje
  (Trójmiasto: estymacje ZTM Gdańsk; Kraków: GTFS-RT TripUpdates autobusów)
  i agreguje je per linia × typ dnia × godzina (n, suma, histogram 6 kubełków)
  na gałęzi `delays` — po kilku tygodniach dane wepniemy w silnik.

Punkt można też wskazać wyszukiwarką adresów (Nominatim/OSM, wyniki zawężone
do `bbox` wybranego miasta) albo przyciskiem geolokalizacji. Bieżący widok
(punkt i wszystkie opcje) jest zapisywany w adresie URL — przycisk „Kopiuj
link" pozwala go udostępnić.

Panel pokazuje też tabelę statystyk dla wybranego punktu: maksymalną
odległość w linii prostej osiągalną w każdym paśmie czasu oraz — w trybie
ze spacerem — odsetek powierzchni lądowej miasta objętej strefą (liczony na
siatce pieszej, 25–40 m/px, względem granic administracyjnych z odjęciem
wód; dla aglomeracji łącznie wszystkich gmin z pola `boundaries`, np.
Trójmiasto = Gdańsk, Sopot, Gdynia, Rumia, Reda, Wejherowo).

Stopka pokazuje datę rozkładu i termin jego ważności (`feedEndDate`
z `data/<miasto>/meta.json`). Po tym terminie panel wyświetla ostrzeżenie,
a typy dnia, których build nie wygenerował (`meta.dates`), są wyłączone
w selektorze.

## Testy i lint

```
npm install
npm test        # testy silnika (node:test, katalog tests/)
npm run lint    # ESLint
```

Testy porównują RAPTOR z niezależną wyrocznią na losowych sieciach, sprawdzają
dekoder, sieć odwróconą, falę po rastrze lądu i graf ulic. Workflow
`.github/workflows/ci.yml` uruchamia lint i testy przy każdym pushu.

## Odświeżanie danych rozkładowych

Wszystkie źródła to otwarte dane (adresy w `data/cities.json`, widoczne też
w stopce panelu). Zakresy publikowanych rozkładów są ograniczone (np. ZTM
Gdańsk ~15 dni naprzód), więc dane odświeża co poniedziałek workflow GitHub
Actions. Ręcznie, dla jednego miasta:

```
node tools/fetch-feeds.mjs warszawa gtfs-src/warszawa
node tools/build-data.mjs warszawa gtfs-src/warszawa/*/
```

`fetch-feeds.mjs` pobiera i rozpakowuje wszystkie feedy miasta (w tym
dwustopniowe API Wrocławia). `build-data.mjs` łączy feedy (prefiksując
identyfikatory), obsługuje kursowanie przez `calendar_dates`, pełny
`calendar.txt` z flagami dni oraz kursy częstotliwościowe `frequencies.txt`
(metro warszawskie), wybiera reprezentatywny dzień roboczy (wt–czw), sobotę
i niedzielę ze wspólnego zakresu dat, buduje wzorce tras z deduplikacją
profili czasowych i zapisuje `data/<miasto>/{workday,saturday,sunday,meta}.json`
(0,6–1,9 MB na dzień). Zespoły przystankowe wyznacza po nazwie z klastrowaniem
odległościowym (≤300 m), żeby identyczne nazwy w różnych miejscach nie zlewały
się w jeden węzeł przesiadkowy. Czasy przesiadek pieszych bierze z sieci ulic
(`data/<miasto>/walknet.json`, jeśli jest — inaczej z linii prostej), więc graf
warto zbudować przed rozkładami.

## Struktura

```
index.html             layout + panel opcji
css/style.css          style (paleta UI: 5 kolorów)
js/app.js              stan aplikacji, kontrolki, klient silnika (worker / wątek główny)
js/engine.js           silnik: RAPTOR → fala po siatce → raster → obrysy; dymek trasy
js/worker.js           Web Worker opakowujący engine.js (obliczenia poza wątkiem UI)
js/data.js             ładowanie i dekodowanie data/*.json (+ cache per miasto)
js/router.js           RAPTOR (tryb godzinowy) + Dijkstra (tryb ogólny)
js/walknet.js          routing pieszy po grafie ulic z OSM
js/walkgrid.js         siatka lądu: fala piesza, woda jako bariera, raster stref
js/isochrone.js        pasma czasu + koła fallbacku poza siatką
js/map.js              Leaflet + warstwa canvas: obrysy wektorowe stref (raster do czasu ich policzenia)
js/stats.js            statystyka maks. zasięgu (% powierzchni liczy walkgrid.js)
data/cities.json       konfiguracja miast (feedy, granice, pojazdy, punkty)
tools/fetch-feeds.mjs  pobieranie i rozpakowanie feedów miasta
tools/build-data.mjs   prekompilacja GTFS (wiele feedów) -> data/<miasto>/*.json
tools/build-walknet.mjs graf dróg pieszych z OSM -> data/<miasto>/walknet.json
tools/build-water.mjs  maska wody z OSM/Overpass -> data/<miasto>/water.json
tools/build-bridges.mjs mosty/kładki/mola z OSM -> data/<miasto>/bridges.json
tools/build-city.mjs   granice administracyjne -> data/<miasto>/city.json
tools/collect-delays.mjs kolektor opóźnień (GTFS-RT / ZTM Gdańsk) -> gałąź delays
tools/build-delays.mjs profile opóźnień -> data/<miasto>/delays.json
tools/geo.mjs          wspólne funkcje geometryczne skryptów build-*
tools/serve.mjs        serwer deweloperski
tests/                 testy (node:test) + wyrocznia i generator sieci w helpers.mjs
vendor/leaflet/        Leaflet 1.9.4 (zvendorowany)
vendor/d3-contour/     d3-contour 4 (ESM zbudowany esbuildem; obrysy stref)
```

Nowe miasto = wpis w `data/cities.json` + `fetch-feeds`/`build-data`/
`build-water`/`build-city` — bez zmian w kodzie aplikacji.

Kolory stref biegną od ciepłych (blisko) do chłodnych (daleko) z monotoniczną
jasnością — porządek stref pozostaje czytelny przy zaburzeniach widzenia barw.
Pasmo „ponad 60 min" jest celowo neutralnie szare. Strefy są maskowane
geometrią wody (`data/water.json`, generowana z OpenStreetMap przez
`node tools/build-water.mjs` — odświeżanie potrzebne tylko, gdyby zmieniła się
linia brzegowa, czyli praktycznie nigdy).

## Ograniczenia

- Bez połączeń regionalnych spoza sieci miejskiej (Polregio, PKS itd.);
  feed SKM sięga jednak aż po Wejherowo/Lębork i Tczew.
- Dojście piesze liczone po grafie dróg z OSM (`tools/build-walknet.mjs` →
  `data/<miasto>/walknet.json`); od sieci strefa rozlewa się na ~75 m po
  rastrze lądu, więc wnętrza dużych zamkniętych kwartałów zostają puste.
  Zanim graf się dociągnie (~1 MB), strefy rysuje sama fala po rastrze lądu
  (woda blokuje, mosty/kładki/mola z OSM przepuszczają), która nie zna ulic.
  Zakres jak siatka — `gridBbox` z `cities.json` (bbox miasta poszerzony
  o przystanki do ~5 km za jego granicą, np. Pruszcz Gdański, Wieliczka);
  dalekie stacje kolejowe (Lębork, Tczew, Działdowo) leżą poza nim i mają
  uproszczony zasięg kołowy ograniczony do 1 km, bez bariery wody.
- Czasy dojścia **wewnątrz silnika rozkładowego** liczy ten sam graf:
  przesiadki piesze wyznacza prekompilacja (`build-data.mjs` — para odpada,
  gdy realna droga przekracza 650 m, więc dwa brzegi kanału przestają być
  przesiadką), a dojście do przystanków startowych — Dijkstra po grafie
  z punktu użytkownika. Punkt i przystanki przyłączają się do sieci **rzutem
  na krawędzie** (wszystkie nie dalej niż najbliższa + 25 m, żeby jezdnia
  i równoległy chodnik były równorzędnymi kandydatami), nie do najbliższego
  skrzyżowania — graf jest skontrahowany i krawędź bywa długa (co setna ponad
  600 m). Linia prosta z ryczałtem 1,3 zostaje tylko tam, gdzie graf milczy:
  przystanki dalej niż 400 m od jakiejkolwiek drogi i dalekie stacje spoza
  `gridBbox`. Dojście dłuższe niż 90 min nie jest brane pod uwagę.
- Sieć piesza nie rozróżnia przewyższeń, schodów ani jakości nawierzchni:
  wszystkie drogi przechodzi się z tą samą prędkością 4,5 km/h.
- Tryb „ogólnie" jest optymistyczny: skleja najszybsze odcinki różnych
  kursów i nie wlicza oczekiwania.
