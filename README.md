# Dokąd dojadę? — izochrony komunikacji miejskiej

Statyczna strona pokazująca, jak daleko można dotrzeć komunikacją miejską
(z przesiadkami, opcjonalnie z dojściem pieszym) w ciągu
10 / 20 / 30 / 45 / 60 / ponad 60 minut. Obsługiwane miasta: **Trójmiasto**
(ZTM Gdańsk + ZKM Gdynia + SKM/PKM), **Warszawa** (tramwaje, autobusy, metro,
kolej miejska), **Wrocław**, **Kraków** (z autobusami aglomeracyjnymi i koleją SKA),
**Poznań** i **Łódź**.
Całość liczy się w przeglądarce — bez backendu; wszystko, co miejskie
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
do okolic Trójmiasta) albo przyciskiem geolokalizacji. Bieżący widok (punkt
i wszystkie opcje) jest zapisywany w adresie URL — przycisk „Kopiuj link"
pozwala go udostępnić.

Panel pokazuje też tabelę statystyk dla wybranego punktu: maksymalną
odległość w linii prostej osiągalną w każdym paśmie czasu oraz — w trybie
ze spacerem — odsetek powierzchni lądowej miasta objętej strefą (liczony
rastrowo, 25 m/px, względem granic administracyjnych z odjęciem wód;
dla Trójmiasta: Gdańsk+Sopot+Gdynia łącznie).

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
się w jeden węzeł przesiadkowy.

## Struktura

```
index.html             layout + panel opcji
css/style.css          style (paleta UI: 5 kolorów)
js/app.js              stan aplikacji i spięcie kontrolek
js/data.js             ładowanie i dekodowanie data/*.json
js/router.js           RAPTOR (tryb godzinowy) + Dijkstra (tryb ogólny)
js/walknet.js          routing pieszy po grafie ulic z OSM
js/isochrone.js        czasy dojazdu -> geometria stref (koła spacerowe)
js/map.js              Leaflet + warstwa canvas rysująca strefy
js/stats.js            statystyki: maks. zasięg i % powierzchni miasta
data/cities.json       konfiguracja miast (feedy, granice, pojazdy, punkty)
tools/fetch-feeds.mjs  pobieranie i rozpakowanie feedów miasta
tools/build-data.mjs   prekompilacja GTFS (wiele feedów) -> data/<miasto>/*.json
tools/build-walknet.mjs graf dróg pieszych z OSM -> data/<miasto>/walknet.json
tools/build-water.mjs  maska wody z OSM/Overpass -> data/<miasto>/water.json
tools/build-city.mjs   granice administracyjne -> data/<miasto>/city.json
tools/geo.mjs          wspólne funkcje geometryczne skryptów build-*
tools/serve.mjs        serwer deweloperski
vendor/leaflet/        Leaflet 1.9.4 (zvendorowany)
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
- Czasy dojścia **wewnątrz silnika rozkładowego** (dobór przystanków
  startowych i przesiadki piesze ≤500 m) są nadal liczone w linii prostej
  z ryczałtem na krętość ulic 1,3 — graf wpływa na kształt stref i na czasy
  pokazywane na mapie, ale nie na to, które przesiadki RAPTOR uzna za możliwe.
- Sieć piesza nie rozróżnia przewyższeń, schodów ani jakości nawierzchni:
  wszystkie drogi przechodzi się z tą samą prędkością 4,5 km/h.
- Tryb „ogólnie" jest optymistyczny: skleja najszybsze odcinki różnych
  kursów i nie wlicza oczekiwania.
