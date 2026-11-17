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
- **Dojście do przystanku** — wliczone dojście do przystanków i od przystanku
  docelowego, liczone **po realnej sieci ulic, chodników i ścieżek z OSM**
  (4,5 km/h); po wyłączeniu liczy się wyłącznie od najbliższego zespołu
  przystankowego, a przesiadki tylko w ramach tego samego zespołu.
  Zamiast spaceru można wybrać **rower** (15 km/h po tej samej sieci, dojazd
  do przystanku liczony do 30 min; parametr URL `acc=`): wariant *zostaje na
  przystanku* (bike & ride — od przystanku docelowego idzie się pieszo) albo
  *jedzie z tobą* (rower w pojeździe, oba końce podróży rowerem). Przy kierunku
  „do miejsca" rower dostaje ten, kto podróż zaczyna, czyli strona mapy.
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
  (Trójmiasto: estymacje ZTM Gdańsk; Kraków i Poznań: GTFS-RT TripUpdates)
  i agreguje je per linia × typ dnia × godzina (n, suma, histogram 6 kubełków)
  na gałęzi `delays` — po kilku tygodniach dane wepniemy w silnik.

Punkt można też wskazać wyszukiwarką: od 2 znaków pokazuje od razu przystanki
o pasującej nazwie (z danych już wczytanych, bez zapytań sieciowych), a Enter
dokłada pod nimi adresy (Nominatim/OSM, wyniki zawężone do `bbox` wybranego
miasta). Można też użyć przyciskiem geolokalizacji. Bieżący widok
(punkt i wszystkie opcje) jest zapisywany w adresie URL — przycisk „Kopiuj
link" pozwala go udostępnić.

Panel jest zwijany: miasto, tryb, wyszukiwarka i wynik (legenda, status)
zawsze widać, a rzadziej zmieniane ustawienia siedzą w sekcjach „Czas
i kierunek", „Dojście i środki transportu" oraz „Opóźnienia i statystyki"
(natywne `<details>`, domyślnie zamknięte, z bieżącym podsumowaniem w nagłówku
i kropką przy ustawieniach odbiegających od domyślnych). „Dane i kontakt"
(źródła, daty rozkładu, link do wsparcia) jest przypięte na dole panelu;
ikona ☕ (wsparcie autora) stoi w nagłówku panelu, zawsze widoczna, także przy panelu zwiniętym. Stan sekcji
pamięta `localStorage` (klucz `panel-sections`); nie trafia do adresu URL.

