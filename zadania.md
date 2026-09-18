# Zadania — „Dokąd dojadę?" (izochrony komunikacji miejskiej)

Stan na 2026-09-16. Analiza kodu: `index.html`, `js/*`, `tools/*`, `css/style.css`,
`data/cities.json`, workflowy GitHub Actions oraz `README.md` / `CURRENT_STATE.md`.

Problemy uszeregowane od najważniejszych do najmniej ważnych. Każdy ma odnośnik
do pliku i linii, żeby dało się od razu skoczyć do kodu.

---

## PROBLEMY

### Stan realizacji (2026-09-17)

Zrobione lokalnie, niewypchnięte do repo — do przejrzenia:

- **#1 wyjaśnione (2026-09-18)** — workflow `refresh-data.yml` DZIAŁA:
  `git fetch` pokazał 9 cotygodniowych commitów, a po `pull` wszystkie 18 miast
  ma dane z 2026-09-14 z terminami ważności od 27.09 do 02.03.2027. Stare daty
  to była wyłącznie zaległość lokalnej kopii. Zabezpieczenia w UI zostają:
  stopka „ważny do", ostrzeżenie po terminie (`applyMeta` w `js/app.js`).
- **#2** — typy dnia bez danych wyłączane w selektorze; `build-data.mjs` usuwa
  pliki dni, których nie zbudował. Po `pull` Poznań ma komplet trzech dni, więc
  niespójne pliki weekendowe zniknęły same.
- **#3** — `build-data.mjs` zapisuje `routeNames` (route_id → nazwa) do
  `meta.json`, kolektor mapuje po tej tabeli, `build-delays.mjs` odrzuca
  klucze linii nieznanych silnikowi. `meta.json` Krakowa, Warszawy i Trójmiasta
  uzupełnione od razu; pozostałe miasta dostaną mapę przy najbliższym buildzie.
- **#4** — skrypt AdSense wstrzykiwany dopiero w `loadAds()`, w `<head>`
  został tylko meta tag weryfikacyjny. **Otwarte:** certyfikowany CMP
  (ustawienie w panelu AdSense, poza kodem).
- **#8 (pakiet drobnych)** — #12 style listy B, #13 ujemne godziny,
  #14 `localStorage` w try/catch, #15 dwa przeliczenia zamiast trzech,
  #16 komunikat poza siatką, #17 martwy kod w `stats.js`, #18 README i teksty
  w HTML, #22 wspólne stałe (`build-data.mjs`, `map.js`), #23 `viewbox`
  liczony z `bbox` (usunięty z `cities.json`), #24 klucz krawędzi,
  #28 import statyczny, #31 komunikat przy braku konfiguracji,
  #32 endpoint debug usunięty, #33 `start.bat` z opóźnieniem.
- **#10** — `dropCityCache` + `dropGrid` przy przełączeniu miasta, sieć
  odwrócona budowana leniwie.
- **#6** — RAPTOR dokłada bufor przy wsiadaniu tylko po dojeździe pojazdem
  (`kindPrev` w `js/router.js`); po przejściu pieszym minimum siedzi już
  w czasie marszu. Pomiar A/B (pointA, dzień roboczy 12:00, spacer), przystanki
  osiągalne ≤60 min: Trójmiasto 2087 → 2137 (ostrożny 1763 → 1936),
  Warszawa 4904 → 4939 (ostrożny 4366 → 4621). Przykład: Wrzeszcz → Rębiechowo
  w trybie ostrożnym 57,1 → 56,0 min (ta sama trasa, mniej sztucznego czekania).

- **#7** — przyłączanie do sieci pieszej rzutem na krawędzie zamiast do
  najbliższego węzła (`snapEdges` / `snapSeeds` / `snapTime` / `sameEdgeSec`
  w `js/walknet.js`, indeks przestrzenny krawędzi budowany przy dekodowaniu).
  Bez przebudowy `walknet.json`: zmierzono, że realna długość ulicy odbiega od
  cięciwy krawędzi o 0,8 % w medianie, więc rzut na cięciwę wystarcza. Zamiast
  jednej „zwycięskiej" krawędzi lista kandydatek (najbliższa + 25 m) — inaczej
  punkt na chodniku równoległym do 800-m jezdni dostawał jezdnię i 400 m marszu
  do skrzyżowania. `paintNetwork` maluje wnętrze krawędzi źródła wprost od
  rzutu. Pomiar (pointA, dzień roboczy 12:00): dojścia do przystanków ≤3 km
  krótsze o 15–40 s w medianie (skrajnie o 18 min), przystanki ≤60 min:
  Trójmiasto 1855 → 2138, GZM 3037 → 3084, Warszawa bez zmian. Prekompilacja
  przesiadek (test na Trójmieście, dane przywrócone): 12 845 → 13 607 par.
  Pozostałe miasta dostaną nowe przesiadki przy najbliższym buildzie.

