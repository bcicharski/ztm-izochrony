# Dokąd dojadę? — izochrony komunikacji miejskiej Trójmiasta

Statyczna strona pokazująca, jak daleko można dotrzeć komunikacją miejską
w Trójmieście — ZTM Gdańsk, ZKM Gdynia oraz koleją SKM/PKM (z przesiadkami,
opcjonalnie z dojściem pieszym) — w ciągu 10 / 20 / 30 / 45 / 60 / ponad 60
minut. Całość liczy się w przeglądarce — bez backendu.

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
  docelowego (4,5 km/h ÷ współczynnik krętości ulic 1,3); po wyłączeniu
  liczy się wyłącznie od najbliższego zespołu przystankowego, a przesiadki
  tylko w ramach tego samego zespołu.
- **Ogólnie** — suma czasów przejazdu i przejść, bez czekania na pojazdy
  (algorytm Dijkstry na minimalnych czasach odcinków).
- **O godzinie** — rzeczywisty rozkład z oczekiwaniem na przesiadki
  (algorytm RAPTOR, maks. 4 przesiadki) + wybór typu dnia
  (roboczy / sobota / niedziela).
- **Porównanie dwóch punktów** — drugi znacznik; strefa pokazuje miejsca
  osiągalne przez obie osoby (czas = wolniejsza z nich). Przy kierunku
  „do miejsca": obszar z dojazdem do obu punktów.

Punkt można też wskazać wyszukiwarką adresów (Nominatim/OSM, wyniki zawężone
do okolic Trójmiasta) albo przyciskiem geolokalizacji. Bieżący widok (punkt
i wszystkie opcje) jest zapisywany w adresie URL — przycisk „Kopiuj link"
pozwala go udostępnić.

Panel pokazuje też tabelę statystyk dla wybranego punktu: maksymalną
odległość w linii prostej osiągalną w każdym paśmie czasu oraz — w trybie
ze spacerem — odsetek łącznej powierzchni lądowej Gdańska, Sopotu i Gdyni
objętej strefą (liczony rastrowo, 25 m/px, względem granic administracyjnych
z odjęciem wód).

## Odświeżanie danych rozkładowych

Źródła (wszystkie otwarte):
[ZTM Gdańsk](https://ckan.multimediagdansk.pl/dataset/tristar) (CC BY),
[ZKM Gdynia](https://otwartedane.gdynia.pl) i
[PKP SKM w Trójmieście](https://bip.skm.pkp.pl/c97/otwarte-dane) — feed SKM
obejmuje też pociągi linii PKM. Wspólny zakres dat feedów jest ograniczony
(ZTM publikuje ~15 dni naprzód), więc dane warto odświeżać co tydzień–dwa.
Robi to automatycznie workflow GitHub Actions (poniedziałki), ręcznie:

```
mkdir gtfs-src\ztm gtfs-src\zkm gtfs-src\skm
curl -L -o ztm.zip "https://ckan.multimediagdansk.pl/dataset/c24aa637-3619-4dc2-a171-a23eec8f2172/resource/30e783e4-2bec-4a7d-bb22-ee3e3b26ca96/download/gtfsgoogle.zip"
curl -L -o zkm.zip "http://api.zdiz.gdynia.pl/pt/gtfs.zip"
curl -L -o skm.zip "https://www.skm.pkp.pl/gtfs-mi-kpd.zip"
tar -xf ztm.zip -C gtfs-src/ztm & tar -xf zkm.zip -C gtfs-src/zkm & tar -xf skm.zip -C gtfs-src/skm
node tools/build-data.mjs gtfs-src/ztm gtfs-src/zkm gtfs-src/skm
```

Skrypt łączy feedy (prefiksując identyfikatory), wybiera reprezentatywny
dzień roboczy (wt–czw), sobotę i niedzielę ze wspólnego zakresu dat, buduje
wzorce tras z deduplikacją profili czasowych i zapisuje `data/workday.json`,
`data/saturday.json`, `data/sunday.json` (po ~0,6–0,8 MB) oraz `data/meta.json`.
Zespoły przystankowe wyznacza po nazwie z klastrowaniem odległościowym
(≤300 m), żeby identyczne nazwy w różnych miastach nie zlewały się w jeden
węzeł przesiadkowy.

## Struktura

```
index.html             layout + panel opcji
css/style.css          style (paleta UI: 5 kolorów)
js/app.js              stan aplikacji i spięcie kontrolek
js/data.js             ładowanie i dekodowanie data/*.json
js/router.js           RAPTOR (tryb godzinowy) + Dijkstra (tryb ogólny)
js/isochrone.js        czasy dojazdu -> geometria stref (koła spacerowe)
js/map.js              Leaflet + warstwa canvas rysująca strefy
js/stats.js            statystyki: maks. zasięg i % powierzchni Trójmiasta
tools/build-data.mjs   prekompilacja GTFS (wiele feedów) -> data/*.json
tools/build-water.mjs  maska wody z OSM/Overpass -> data/water.json
tools/build-city.mjs   granice adm. Gdańska, Sopotu i Gdyni -> data/city.json
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

- Bez połączeń regionalnych spoza sieci miejskiej (Polregio, PKS itd.);
  feed SKM sięga jednak aż po Wejherowo/Lębork i Tczew.
- Dojście piesze liczone w linii prostej z korektą na krętość ulic,
  nie po rzeczywistej siatce ulic.
- Tryb „ogólnie" jest optymistyczny: skleja najszybsze odcinki różnych
  kursów i nie wlicza oczekiwania.