Przycisk „Pobierz strefy (GeoJSON)" zapisuje aktualne strefy jako plik
`izochrona-<miasto>-<yyyymmdd>-<HHMM>.geojson` (MultiPolygon na pasmo, pasma
kumulatywne, współrzędne [lon, lat] z dokładnością do 5 miejsc, metadane widoku
w `properties`). Źródłem są wektorowe obrysy z `buildContours`. Wyszukiwarka
adresów pamięta 5 ostatnio wybranych punktów miasta (localStorage, 90 dni,
opcja „Wyczyść historię"), a pierwsza wizyta pokazuje niemodalną wskazówkę
z trzema krokami.

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

**Polityka prywatności (Z-068).** Link „Polityka prywatności” w stopce sekcji „Dane i kontakt” otwiera okno `#privacyDialog` (administrator danych, Google Analytics po zgodzie, GoatCounter, pamięć lokalna, OpenStreetMap, wyszukiwanie adresu przez Nominatim, lokalizacja, prawa użytkownika). Okno pomocy odsyła do niego zdaniem na końcu akapitu o danych. Ten sam link jest też w banerze zgody. Przy zwiniętym panelu ostrzeżenie o nieaktualnym rozkładzie i komunikat o błędzie zostają widoczne obok legendy. Gdy przeglądarka nie zapisze decyzji o zgodzie, kontrolka wycofania i tak się pokazuje (z informacją, że wybór nie zostanie zapamiętany).

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

Po buildzie `tools/check-data.mjs` sprawdza każde miasto (komplet dni, termin
ważności rozkładu, miasta pominięte z powodu błędu feedu) i przy problemach
workflow zakłada zgłoszenie z etykietą `dane` (albo dopisuje komentarz do
otwartego). Kolektor opóźnień (`collect-delays.yml`, co 15 min) liczy każdy
kurs raz na godzinę w danym dniu — pole `_seen` w agregacie.

### Bramka jakości danych (Z-021)

Workflow nie publikuje danych w ciemno. `build-data.mjs` dopisuje do
`meta.json` metryki (`counts`: przystanki, linie, przesiadki, a per typ dnia
wzorce, kursy i bajty; `grid`: udział przystanków poza siatką pieszą).
Przed commitem `tools/check-data.mjs` porównuje świeże `meta.json` z tym
z `HEAD`, osobno dla każdego miasta:

| Metryka | Ostrzeżenie | Blokada |
|---|---|---|
| kursy (per typ dnia) | spadek ≥10% (i ≥20) | spadek ≥30% i ≥200 |
| wzorce (per typ dnia) | ≥10% (i ≥5) | ≥30% i ≥50 |
| przystanki | ≥5% (i ≥5) | ≥20% i ≥50 |
| linie | ≥5% (i ≥2) | ≥20% i ≥5 |
| przesiadki | ≥15% (i ≥50) | — |
| rozmiar pliku dnia | ≥15% (i ≥20 kB) | ≥40% |
| typ dnia, który zniknął | — | zawsze |
| 0 kursów w którymkolwiek dniu | — | zawsze |
| wzrost dowolnej metryki ≥150% | tak | — |
| przystanki poza siatką pieszą | >2% albo +0,5 pp | — |

Miasto z blokadą jest cofane (`git checkout HEAD -- data/<miasto>`), reszta
publikuje się normalnie; raport „było → jest" trafia do podsumowania workflowu
i zgłoszenia `dane`. Zawór: jeśli opublikowany rozkład wygasa w ≤7 dni (albo
już wygasł), blokada schodzi do ostrzeżenia („PRZEPUSZCZONE AWARYJNIE") — nie
dotyczy 0 kursów ani zniknięcia typu dnia. Brak punktu odniesienia (nowe miasto,
stary `meta.json` bez `counts`) = przejście. Awaria samej bramki nie wstrzymuje
publikacji (komunikat `::warning::`).

**Ręczne przepuszczenie spadku:** Actions → Odśwież dane rozkładowe → Run
workflow → pole `force`: `<miasto>` (kilka po przecinku albo `all`). Po tym
przebiegu punkt odniesienia przesuwa się na nowe dane. Bramka nie dotyczy
`data/delays`.

`fetch-feeds.mjs` pobiera i rozpakowuje wszystkie feedy miasta (w tym
dwustopniowe API Wrocławia). `build-data.mjs` łączy feedy (prefiksując
identyfikatory), odrzuca przystanki bez kursów (feedy zbiorcze wnoszą tysiące
stacji z całej Polski), obsługuje kursowanie przez `calendar_dates`, pełny
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
tools/check-data.mjs   kontrola stanu danych + bramka regresji po odświeżeniu (raport -> zgłoszenie GitHub)
assets/og-image.png    obrazek podglądu linku (og:image), generowany skryptem bez zależności
robots.txt, sitemap.xml  indeksowanie
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
- Rower jeździ po **tej samej sieci co pieszy** — `walknet.json` nie ma tagów
  krawędzi, więc model nie odróżnia schodów i deptaków (czas bywa zaniżony)
  ani nie zna dróg rowerowych z `foot=no`, których w grafie nie ma (czas bywa
  zawyżony). Przesiadki w trakcie podróży są zawsze piesze, także w wariancie
  z rowerem w pojeździe: pary przesiadkowe liczy prekompilacja, jedną miarą
  dla wszystkich trybów.
- Tryb „ogólnie" jest optymistyczny: skleja najszybsze odcinki różnych
  kursów i nie wlicza oczekiwania.