- **#19 (2026-09-18)** — `package.json` (już nie ignorowany), ESLint 9 (`npm run
  lint`), 24 testy `node:test` w `tests/` (`npm test`): dekoder v2/v3 i sieć
  odwrócona, RAPTOR na sieciach ręcznych (bufor przesiadkowy, limit rund, kursy
  nocne, profile opóźnień, rekonstrukcja trasy w obu kierunkach) i porównanie
  z niezależną wyrocznią na 480 losowych scenariuszach (spacer × ostrożny ×
  godzina × 40 sieci) oraz 40 dla kierunku „do", Dijkstra, fala po rastrze
  (woda/most/promień), graf ulic (snap, czasy, malowanie). Workflow `ci.yml`
  uruchamia lint + testy przy każdym pushu i PR. Przy okazji: literalne bajty BOM
  w regexach `build-data.mjs` zamienione na `\uFEFF`.

- **Ulepszenie 1 — gładkie strefy (2026-09-18)** — obrysy wektorowe pasm
  z siatki przez marching squares (`buildContours` w `js/walkgrid.js`,
  d3-contour zbudowany esbuildem do `vendor/d3-contour/`), rysowane jako
  ścieżki canvas z regułą evenodd (`_drawContours` w `js/map.js`; rzut
  Mercatora liczony wprost, pierścienie poza widokiem pomijane, wierzchołki
  bliżej niż 0,7 px zlewane). Uproszczenie obrysu (punkty niemal współliniowe)
  i filtr pierścieni jednokomórkowych. Raster zostaje jako podgląd do czasu
  policzenia obrysów. Obrys 6 pasm na siatce 4 mln komórek: ~0,9 s.
- **#9 / Ulepszenie 2 — obliczenia w tle (2026-09-18)** — cały tor obliczeń
  wyniesiony do `js/engine.js` (bez DOM), uruchamiany w Web Workerze
  (`js/worker.js`, OffscreenCanvas, wyniki w dwóch fazach: raster+koła+
  statystyki, potem obrysy; kolejka „ostatni wygrywa"). `app.js` został
  z UI i klientem silnika; dymek trasy liczy worker (`Engine.journey`),
  HTML składa UI. Awaryjnie (brak OffscreenCanvas, błąd workera, `?engine=main`)
  ten sam silnik liczy w wątku głównym. Pomiar (Trójmiasto, spacer): podczas
  750 ms liczenia maksymalna przerwa wątku głównego 18 ms (wcześniej ~1,9 s
  zamrożenia). `data.js` buduje adresy danych względem modułu (`import.meta.url`),
  bo w workerze względne `fetch` liczy się od skryptu workera.

- **Reszta listy (2026-09-18, za zgodą na wszystko)** — #5 katalog
  `ztm-izochrony/` usunięty; #11 `build-data.mjs` odrzuca przystanki bez
  kursów (test Trójmiasto: 6465 → 3344, plik 1,16 → 1,03 MB; produkcja dostanie
  to przy najbliższym buildzie); #20 `tools/check-data.mjs` + krok workflowu:
  raport do podsumowania i zgłoszenie GitHub z etykietą `dane` (miasta
  pominięte, brak dni, rozkład wygasły lub kończący się w 7 dni); #21 kolektor
  liczy kurs raz na godzinę dziennie (`_seen`), `build-delays` pomija klucze
  `_`; #26 bufory `spread`/`time2` przy siatce zamiast alokacji per
  przeliczenie; #27 horyzont RAPTOR 3 h → 91 min (eksportowany `HORIZON_S`,
  wyrocznia w testach używa tej samej wartości); #29 maska wody rysowana tylko
  dla pierścieni w widoku (bbox); #30 wyszukiwarka: ↑/↓, Enter, Escape, klik
  poza listą, `role=listbox/option`; #34 cron kolektora co 15 min; #35 Open
  Graph + Twitter Card + `og-image.png` (generowany skryptem, bez bibliotek),
  `robots.txt`, `sitemap.xml`, `canonical`. Dodatkowo: otwarty dymek trasy jest
  odświeżany po przeliczeniu zamiast zamykany (dociągnięcie grafu ulic już go
  nie gasi). Obserwacja: `data/delays/` jest śledzone na `main` (workflow
  kopiuje agregaty z gałęzi `delays`), wpis w `.gitignore` był martwy — poprawiony.

- **Ulepszenie 7 — rower jako dojście (2026-09-19, backlog #5)** — w sekcji
  „Dojście do przystanku" doszedł wybór środka: pieszo, rowerem zostawianym na
  przystanku (bike & ride) albo rowerem jadącym w pojeździe; parametr URL `acc=`.
  Rower jedzie 15 km/h po tej samej sieci ulic, a dojazd do przystanku liczony
  jest do 30 min (≈ 7,5 km — powyżej tego nikt nie jedzie po to, żeby się
  przesiąść, a bez capu rower sięgałby 22 km i zasiewał RAPTOR przystankami
  z drugiego końca aglomeracji). Zmiany: `js/walknet.js` trzyma w CSR **metry**
  zamiast sekund, a tempo (`NET_WALK_MPS` / `NET_BIKE_MPS`) przyjmują
  `computeNodeTimes`, `snapSeeds`/`snapTime`/`sameEdgeSec` i `paintNetwork`
  (snapy są odtąd bezwymiarowe, więc ten sam cache obsługuje oba tempa);
  `paintNetwork` dostał `reset:false`, bo wariant „rower zostaje" wymaga **dwóch
  fal** — szybszej od punktu i wolniejszej od przystanków — nakładanych na siebie
  (min per piksel). `js/engine.js` ma tabelę `ACCESS_MODES` i `speedsFor`, która
  przy kierunku „do miejsca" **zamienia role**: rower ma ten, kto podróż zaczyna,
  czyli wtedy strona mapy, nie punkt użytkownika. `js/router.js` i `js/stats.js`
  dostały tempo dla przystanków spoza grafu. Pomiar (Trójmiasto, `pointA`, dzień
  roboczy 12:00): dojścia po tych samych trasach dokładnie 3,33× krótsze
  (mediana stosunku 3,33 przy p10 3,31 i p90 3,35), przystanki startowe
  801 → 939, osiągalne ≤30 min **906 → 1144**; udział powierzchni miasta
  w paśmie „ponad 60" pieszo 63% → rower 66% → rower w pojeździe 76%, a w paśmie
  „do 10 min" 0,4% → 2,0% → 2,9%. Kierunek „do miejsca" zachowuje się
  lustrzanie (59% → 72%). Dymek trasy pokazuje 🚲 na tym końcu, gdzie rower
  faktycznie jedzie. Ograniczenie (udokumentowane w README i pomocy): graf nie
  ma tagów krawędzi, więc rower „pokonuje" schody i deptaki, a nie zna dróg
  rowerowych z `foot=no`; przesiadki w trakcie podróży zostają piesze.

Otwarte pozostają wyłącznie udokumentowane ograniczenia modelu (#36) oraz
tematy poza kodem: certyfikowany CMP dla Google (#4), przełączenie na własny
klucz kafelków przy dużym ruchu (#0).

### P0 — krytyczne (błędne wyniki, dane, prawo)

0. ~~**Podkład mapy pokazuje „API KEY REQUIRED".**~~ **ROZWIĄZANE 2026-09-18.**
   Kafelki CARTO `light_all` zaczęły wymagać klucza API i oddawały znak wodny
   zamiast mapy (dotyczyło też produkcji). Przełączone na standardowe kafelki
   OSM `tile.openstreetmap.org` bez klucza ([map.js](js/map.js)), z filtrem
   CSS do jasnej szarości na `.leaflet-tile-pane`, żeby strefy zostały jedyną
   barwną informacją. Atrybucja OSM zachowana. Gdyby ruch urósł ponad politykę
   użycia kafelków OSM, przejść na własny klucz (CARTO/MapTiler/Stadia) —
   wystarczy podmienić URL w `createMap`.

1. **Dane rozkładowe są przeterminowane, a aplikacja tego nie sygnalizuje.**
   `meta.json` każdego miasta ma `feedEndDate` z lipca/sierpnia 2026
   (Poznań 2026-07-17, Opole 2026-07-20, Wrocław 2026-07-26, GZM 2026-08-01,
   Trójmiasto 2026-08-09, Warszawa 2026-08-16, Kraków 2026-08-29); pliki
   `workday/saturday/sunday.json` wygenerowano 13 i 26 lipca. Cotygodniowy
   workflow `refresh-data.yml` albo nie działa, albo lokalne repo jest daleko
   za `origin` (bez `git` w PATH nie dało się tego sprawdzić). Frontend czyta
   tylko `meta.dates.workday` do stopki ([app.js:859-863](js/app.js#L859)),
   a `feedEndDate` ignoruje — użytkownik dostaje wakacyjny rozkład bez
   ostrzeżenia. Do zrobienia: sprawdzić historię uruchomień workflowu,
   a w UI pokazać ostrzeżenie, gdy `feedEndDate < dziś`.

2. **Niespójny komplet dni dla Poznania.** `data/poznan/meta.json` zawiera
   tylko `dates.workday`, ale w katalogu leżą `saturday.json` i `sunday.json`
   ze starszego builda (feed miał zbyt krótki zakres dat, żeby trafić w weekend).
   `build-data.mjs` nie usuwa nieaktualnych plików dni
   ([build-data.mjs:583-599](tools/build-data.mjs#L583)), a frontend nie
   sprawdza `meta.dates` przed wyborem typu dnia — weekendowy rozkład Poznania
   pochodzi z innego okresu niż roboczy. Build powinien kasować pliki dni,
   których nie wygenerował, a `daySelect` wyłączać brakujące typy dnia.

3. **Profile opóźnień z GTFS-RT nigdy nie trafią w linię.** Kolektor kluczuje
   obserwacje po `trip.routeId` z feedu RT ([collect-delays.mjs:69](tools/collect-delays.mjs#L69)),
   a silnik szuka klucza po `route_short_name`
   ([router.js:198,208](js/router.js#L198)). W Krakowie tramwaje mają
   `route_id = "route_5"` przy nazwie `"40"` (sprawdzone w `gtfs-src/krakow/ztp-tram/routes.txt`);
   GZM, Poznań, Szczecin używają własnych identyfikatorów. Działa tylko Gdańsk,
   bo tam API zwraca `routeShortName`. Kolektor powinien mapować `route_id →
   short_name` przez `routes.txt` (albo prekompilacja powinna zapisywać oba).

4. **Skrypt AdSense ładuje się przed zgodą.** `<script async src="…adsbygoogle.js">`
   siedzi w `<head>` bezwarunkowo ([index.html:30-33](index.html#L30)), więc
   żądanie do `googlesyndication.com` (i ciasteczka Google) idzie przed
   kliknięciem „Zgoda". Komentarz w kodzie, pomoc ([index.html:277-280](index.html#L277))
   i baner zgody obiecują co innego. Ryzyko RODO/ePrivacy; dodatkowo Google
   wymaga w EOG certyfikowanego CMP z Consent Mode v2 — własny baner nie
   spełnia tego wymogu. Skrypt powinien być dokładany dynamicznie w `loadAds()`,
   tak jak `gtag.js` w `loadGA()`.

5. **Duplikat całego projektu wewnątrz repo.** Katalog `ztm-izochrony/` to
   starsza kopia (własny `.git`, inne rozmiary `app.js`, `router.js`,
   `build-data.mjs`). Ryzyko edytowania niewłaściwej kopii, dublowania zmian
   i mylących wyników wyszukiwania w IDE. Do usunięcia albo przeniesienia poza
   repo.

### P1 — wysokie (poprawność algorytmu, wydajność odczuwalna przez użytkownika)

6. **Podwójne liczenie bufora przesiadkowego przy przejściu pieszym.**
   W RAPTOR przejście piesze między przystankami kosztuje `max(sek, 60)`
   (w trybie ostrożnym `max(sek, 240)`, [router.js:251](js/router.js#L251)),
   a w następnej rundzie do wsiadania dokładany jest jeszcze `buffer`
   60 s / 240 s ([router.js:190,223](js/router.js#L190)). Efekt: minimalna
   przesiadka „przez ulicę" to 2 min, a w trybie ostrożnym **8 min**, choć
   README obiecuje 1 / 4 min. To samo w Dijkstrze ([router.js:390](js/router.js#L390)).
   Bufor przy wsiadaniu powinien obowiązywać tylko dla przesiadek na tym
   samym przystanku (bez etapu pieszego).

7. **Całe obliczenie blokuje wątek główny.** RAPTOR, Dijkstra po grafie ulic,
   fala po rastrze (do 4 mln komórek) i rasteryzacja są synchroniczne w
   `recompute()` ([app.js:686-841](js/app.js#L686)); dla GZM to ~2 s, na
   telefonie kilka sekund zamrożonego UI. Komunikat „Obliczam zasięg…" bywa
   niewidoczny, bo malowanie nie zdąży. Do przeniesienia do Web Workera
   (z `OffscreenCanvas` lub przesyłaniem `ImageData`), z możliwością
   anulowania przestarzałego zadania (obecny `computeSeq` chroni tylko przed
   wyścigiem `fetch`).

8. **Wyszukiwanie najwcześniejszego kursu zakłada brak wyprzedzania.**
   `earliestTrip` robi binarne wyszukiwanie po `depAt` przy pozycji `pos`,
   zakładając monotoniczność odjazdów względem kolejności kursów
   ([router.js:274-284](js/router.js#L274)). Kursy o różnych profilach
   (przyspieszony i zwykły w tym samym wzorcu, kursy nocne 24:00+) mogą się
   wyprzedzać, a wtedy binsearch pomija wcześniejszy odjazd. Rozwiązanie:
   sortowanie kursów per pozycja w prekompilacji albo rozbicie wzorca, gdy
   dochodzi do wyprzedzenia (standard w RAPTOR).

9. **Przyłączanie punktu do grafu po WĘŹLE, nie po krawędzi.** Graf jest
   skontrahowany (węzły = skrzyżowania), a `snapNode` szuka najbliższego
   węzła w promieniu 400 m ([walknet.js:146-172](js/walknet.js#L146)).
   Punkt w połowie 600-metrowej ulicy dostaje dojście „w linii prostej do
   skrzyżowania" (`linkSec`, [app.js:594](js/app.js#L594)) — błąd rzędu
   minut, a przy długich krawędziach snap w ogóle się nie udaje i całość
   spada na raster. Dotyczy też przystanków (`stopNodes`) i prekompilacji
   przesiadek. Należy rzutować punkt na najbliższy odcinek krawędzi
   (wymaga zachowania uproszczonej geometrii krawędzi w `walknet.json`).

10. **Rosnące zużycie pamięci przy przełączaniu miast.** Cache sieci
    rozkładowych ([data.js:28,41-52](js/data.js#L28)) nigdy nie jest
    czyszczony, każda sieć dekoduje od razu także kopię odwróconą
    (`reverseNetwork`, [data.js:132](js/data.js#L132)), a `gridCache`
    siatek ([walkgrid.js:17](js/walkgrid.js#L17)) trzyma ~30 MB buforów
    na miasto. Po obejrzeniu kilku miast na telefonie karta potrafi paść.
    Potrzebna eksmisja LRU (np. tylko bieżące miasto) i leniwe budowanie
    sieci odwróconej.

11. **~3000 nieużywanych przystanków w każdym mieście z feedem `polish_trains.zip`.**
    `stops.txt` jest brany w całości ([build-data.mjs:228-237](tools/build-data.mjs#L228)),
    filtry działają tylko na kursach. Skutek: Trójmiasto, Warszawa i Kraków
    mają ~3100 przystanków od Świnoujścia po Zaporoże, które puchną w JSON,
    w `Float64Array` i w każdej pętli po `nStops` (`findAccessStops`,
    `pickTargetStop`, seedy fali). Do odrzucenia w prekompilacji przystanki
    bez żadnego kursu.

### P2 — średnie (błędy UI, spójność, utrzymanie)

12. **Lista wyników drugiego punktu bez stylów.** CSS stylizuje tylko
    `#searchResults` ([style.css:192-210](css/style.css#L192)); `#searchResults2`
    renderuje się jako zwykła lista z kropkami. Selektor powinien objąć obie
    listy (klasa zamiast id).

