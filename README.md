# Dokąd dojadę? — izochrony ZTM Gdańsk

Statyczna strona pokazująca, jak daleko można dotrzeć komunikacją miejską ZTM
w Gdańsku (z przesiadkami, opcjonalnie z dojściem pieszym) w ciągu
10 / 20 / 30 / 45 / 60 / ponad 60 minut. Całość liczy się w przeglądarce —
bez backendu.

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

- **Kierunek** — *Z miejsca*: dokąd dotrę z punktu; *Do miejsca*: skąd zdążę
  dotrzeć do punktu.
- **Dojście piesze** — wliczone dojście do przystanków i od przystanku
  docelowego (4,5 km/h ÷ współczynnik krętości ulic 1,3); po wyłączeniu
  liczy się wyłącznie od najbliższego zespołu przystankowego, a przesiadki
  tylko w ramach tego samego zespołu.
- **Ogólnie** — suma czasów przejazdu i przejść, bez czekania na pojazdy
  (algorytm Dijkstry na minimalnych czasach odcinków).
- **O godzinie** — rzeczywisty rozkład z oczekiwaniem na przesiadki
  (algorytm RAPTOR, maks. 4 przesiadki) + wybór typu dnia
  (roboczy / sobota / niedziela).

Panel pokazuje też tabelę statystyk dla wybranego punktu: maksymalną
odległość w linii prostej osiągalną w każdym paśmie czasu oraz — w trybie
ze spacerem — odsetek powierzchni lądowej Gdańska objętej strefą (liczony
rastrowo, 25 m/px, względem granicy administracyjnej z odjęciem wód;
raster daje ~256 km² lądu przy oficjalnych 262 km² powierzchni miasta).

## Odświeżanie danych rozkładowych

Dane pochodzą z [otwartych danych ZTM Gdańsk](https://ckan.multimediagdansk.pl/dataset/tristar)
(licencja CC BY). Feed GTFS obejmuje ok. 15 dni, więc dane warto odświeżać
co tydzień–dwa:

```
curl -L -o gtfs.zip "https://ckan.multimediagdansk.pl/dataset/c24aa637-3619-4dc2-a171-a23eec8f2172/resource/30e783e4-2bec-4a7d-bb22-ee3e3b26ca96/download/gtfsgoogle.zip"
tar -xf gtfs.zip -C gtfs-src   # (Windows: tar rozpakowuje zip; utwórz wcześniej katalog gtfs-src)
node tools/build-data.mjs gtfs-src
```

Skrypt wybiera z feedu reprezentatywny dzień roboczy (wt–czw), sobotę
i niedzielę, buduje wzorce tras z deduplikacją profili czasowych i zapisuje
`data/workday.json`, `data/saturday.json`, `data/sunday.json` (po ~0,3 MB)
oraz `data/meta.json`.

## Struktura

```
index.html             layout + panel opcji
css/style.css          style (paleta UI: 5 kolorów)
js/app.js              stan aplikacji i spięcie kontrolek
js/data.js             ładowanie i dekodowanie data/*.json
js/router.js           RAPTOR (tryb godzinowy) + Dijkstra (tryb ogólny)
js/isochrone.js        czasy dojazdu -> geometria stref (koła spacerowe)
js/map.js              Leaflet + warstwa canvas rysująca strefy
js/stats.js            statystyki: maks. zasięg i % powierzchni miasta
tools/build-data.mjs   prekompilacja GTFS -> data/*.json
tools/build-water.mjs  maska wody z OSM/Overpass -> data/water.json
tools/build-city.mjs   granica adm. Gdańska z OSM -> data/city.json
tools/geo.mjs          wspólne funkcje geometryczne skryptów build-*
tools/serve.mjs        serwer deweloperski
vendor/leaflet/        Leaflet 1.9.4 (zvendorowany)
```

Kolory stref biegną od ciepłych (blisko) do chłodnych (daleko) z monotoniczną
jasnością — porządek stref pozostaje czytelny przy zaburzeniach widzenia barw.
Pasmo „ponad 60 min" jest celowo neutralnie szare. Strefy są maskowane
geometrią wody (`data/water.json`, generowana z OpenStreetMap przez
`node tools/build-water.mjs` — odświeżanie potrzebne tylko, gdyby zmieniła się
linia brzegowa, czyli praktycznie nigdy).

## Ograniczenia

- Tylko linie ZTM Gdańsk (bez SKM/PKM i ZKM Gdynia).
- Dojście piesze liczone w linii prostej z korektą na krętość ulic,
  nie po rzeczywistej siatce ulic.
- Tryb „ogólnie" jest optymistyczny: skleja najszybsze odcinki różnych
  kursów i nie wlicza oczekiwania.