13. **Ujemne godziny w dymku trasy.** Dla kierunku „do miejsca" nagłówek liczy
    `state.timeMin*60 − totalMin*60` ([app.js:506](js/app.js#L506)); dla
    godzin porannych wynik jest ujemny, a `HHMM` ([app.js:411](js/app.js#L411))
    zwraca np. „-1:35". Trzeba znormalizować modulo 86400.

14. **`localStorage` bez zabezpieczenia.** W Safari w trybie prywatnym i przy
    zablokowanych ciasteczkach `localStorage.getItem` rzuca wyjątek — skrypt
    zgody ([index.html:27,303-308](index.html#L303)) przerywa się przed
    podpięciem przycisków, baner zostaje bez działania. Owinąć w `try/catch`.

15. **Stan wyjściowy liczony trzykrotnie.** Przy starcie `recompute()` woła się
    wprost ([app.js:935](js/app.js#L935)), potem po wczytaniu geometrii
    ([app.js:869](js/app.js#L869)), potem po wczytaniu grafu ([app.js:875](js/app.js#L875)).
    To samo przy `switchCity`. Pierwsze przeliczenie (koła crow-fly) jest
    natychmiast nadpisywane; mignięcie kół + zbędna praca. Wystarczy jedno
    przeliczenie po geometrii i jedno po grafie, albo pokazać stan „ładowanie"
    zamiast pośredniego wyniku.

16. **Mylący komunikat w trybie „tylko pieszo" poza siatką.** Dla klikniętego
    miejsca poza `gridBbox` w porównaniu dwóch punktów dymek mówi „Nie da się
    tam dojść pieszo (woda lub brak przejścia)" ([app.js:525-530](js/app.js#L525)),
    choć faktyczna przyczyna to brak siatki. Rozróżnić „poza obszarem analizy".

17. **Martwy kod i nieaktualne komentarze w `stats.js`.** `resetStats`,
    `initStats`, `computeAreas` ([stats.js:20,25,127](js/stats.js#L20)) nie są
    nigdzie używane (zastąpione przez `areaPercents` — potwierdzone
    w `CURRENT_STATE.md` §3), nagłówek mówi o „Gdańsku". Zostawiają fałszywy
    trop przy czytaniu. Do usunięcia (zostaje `computeStats`).

18. **Dokumentacja rozjechana z kodem.** README wymienia 6 miast (jest 18),
    „wyniki zawężone do okolic Trójmiasta" ([README.md:65-66](README.md#L65)),
    „Gdańsk+Sopot+Gdynia" jako obszar statystyki ([README.md:74](README.md#L74),
    [index.html:146-147](index.html#L146), [index.html:267](index.html#L267))
    — a `boundaries` Trójmiasta obejmują już Redę, Rumię i Wejherowo. W sekcji
    „Struktura" brak `walkgrid.js`, `build-bridges.mjs`, `build-delays.mjs`,
    `collect-delays.mjs`. Domyślny nagłówek kolumny „% Trójmiasta" w HTML
    ([index.html:141](index.html#L141)) jest nadpisywany, ale wprowadza w błąd.

19. **Brak `package.json`, testów i lintera.** `.gitignore` celowo ignoruje
    `package.json` ([.gitignore:10](.gitignore#L10)), więc zależność
    `gtfs-realtime-bindings` jest instalowana „w ciemno" w workflowie, nie ma
    skryptów `npm run build:city`, nie ma żadnego testu (RAPTOR, dekoder v2/v3,
    sieć odwrócona, fala po rastrze — wszystko weryfikowane ręcznie wg
    `CURRENT_STATE.md`). Bez testów każda zmiana w routerze to regresja
    czekająca na odkrycie przez użytkownika.

20. **Cichy fallback przy awarii feedu.** `refresh-data.yml` pomija miasto,
    którego feed nie dał się pobrać, i zostawia stare dane
    ([refresh-data.yml:29-34](.github/workflows/refresh-data.yml#L29)) — tylko
    `::warning` w logu, bez issue/powiadomienia. Razem z problemem #1 daje
    miesiące nieaktualnych rozkładów bez niczyjej wiedzy.

21. **Autokorelacja próbek opóźnień.** Ten sam kurs obserwowany co 10 min
    liczy się jako osobna obserwacja ([collect-delays.mjs:114-121](tools/collect-delays.mjs#L114)),
    więc `n ≥ 20` (`MIN_OBS`) osiąga jeden kurs w ciągu jednego popołudnia.
    Profil p80 opiera się wtedy na kilku pojazdach. Należy deduplikować po
    `trip_id` w obrębie dnia (np. ostatnia obserwacja kursu) albo podnieść
    próg i liczyć unikalne kursy.

22. **Zduplikowane stałe i funkcje między frontendem a narzędziami.**
    `WALK_SPEED_MPS`, `distMeters`, `EARTH_M_PER_DEG_LAT` w `build-data.mjs`
    ([build-data.mjs:104-110,422](tools/build-data.mjs#L104)) powielają
    `WALK_MPS`, `distM`, `M_PER_DEG_LAT` z `js/data.js` (który ten sam plik
    już importuje po `COMPLEX_MAX_M`). `M_PER_DEG_LAT` istnieje osobno także
    w `map.js` i `geo.mjs`. Rozjazd wartości = ciche przekłamanie czasów.

23. **Konfiguracja miast z powtórzonymi danymi.** `viewbox` dla Nominatim to
    ten sam prostokąt co `bbox`, tylko w innej kolejności ([cities.json](data/cities.json)),
    a dla Trójmiasta nawet niezgodny (54.20 vs 54.28). Powinien być wyliczany
    z `bbox` w kodzie.

### P3 — niskie (jakość kodu, drobne UX, higiena)

24. **Klucz krawędzi `u * 100000 + v`** w `rideAdjacency`
    ([router.js:310](js/router.js#L310)) przestanie być unikalny przy
    ≥100 000 przystanków; po dołożeniu kolejnych feedów ogólnopolskich to
    realne. Użyć `u * nStops + v` albo `Map` po `BigInt`/string.

25. **Założenie little-endian na sztywno** w `renderTimeGrid`
    ([walkgrid.js:308](js/walkgrid.js#L308)) — praktycznie wszędzie prawdziwe,
    ale gałąź big-endian to martwy kod z fałszywą flagą.

26. **Alokacje 8 MB na każde przeliczenie.** `spread` w `computeTimeGrid`
    ([walkgrid.js:149](js/walkgrid.js#L149)) i `computeNoWalkGrid`
    ([walkgrid.js:231](js/walkgrid.js#L231)) tworzone od nowa przy każdym
    wywołaniu, do tego `.slice()` całej siatki w trybie porównania
    ([app.js:767,776](js/app.js#L767)). Bufory można trzymać w `grid`.

27. **Horyzont RAPTOR 3 h przy rysowaniu do 90 min** ([router.js:12](js/router.js#L12))
    — silnik przelicza dwa razy więcej czasu, niż kiedykolwiek trafia na mapę
    (dymek też ucina na 90). Zbędna praca w największych miastach.

28. **Dynamiczny import modułu już zaimportowanego statycznie.** `loadWalkNet`
    robi `await import('./walknet.js')` ([data.js:283](js/data.js#L283)),
    choć `app.js` importuje go na starcie — bez efektu, tylko zaciemnia.

29. **Przerysowanie całej maski wody przy każdym `moveend`**
    ([map.js:134-163](js/map.js#L134)) bez przycinania do widocznego obszaru;
    dla Trójmiasta/GZM to kilkadziesiąt tysięcy wierzchołków na każde
    przesunięcie mapy.

30. **Wyniki wyszukiwania tylko myszą.** Elementy `<li>` mają jedynie
    `click` ([app.js:275-283](js/app.js#L275)) — brak obsługi klawiatury,
    `Escape`, zamknięcia kliknięciem poza listą; lista nie ma `role="listbox"`.

31. **Brak obsługi błędu na starcie.** Top-level `await loadCities()`
    ([app.js:15](js/app.js#L15)) przy nieudanym `fetch` wywala cały moduł —
    strona zostaje z „…" w stopce i pustym panelem, bez komunikatu.

32. **Debugowy endpoint w serwerze deweloperskim.** `POST /__save`
    ([serve.mjs:22-31](tools/serve.mjs#L22)) zapisuje dowolne body do
    katalogu tymczasowego — pozostałość po testach zrzutów, do usunięcia.

33. **`start.bat` otwiera przeglądarkę przed startem serwera**
    ([start.bat:4-5](start.bat#L4)) — pierwsze wejście często kończy się
    „nie można połączyć", trzeba odświeżyć.

34. **Cron kolektora co 10 minut** ([collect-delays.yml:11](.github/workflows/collect-delays.yml#L11))
    to ~115 uruchomień dziennie i `push -f` na gałąź `delays` przy każdym;
    GitHub throttluje tak gęste crony w publicznych repo, więc realna
    częstotliwość i tak jest nieprzewidywalna. Lepiej rzadziej, ale z kilkoma
    odpytaniami w jednym uruchomieniu.

35. **Brak metadanych do udostępniania.** Strona nie ma Open Graph / Twitter
    Card, `robots.txt`, `sitemap.xml`, `manifest.json`; link wklejony na
    LinkedIn/Messenger pokazuje sam tytuł bez obrazka.

36. **Znane, udokumentowane luki z `CURRENT_STATE.md`** (dla kompletności):
    stacje kolejowe 150–400 m od przystanku naziemnego niedostępne jako
    przesiadka w trybie bez spaceru (backlog #13); dalekie stacje poza
    `gridBbox` rysowane kołami bez bariery wody (#10); teoretyczne przecieki
    korytarza mostu wzdłuż wąskiego kanału (#11); sieć piesza bez przewyższeń,
    schodów i nawierzchni (#12b); 15 miast czeka na rebuild przesiadek po
    grafie.

---

## ULEPSZENIA

### Wygląd stref (w tym rozpikselowanie)

1. **Wektoryzacja stref zamiast skalowanego rastra.** Siatka 25–40 m/px
   rysowana przez `drawImage` z wygładzaniem ([map.js:116-117](js/map.js#L116))
   przy zoomie 15+ daje 10–20-pikselowe „klocki" o rozmytych krawędziach.
   Rozwiązanie: po policzeniu `grid.time` przepuścić każdy próg pasma przez
   *marching squares* (np. `d3-contour` lub własna implementacja), uprościć
   (Douglas-Peucker ~½ piksela) i wygładzić (Chaikin / krzywe Béziera),
   a potem rysować jako ścieżki wektorowe na canvasie — ostre, gładkie
   krawędzie w każdym zoomie i o wiele mniejsze dane do rysowania. Bonus:
   te same poligony dają eksport GeoJSON.

2. **Rendering zależny od zoomu.** Alternatywa lub uzupełnienie: przy dużym
   zoomie przeliczać falę tylko dla widocznego wycinka w drobniejszej
   rozdzielczości (np. 5 m/px), zasiewając ją czasami z siatki zgrubnej na
   brzegu widoku. Koszt stały, niezależny od wielkości miasta.

3. **Strefy jako obszar wokół ulic, nie „rozlanie".** `SPREAD_M = 75`
   zamienia sieć w obszar; przy wektoryzacji można zamiast tego buforować
   krawędzie grafu (polilinie z czasem) o promień zależny od typu drogi —
   kwartały bez przejść zostają naturalnie puste, a wnętrza osiedli z
   chodnikami wypełnione.

4. **Płynne przejścia między pasmami** (gradient ciągły po czasie z opcją
   „pasma dyskretne"), obrys granicy 60 min, tryb wysokiego kontrastu
   i wariant dla druku.

5. **Wizualizacja przystanków i tras**: po najechaniu / kliknięciu
   narysować trasę z dymka na mapie (polilinie po `shapes.txt` lub po
   przystankach), podświetlić przystanki przesiadkowe, pokazać czasy na
   przystankach jako etykiety przy dużym zoomie.

### Silnik i dokładność

6. **Web Worker + anulowanie zadań** (patrz problem #7), z paskiem postępu
   dla dużych miast i natychmiastowym podglądem (najpierw sieć rozkładowa,
   potem doszlifowana fala).

7. ~~**Rower jako dojście** (backlog #5)~~ **ZROBIONE 2026-09-19** (patrz „Stan
   realizacji"): 15 km/h po tej samej sieci, warianty „zostaje na przystanku"
   i „jedzie z tobą", cap dojazdu 30 min. **Zostaje:** wykluczenie
   `highway=steps` i dróg bez prawa jazdy rowerem wymaga flag krawędzi
   w `walknet.json` (przebudowa Overpassem 18 miast); `bikes_allowed` z GTFS
   nieużywane (polskie feedy go nie wypełniają); hulajnoga i „park & ride"
   nietknięte.

8. **Profil pieszego**: ustawiana prędkość (dzieci, seniorzy, wózek), kara za
   schody i przewyższenia (`highway=steps`, `incline`, dane SRTM), tryb
   bezbarierowy (GTFS `wheelchair_accessible`, `wheelchair=yes` w OSM).

9. **Realny „teraz"**: tryb „wychodzę teraz" korzystający z pozycji
   pojazdów GTFS-RT (opóźnienia bieżące zamiast statystycznych) tam, gdzie
   miasto daje feed; automatyczne odświeżanie co minutę.

10. **Wielokryterialność**: maksymalna liczba przesiadek, maksymalny spacer,
    unikanie danej linii, „tylko bezpośrednio". Widok „które linie najbardziej
    rozszerzają zasięg" (wyłączanie linii pojedynczo, nie tylko typem pojazdu).

11. **Sieć odwrócona liczona leniwie**, kursy sortowane per pozycja
    w prekompilacji, odrzucanie nieużywanych przystanków — mniejsze pliki
    (20–30 %) i szybszy start.

### Nowe funkcje analityczne

12. **Punkt spotkania.** W trybie dwóch (lub N) punktów zaproponować miejsce
    minimalizujące maksymalny (lub sumaryczny) czas dojazdu, z listą
    najlepszych przystanków/lokali. Rozszerzenie do N osób.

13. **Wskaźnik dostępności adresu.** Dla wybranego punktu policzyć, ile
    mieszkańców (dane GUS 1 km²), miejsc pracy, szkół, sklepów, przychodni
    (POI z OSM) mieści się w 15/30/45 min — jedno „score" do porównywania
    mieszkań; porównanie dwóch adresów obok siebie.

14. **Mapa cieplna dostępności miasta.** Dla siatki punktów startowych
    policzyć zasięg (np. % miasta w 30 min) i narysować jako warstwę
    — pokazuje „transportowe pustynie". Można liczyć offline w prekompilacji
    per miasto i godzina.

15. **Oś czasu / animacja.** Suwak godziny z przeliczaniem na żywo (albo
    prekompilowane klatki co 15 min) i wykres „jak zasięg zmienia się w ciągu
    doby"; porównanie dzień roboczy vs niedziela vs noc.

16. **Porównanie „przed / po".** Wgranie drugiego zestawu danych (np. planowana
    zmiana siatki linii, zamknięcie mostu, nowa linia tramwajowa) i mapa
    różnic zasięgu — narzędzie dla urzędów i aktywistów.

17. **Więcej miast i więcej kolei**: Częstochowa, Radom, Płock, Elbląg,
    Koszalin, Tarnów; Polregio/KM/KŚ jako warstwa regionalna w każdym mieście
    (mechanizm `keepAgency`/`keepBbox` już jest); ewentualnie PKS/prywatni
    przewoźnicy z GTFS na `mkuran.pl`.

### UX i produkt

18. **Tryb „czysty widok" do zrzutów** (backlog #8): zwinięty panel, legenda,
    adres strony i znak wodny; przycisk „Pobierz PNG" (canvas → obraz) i
    „Pobierz GeoJSON".

19. **Udostępnianie**: krótkie linki, obrazek OG generowany na żądanie
    (np. Cloudflare Worker), osadzanie przez `<iframe>` z parametrami URL,
    prosty publiczny endpoint JSON dla developerów.

20. **Mobile**: panel jako przesuwany „bottom sheet" z gestami, długie
    przytrzymanie z wibracją, przycisk „wyśrodkuj na mnie", tryb PWA
    (manifest + service worker cache'ujący dane bieżącego miasta — działanie
    offline w tramwaju).

21. **Wyszukiwarka**: podpowiedzi w trakcie pisania (Photon/Komoot API
    dopuszcza autocomplete, Nominatim nie), historia ostatnich adresów,
    wyszukiwanie po nazwie przystanku z danych lokalnych (bez sieci).

22. **Personalizacja i dostępność**: tryb ciemny (podkład CARTO dark),
    wersja angielska (i18n z `data/i18n/*.json`), pełna nawigacja klawiaturą,
    czytelne opisy ARIA dla stref (tekstowe podsumowanie: „w 30 min dotrzesz
    do X % miasta, najdalej do …").

23. **Stopka i onboarding** (backlog #9): wyróżniony kontakt, linki do
    socjali, przycisk Suppi wyżej; krótki samouczek przy pierwszej wizycie
    (3 kroki) zamiast długiego dialogu pomocy.

24. **Komunikacja stanu danych**: w stopce „rozkład ważny do …", ostrzeżenie
    o przeterminowaniu, informacja o brakujących typach dnia, licznik
    „profile opóźnień: N linii" — buduje zaufanie do wyników.

### Infrastruktura i jakość

25. **`package.json` + testy + lint + CI**: testy jednostkowe routera
    (porównanie RAPTOR z brute-force na małej syntetycznej sieci, sieć
    odwrócona = odbicie wyników, dekoder v2 vs v3), test fali po rastrze
    (bariera/most), ESLint, uruchamiane w Actions przy każdym PR.

26. **Monitoring pipeline'u danych**: workflow tworzy issue, gdy miasto
    zostało pominięte albo `feedEndDate` jest bliżej niż 7 dni; podsumowanie
    w `data/status.json` czytane przez frontend.

27. **Mniejsze i szybsze dane**: format binarny (`Int32Array` w `.bin` z
    nagłówkiem) zamiast JSON, wstępnie skompresowane pliki (`.br`), podział
    `walknet.json` na kafle ładowane wokół widoku, `Cache-Control` z
    wersjonowaniem w nazwach plików.

28. **Porządek w repo**: usunięcie `ztm-izochrony/`, przeniesienie
    `CURRENT_STATE.md` do `docs/` z podziałem na „architektura" i „dziennik",
    aktualizacja README pod 18 miast, wspólny moduł stałych geometrycznych
    dla `js/` i `tools/`.
