# Zadania do zrobienia

Kolejka pracy agentów. Utrzymuje ją wyłącznie agent `kronikarz`.
Identyfikatory `Z-NNN` są trwałe — numer nigdy nie jest używany ponownie.
Statusy: `nowe` -> `zaprojektowane` -> `w toku` -> `zrobione` -> `odrzucone`.

Stary backlog `zadania.md` to archiwum, tylko do czytania.

## W toku

### Z-019 [P1] Brakujące profile opóźnień dla GZM i Szczecina
- Status: w toku
- Zgłoszone: 2026-11-16 (analityk)
- Problem: oba miasta mają skonfigurowane źródło rt, ale nie mają danych opóźnień. Diagnoza: config, mapy `routeNames` i próg `MIN_OBS` są poprawne; ścieżka urywa się w `tools/collect-delays.mjs` — kolektor dostaje zero obserwacji przy każdym przebiegu, a błędy HTTP i wyjątki kończyły się cichym ostrzeżeniem przy sukcesie przebiegu, więc awaria była niewidoczna od lipca 2026. Pliki `data/delays/gzm.json` i `szczecin.json` nigdy nie istniały w żadnym commicie.
- Dowód: data/cities.json:300,344; data/delays/ zawiera tylko krakow.json, poznan.json, trojmiasto.json, a rt jest ustawione dla 5 miast.
- Wdrożono część „awaria widoczna" (2026-11-16): klasyfikacja wyniku per URL (`ok`, `http`, `exception`, `undecodable`, `no-entities`, `no-tripupdate`, `no-routeid`, `no-delay`), diagnostyka w logu, tabela werdyktów w podsumowaniu przebiegu, kod wyjścia 1 przy mieście z `rt` i zerem obserwacji; miasta działające dalej zapisują dane. Czerwony status tylko przy uruchomieniu ręcznym i w pierwszej godzinie dnia (cron daje 76 przebiegów dziennie).
- Pozostaje: odczytać werdykt z pierwszego przebiegu i naprawić przyczynę po stronie feedów. Przyczyny nie ustalono lokalnie (brak dostępu do logów GitHuba, zakaz odpytywania feedów).
- Pliki: data/delays/, tools/collect-delays.mjs, data/cities.json, .github/workflows/collect-delays.yml, README.md, tests/collect-delays.test.mjs.

### Z-002 [P1] Mobile i PWA
- Status: w toku
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak manifest.json i service workera; offline tylko przez cache przeglądarki. Dochodzi bottom sheet, przycisk „wyśrodkuj na mnie" i wibracja.
- Dowód: brak odwołań do manifestu i service workera w index.html (stan przed etapem 1).
- Wdrożone 2026-11-16:
  - Etap 1 (manifest i ikony): `manifest.json` (`start_url` i `scope` jako `./`, `start_url` bez parametrów), generator `tools/build-icons.mjs` (zero zależności, wynik deterministyczny), `assets/icon.svg`, `assets/icon-192.png`, `assets/icon-512.png`, `assets/icon-maskable-512.png`, `assets/apple-touch-icon.png`; w `index.html` cztery linie w `<head>`, stara ikona data-URI zostaje jako awaryjna. Testy: `tests/pwa-manifest.test.mjs` (5), `tests/build-icons.test.mjs` (2).
  - Etap 2 (lokalizacja i wibracja): kontrolka „Wyśrodkuj na mnie" (`addLocateControl` w `js/map.js`) z kółkiem dokładności i przyciskiem „Ustaw tu punkt startowy" w dymku; czyste funkcje w `js/uilogic.js`; rozróżnione komunikaty błędów lokalizacji, komunikat „Jesteś poza obszarem: <miasto>", jeden impuls wibracji 20 ms po przeliczeniu dłuższym niż 1,5 s, komunikat „Jesteś offline". Testy: `tests/uilogic.test.mjs`, `tests/mobile-layout.test.mjs` (`TAP_USES_MIN` 19 -> 21).
- Rozwiązanie etapu 3 (service worker; szkic z wejścia fali, bez przeglądu rozwiazywacza): service worker shell-only, który nigdy nie odpowiada na żądania zawierające `/data/` (nie pokaże nieaktualnego rozkładu); powłoka jako jedna atomowa paczka `shell-<hash>`; bez `skipWaiting()` w tle; komunikat „Dostępna nowa wersja — odśwież" z przyciskiem; wyjście awaryjne `?sw=off`; stempel wersji z `tools/stamp-sw.mjs` pilnowany testem. Wariant „sam manifest, bez service workera" odpadł: GitHub Pages narzuca `Cache-Control: max-age=600` i nie pozwala tego zmienić, a bez handlera `fetch` Chrome nie pokaże promptu instalacji. Etap 3 czeka na decyzję właściciela, bo trwale instaluje się w przeglądarkach użytkowników i zmienia zachowanie offline.
- Pliki: index.html, js/app.js, js/map.js, js/uilogic.js, css/style.css, manifest.json, tools/build-icons.mjs, assets/, tests/pwa-manifest.test.mjs, tests/build-icons.test.mjs. Etap 3: sw.js, js/pwa.js, tools/stamp-sw.mjs, tests/sw.test.mjs.
- Niezweryfikowane: etap 1 — faktyczna instalowalność na telefonie i na iOS, ścieżki względne pod `github.io/ZTM/`. Etap 2 — prawdziwy prompt o zgodę, kod 3 (timeout), komunikat offline w przeglądarce, pozycjonowanie kontrolki na wąskim ekranie, wibracja na prawdziwym urządzeniu.

## Zaprojektowane (gotowe do wdrożenia)

_(pusto)_

## Nowe (bez projektu rozwiązania)

### Z-001 [P1] Certyfikowany CMP (Consent Mode v2)
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: własny baner zgody nie spełnia wymogu Google dla EOG — potrzebny certyfikowany CMP. Uwaga: ryzyko prawne.
- Dowód: index.html:321-359.
- Pliki: index.html oraz ustawienie w panelu AdSense (poza kodem).

### Z-003 [P1] Mniejsze dane
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: walknet.json ładowany w całości — 3,3 MB dla Trójmiasta, ok. 2,4 MB po gzipie dla GZM. Pomysły: format binarny, kafle wokół widoku, wersjonowanie nazw plików.
- Dowód: rozmiary plików w data/<miasto>/.
- Pliki: tools/build-walknet.mjs, js/walknet.js, js/data.js.

### Z-004 [P1] Punkt spotkania
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak trybu szukania miejsca spotkania dwóch osób; naturalny następny krok po trybie porównania.
- Dowód: maxTimeGrid już liczy maksimum z dwóch fal.
- Pliki: js/engine.js, js/app.js, index.html.

### Z-007 [P2] Znane luki modelu
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: trzy luki — stacje kolejowe 150-400 m od przystanku naziemnego niedostępne jako przesiadka w trybie bez spaceru (COMPLEX_MAX_M; Kraków SKA, 17 stacji); dalekie stacje poza gridBbox rysowane kołami bez bariery wody; graf pieszy bez tagów krawędzi (schody, deptaki, foot=no dla roweru).
- Dowód: nieznane.
- Pliki: tools/build-data.mjs, tools/build-walknet.mjs, js/walkgrid.js.

### Z-008 [P2] Tryb czystego widoku i eksport
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak trybu bez panelu oraz eksportu wyniku do PNG lub GeoJSON.
- Dowód: nieznane.
- Pliki: js/app.js, js/map.js, css/style.css.

### Z-009 [P2] Stopka i onboarding
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak kontaktu i social media w stopce, przycisk Suppi za nisko, brak samouczka w 3 krokach.
- Dowód: nieznane.
- Pliki: index.html, css/style.css.

### Z-010 [P2] Wizualizacja trasy z dymka na mapie
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: nie ma rysowania tras na mapie.
- Dowód: brak shapes i polilinii w js/app.js i js/map.js.
- Pliki: js/map.js, js/app.js, tools/build-data.mjs.

### Z-011 [P2] Realny „teraz"
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: tryb ostrożny używa statystycznych profili opóźnień, nie bieżących danych GTFS-RT.
- Dowód: nieznane.
- Pliki: js/router.js, tools/collect-delays.mjs.

### Z-012 [P2] Wielokryterialność
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak limitu przesiadek, maksymalnej długości spaceru i wyłączania pojedynczych linii.
- Dowód: nieznane.
- Pliki: js/router.js, js/app.js, index.html.

### Z-013 [P2] Profil pieszego
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak ustawień prędkości, schodów i bezbarierowości.
- Dowód: nieznane.
- Pliki: js/walknet.js, js/walkgrid.js, js/app.js.

### Z-014 [P2] Funkcje analityczne i produktowe
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak dostępności adresu z POI/GUS, mapy cieplnej, osi czasu z animacją, porównania przed/po oraz kolejnych miast i kolei regionalnych.
- Dowód: nieznane.
- Pliki: nieznane.

### Z-015 [P2] Udostępnianie i wyszukiwarka
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak krótkich linków, dynamicznego obrazka OG, iframe, wyszukiwania po nazwie przystanku offline i historii adresów.
- Dowód: nieznane.
- Pliki: js/app.js, index.html.

### Z-016 [P2] Tryb ciemny, i18n i ARIA stref
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak trybu ciemnego, wielojęzyczności, opisów ARIA dla stref, płynnych przejść i wariantu wysokiego kontrastu stref.
- Dowód: brak prefers-color-scheme w css/style.css.
- Pliki: css/style.css, index.html, js/app.js.

### Z-018 [P2] Monitoring ruchu na kafelkach OSM
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: strona z reklamami używa publicznych kafelków tile.openstreetmap.org; przy wzroście ruchu trzeba przejść na własne źródło.
- Dowód: js/map.js:26.
- Pliki: js/map.js (decyzja poza kodem).

### Z-023 [P2] Odświeżanie danych OSM
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: walknet.json, water.json, bridges.json i gridBbox nie mają cyklicznego odświeżania ani kontroli spójności.
- Dowód: żaden workflow nie wywołuje build-walknet, build-water ani build-bridges; pliki mają datę 2026-09-18.
- Pliki: .github/workflows/, tools/build-walknet.mjs, tools/build-water.mjs, tools/build-bridges.mjs.

### Z-032 [P1] Wyciek współrzędnych do AdSense
- Status: nowe
- Zgłoszone: nieznane
- Problem: po zgodzie żądania reklamowe (`pagead2.googlesyndication.com/.../ads?...url=`) niosą pełny adres strony razem z parametrem `p=lat,lon`, czyli lokalizacją użytkownika. Naprawa `page_location` z Z-040 dotyczyła wyłącznie Analytics.
- Dowód: obserwacja listy żądań w przeglądarce podczas wdrożenia Z-025. Potwierdzone 2026-11-16 w przeglądarce: żądania `https://pagead2.googlesyndication.com/pagead/ads?...` niosą pełny adres ze współrzędnymi w parametrach `url=` i `ref=`, dwa razy na odsłonę (jednostka 0x0 i 249x600). Przyczyna: AdSense czyta adres wprost z `location`, więc nadpisanie `page_location` w gtag go nie obejmuje. Zadanie nadal czeka na decyzję właściciela.
- Uwaga: przeniesienie współrzędnych z query do fragmentu adresu zatrzymałoby wyciek, ale zmienia format linków — wymaga zgodności wstecznej ze starymi linkami i decyzji właściciela.
- Pliki: index.html, js/app.js.

### Z-036 [P2] Panel mobilny, wariant B (decyzja właściciela)
- Status: nowe
- Zgłoszone: nieznane
- Problem: przypięty na dole panelu pasek wyniku z legendą i statusem oraz sekcja „Więcej opcji" chowająca rzadko zmieniane kontrolki (kierunek, dojście, środki transportu, opóźnienia, statystyki) z podsumowaniem zmienionych opcji w nagłówku. Skraca przewijanie panelu z ok. 1160 px do ok. 600 px. Zmienia układ interfejsu, dlatego wymaga zatwierdzenia. Wariant A (Z-030) wdrożony.
- Dowód: nieznane.
- Pliki: index.html, css/style.css, js/app.js.

### Z-037 [P2] Automatyczne ustawianie niedzieli w święto (decyzja właściciela)
- Status: nowe
- Zgłoszone: nieznane
- Problem: dziś w święto strona pokazuje komunikat z przyciskiem przełączającym na rozkład niedzielny (Z-022). Wariant pełny ustawiałby typ dnia sam. To naprawa (w Boże Ciało rozkład roboczy nie istnieje w terenie), ale zmienia domyślny stan kontrolki.
- Dowód: nieznane.
- Pliki: js/app.js.

### Z-038 [P2] Skrócony tekst banera zgody (decyzja właściciela)
- Status: nowe
- Zgłoszone: nieznane
- Problem: obecny tekst: „Strona korzysta z Google Analytics (anonimowe statystyki) oraz reklam Google — pliki cookie zapisywane tylko po zgodzie." Propozycja: „Używamy cookies Google (statystyki, reklamy) — tylko po zgodzie." Skróciłoby baner na telefonie ze 129 do ok. 105 px. To treść prawna, więc decyzja należy do właściciela.
- Dowód: nieznane.
- Pliki: index.html.

### Z-039 [P2] Zewnętrzna usługa zbierania błędów (decyzja właściciela)
- Status: nowe
- Zgłoszone: nieznane
- Problem: rozwiązanie z Z-025 daje lokalną diagnostykę plus zdarzenie w Analytics po zgodzie. Zewnętrzna usługa (np. Sentry) dałaby stosy i grupowanie, ale oznacza nową zależność runtime na froncie (złamanie nienegocjowalnego ograniczenia projektu), nowego procesora danych w polityce prywatności i możliwy koszt po przekroczeniu darmowego limitu. Kontrakt `setSink` w `js/diag.js` jest punktem wymiany, więc wdrożenie byłoby podmianą samego ujścia.
- Dowód: nieznane.
- Pliki: js/diag.js, js/app.js.

### Z-044 [P2] Tryb ciemny (`prefers-color-scheme: dark`) — decyzja właściciela
- Status: nowe
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: strona nie ma wariantu dla systemowego trybu ciemnego. Zmiana wpływa na wygląd dla wszystkich z ciemnym motywem systemu, dlatego wymaga zgody właściciela. Powiązane: Z-016 (szerszy zakres).
- Dowód: brak `prefers-color-scheme` w css/style.css (sprawdzone 2026-11-16).
- Wygląd i UX (esteta, specyfikacja z wejścia fali): tokeny ciemne `--surface #1b1c24`, `--ink #ececf1` (14,40:1), `--muted #a3a7b5` (7,07:1), `--accent #e872bd` (6,12:1), `--line #3a3c4a`, `--line-strong #6b6e82` (3,37:1), nowe `--on-accent`, `--dot-a`, `--dot-b`; `color-scheme: dark` na `.panel`, nie na `:root`. Mapa zostaje jasna: filtr `invert` na kafelkach odrzucony (psuje wodę, zieleń i etykiety). Ciemna mapa wymagałaby nowej palety stref, bo pasma 45 i 60 min dają na ciemnym tle kontrast 1,19 i 1,06:1. Swatche legendy w ciemnym motywie bez alfa, z obrysem. Przełącznik w interfejsie niepotrzebny.
- Pliki: css/style.css, js/app.js.

### Z-047 [P2] Zapis miasta do użytku offline — decyzja właściciela
- Status: nowe
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: strona nie działa offline z danymi rozkładowymi, a użytkownik nie ma jawnego sposobu zapisania miasta na telefonie. Zależy od etapu 3 Z-002.
- Dowód: nieznane.
- Rozwiązanie (szkic z wejścia fali, bez przeglądu rozwiazywacza): przycisk „Zapisz to miasto offline"; zapis `data/<miasto>/*` do nazwanego cache razem z `meta.generated`; widoczna data pobrania; przycisk „Odśwież"; automatyczne unieważnienie po 7 dniach; przycisk „Usuń dane offline". Koszt: kilka MB na telefonie użytkownika.
- Pliki: nieznane.

### Z-051 [P1] Rozkład Opola kończy się 2026-11-16
- Status: nowe
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: rozkład Opola kończy się dziś. To nie błąd kodu — feed przewoźnika wymaga odświeżenia albo trzeba znaleźć nowe źródło. Wymaga działania poza repozytorium.
- Dowód: `node tools/check-data.mjs` (2026-11-16) zgłasza „rozkład kończy się za mniej niż 7 dni (16.11.2026)"; build z 2026-11-02.
- Pliki: data/cities.json (ewentualna zmiana adresu feedu).

### Z-052 [P2] Ostrzeżenie `overtaking` może być kolejnym stałym szumem
- Status: nowe
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: bramka zapala ostrzeżenie przy każdym `overtaking > 0`, gdy poprzedni build ma to pole. Czy to szum, da się ocenić dopiero na realnych wartościach po następnym buildzie — dziś nie ma ich w `meta.json`.
- Dowód: pole `counts.days.<dzień>.overtaking` wprowadzone przy Z-005; ostrzeżenie w tools/check-data.mjs.
- Pliki: tools/check-data.mjs

### Z-053 [P2] Potwierdzenie progów bramki na realnych `counts` i `grid`
- Status: nowe
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: progi z Z-031 dobrano z wartości policzonych z plików rozkładowych, a nie z pól `counts` i `grid` w `meta.json`, bo tych jeszcze nie ma. Po pierwszym odświeżeniu danych trzeba sprawdzić, czy wyliczone udziały zgadzają się z zapisanymi.
- Dowód: obserwacja 2026-11-16: żaden `meta.json` nie ma pól `counts` ani `grid`.
- Pliki: tools/check-data.mjs

## Zrobione

### Z-020 [P1] Dostępność: prefers-reduced-motion i pola dotykowe
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: CLAUDE.md wymaga obsługi prefers-reduced-motion i pól dotykowych minimum 44x44 px, a kod tego nie spełnia.
- Dowód: css/style.css — brak jakiegokolwiek prefers-reduced-motion przy trzech transition (275, 306, 318); .collapse-btn i .help-btn mają 28x28 px (83-84), tor przełącznika 36x21 px (302-303).
- Pliki: css/style.css, index.html
- Rozwiązanie (rozwiazywacz): token `--tap: 44px`; cele w wierszach na pełną szerokość rosną realnie przez `min-height`, ikonki bez miejsca dostają przezroczystą nakładkę `::before` (tylko 3 miejsca, każde z co najmniej 12 px wolnej przestrzeni wokół); ruch gasi blokowy kill-switch `@media (prefers-reduced-motion: reduce)` z czasem 0,01 ms plus wyłączenie animacji Leafletu opcjami mapy.
- Wygląd i UX (esteta): ikonki nagłówka zostają wizualnie małe (32x32) z obszarem dotyku 44x44; tor przełącznika i checkboxy bez zmian wizualnych, klikalny cały wiersz; poprawki kontrastu bez nowych kolorów (`--muted` na `--line` miało 3,87:1); `:focus-visible` 2 px `--accent` dla 11 brakujących grup kontrolek; w widoku mobilnym `font-size: 16px` na polach, żeby iOS Safari nie przybliżał strony.
- Wdrożone 2026-11-16: css/style.css, js/map.js, js/app.js, nowy tests/a11y-css.test.mjs. index.html bez zmian. `npm run check`: lint czysty, 43/43 testy OK.
- Odstępstwo: segmenty mają `min-height: var(--tap)` z `margin: -3px 0` i przezroczystą ramką `border-block: 3px` oraz `background-clip: padding-box` (wizualnie 38 px, dotyk 44 px bez nakładki); cień „na zewnątrz" zrobiony przez `filter: drop-shadow`, bo `box-shadow` rysowałby się wokół pola 44 px i wystawał poza pasek.
- Niezweryfikowane: prawdziwa emulacja `prefers-reduced-motion` (narzędzie przeglądarki jej nie udostępnia — opcje mapy sprawdzone tylko stubem `matchMedia`); czy Leaflet przy klawiaturze i przyciskach zoomu pomija opcje mapy; wygląd dymka trasy z przyciskiem zamknięcia; przejście Tab przez cały panel (sprawdzone tylko przyciski zoomu); zoom 44x44 w `(pointer: coarse)` na prawdziwym urządzeniu dotykowym.

### Z-021 [P1] Kontrola jakości po odświeżeniu danych
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: workflow commituje i pushuje dane na main przed jakąkolwiek kontrolą, a kontrola sprawdza wyłącznie daty ważności i komplet dni.
- Dowód: tools/check-data.mjs:34-45 nie porównuje liczby kursów, wzorców, przystanków ani rozmiaru z poprzednim buildem i nie sprawdza, czy gridBbox pokrywa przystanki; .github/workflows/refresh-data.yml, krok „Zapisz zmiany".
- Pliki: tools/check-data.mjs, .github/workflows/refresh-data.yml, tools/build-data.mjs
- Rozwiązanie (rozwiazywacz): bramka regresji przed commitem, z granulacją na miasto, stanem odniesienia w gicie (`git show HEAD:data/<miasto>/meta.json`) i zaworem ważności. `build-data.mjs` dopisuje metryki `counts` i `grid` do `meta.json`; `check-data.mjs` porównuje świeży `meta.json` z opublikowanym; miasta z podejrzanym spadkiem są cofane do poprzedniej wersji, reszta commituje się normalnie; bramka sama puszcza spadek, gdy opublikowany rozkład wygasa w ciągu 7 dni (nie dotyczy `trips == 0` ani zniknięcia typu dnia). Ręczne przepuszczenie przez pole `force` w `workflow_dispatch`. Fail-open: awaria bramki nie wstrzymuje publikacji.
- Wdrożone 2026-11-16: tools/build-data.mjs, tools/check-data.mjs, .github/workflows/refresh-data.yml, nowy tests/check-data.test.mjs (11 testów), README.md (sekcja „Bramka jakości danych" z tabelą progów), CURRENT_STATE.md (jedna sekcja o bramce). `npm run check`: lint czysty, 43/43 testy OK.
- Decyzje przy wdrożeniu: zawór ważności NIE obejmuje zniknięcia typu dnia ani `trips == 0` (sprzeczność w specyfikacji rozstrzygnięta na rzecz twardej blokady); dodano podłogi bezwzględne także dla OSTRZEŻEŃ (kursy 20, wzorce 5, przystanki 5, linie 2, przesiadki 50, bajty 20 kB) — wartości arbitralne, do kalibracji; `--force` obejmuje też twarde blokady.
- Niezweryfikowane: nowe pola `counts` i `grid` nie były wygenerowane na realnym buildzie (`build-data.mjs` nie był uruchamiany — sprawdzone tylko składniowo); działanie YAML na runnerze (przekazanie `force` z crona, cofanie `git checkout HEAD -- data/<miasto>`, push na main, treść commita); `git show HEAD:` na runnerze; bramka zadziała dopiero od drugiego odświeżenia, bo pierwszy przebieg nie ma punktu odniesienia.

### Z-005 [P2] Zabezpieczenie niezmiennika earliestTrip
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: js/router.js:294 zakłada monotoniczność odjazdów względem kursów, a build sortuje tylko po pierwszym odjeździe. Sprawdzono 18 miast x 3 dni — 0 przypadków wyprzedzania, więc wyniki są dziś poprawne; zadanie to wymuszenie niezmiennika (asercja w buildzie albo rozbicie wzorca), nie naprawa błędu.
- Dowód: js/router.js:294, tools/build-data.mjs:429.
- Wdrożone 2026-11-16: build rozbija wzorce z kursami wyprzedzającymi się na łańcuchy (`splitOvertaking`, `profileLag` w `js/data.js`); dekoder liczy flagę `monotone`, a `js/router.js` przechodzi wtedy na skan zamiast wyszukiwania binarnego; `counts.days.<dzień>.overtaking` w `meta.json`; ostrzeżenie (nigdy blokada) w bramce jakości. Zmierzone: `splitOvertaking` 8,5 ms dla wzorca 30 000 kursów, flaga `monotone` ok. 0,1 ms (ok. 1% dekodowania w skrajnym przypadku). Potwierdzone automatem: `ZTM_SCAN_DATA=1` na obecnych danych daje `overtakingPatterns === 0` we wszystkich miastach. Dane bez wyprzedzania dają wpisy bajt w bajt jak dotąd.
- Pliki: js/data.js, js/router.js, tools/build-data.mjs, tools/check-data.mjs, tests/data.test.mjs, tests/router.test.mjs, tests/check-data.test.mjs, tests/helpers.mjs.
- Niezweryfikowane: brak rebuildu prawdziwego miasta; ostrzeżenie bramki zadziała od drugiego builda.

### Z-006 [P2] Aktualizacja CURRENT_STATE.md
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: nagłówek mówi „Stan na 2026-07-27", brakuje prac wrześniowych (Worker, obrysy, rower, testy, monitoring), wiele sekcji ma przestarzałe adnotacje „niezacommitowane".
- Dowód: CURRENT_STATE.md.
- Wdrożone 2026-11-16: nowa sekcja ze stanem obecnym; 23 przestarzałe adnotacje „niezacommitowane" usunięte (13 zamienionych na konkretne hashe); sekcja backlogu zastąpiona odesłaniem do ZADANIA-DO-ZROBIENIA.md. Bez zmian w kodzie.
- Pliki: CURRENT_STATE.md.
- Niezweryfikowane: czy pliki przesiadek dla 15 miast są już zbudowane po sieci ulic.

### Z-017 [P2] Licznik profili opóźnień w stopce
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak informacji „profile opóźnień: N linii" i ewentualnego data/status.json dla frontu.
- Dowód: nieznane.
- Wdrożone 2026-11-16: `tools/build-delays.mjs` dopisuje do `meta.json` pole `delays` (`routes`, `routesTotal`, `keys`, `updated`, `source`); `delayCoverage(meta, cityCfg)` w `js/data.js` ma cztery stany (`profiles`, `collecting`, `none`, `unknown`); stopka pokazuje pokrycie („128 z 180 linii (pomiary do 16.11.2026)" / „zbieramy pomiary" / „brak — margines szacunkowy") i milczy przy starych `meta.json`. Pod przełącznikiem trybu ostrożnego podpowiedź o pochodzeniu marginesu i o tym, że w kierunku „do miejsca" zawsze używany jest szacunek (`js/router.js:66`). Akapit pomocy nie sugeruje już danych „na żywo".
- Pliki: tools/build-delays.mjs, js/data.js, index.html, js/app.js, tests/build-delays.test.mjs, tests/data.test.mjs, tests/front-diag.test.mjs.
- Niezweryfikowane: pole `delays` pojawi się dopiero po przebiegu `build-delays.mjs`, więc dziś wszystkie miasta są w stanie `unknown` i front milczy.

### Z-022 [P2] Reprezentatywna data i „dziś"
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: każdy typ dnia to jedna data (pierwszy wtorek-czwartek od dnia builda), bez sprawdzenia świąt, ferii i reżimu wakacyjnego; UI wybiera typ dnia po getDay() w strefie przeglądarki.
- Dowód: tools/build-data.mjs:168-172 (pickDate), js/app.js:25, stopka pokazuje tylko feedDate (js/app.js:760).
- Wdrożone 2026-11-16 (wariant minimalny): nowy `js/calendar.js` — Wielkanoc algorytmicznie, 14 świąt ustawowych (w tym 24.12 jako dzień wolny od 2025 — potwierdzone w sieci, ustawa z 6.12.2024), reżim okresu, wybór daty omijający święta. Build zapisuje `dayInfo` w `meta.json`. Front liczy domyślny typ dnia i godzinę w strefie Europe/Warsaw; stopka pokazuje datę wybranego typu dnia; `#dayNote` ostrzega o rozkładzie z innego reżimu, o dzisiejszym święcie (z przyciskiem przełączającym na niedzielę) i o rozkładzie z dnia świątecznego. Dla 24.12 komunikat mówi o rozkładzie skróconym i nie podsuwa niedzieli. Link z `?day=` nigdy nie jest nadpisywany. Wariant pełny: Z-037.
- Pliki: js/calendar.js, tools/build-data.mjs, js/app.js, index.html, css/style.css, tests/calendar.test.mjs.
- Niezweryfikowane: brak przebiegu builda na prawdziwym feedzie.

### Z-024 [P2] Luka w testach
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: orkiestracja silnika nie ma testów, a tools/build-data.mjs (644 linii) ma tylko jeden test danych. Bez testów są zamiana ról rower/pieszy przy kierunku „do miejsca" (ACCESS_MODES, speedsFor), cap dojazdu i zależność wyniku od trybu; collect-delays i check-data też nie mają testów.
- Dowód: żaden plik w tests/ nie importuje engine.js, app.js, map.js ani worker.js.
- Wdrożone 2026-11-16: nowy `tests/engine.test.mjs`, 10 testów orkiestracji syntetycznego miasta (zamiana ról rower/pieszy, capy dojazdu, zależność wyniku od trybu, `dropCityCache`, `dropGrid`). Każdy istotny test zweryfikowany mutacją — osiem mutacji `js/engine.js` wywaliło co najmniej jeden test. `tools/build-data.mjs` nie da się przetestować bez zmiany kodu produkcyjnego — osobne zadanie Z-033.
- Pliki: tests/, js/engine.js, tools/. Nowy plik: tests/engine.test.mjs.

### Z-025 [P2] Brak telemetrii błędów po stronie klienta
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: nie ma window.onerror ani unhandledrejection, a błędy Workera kończą się komunikatem tylko dla użytkownika.
- Dowód: js/worker.js:50,63; grep po unhandledrejection, window.onerror i addEventListener('error' nie zwraca niczego.
- Wdrożone 2026-11-16: nowy `js/diag.js` (bufor 20 rekordów, deduplikacja, twarda redakcja: wycinanie query i hasha, skracanie ścieżek do nazwy pliku, współrzędne zamieniane na `[xx]`, jawna lista pól); `js/data.js` zostawia ślad w cichych gałęziach wczytywania; `js/worker.js` przesyła rekordy do wątku głównego; panel pokazuje blok „Coś nie zadziałało" z listą i przyciskiem kopiowania raportu oraz komunikat, gdy strona nie wstanie w 10 sekund. Po zgodzie leci zanonimizowane `app_error` do Google Analytics (max 5 na sesję, 1 na klucz); przed zgodą nic nie trafia do `dataLayer`. Potwierdzone w przeglądarce: przy odmowie zgody zero żądań do Google; po zgodzie jedno `collect` bez współrzędnych. Wariant z zewnętrzną usługą: Z-039.
- Pliki: js/diag.js, js/data.js, js/worker.js, index.html, js/app.js, css/style.css, tests/diag.test.mjs, tests/front-diag.test.mjs, tests/a11y-css.test.mjs.
- Niezweryfikowane: ścieżka błędu z workera przez prawdziwe zablokowanie pliku danych; `navigator.clipboard.writeText` (sprawdzony tylko fallback).

### Z-026 [P2] Escapowanie w HTML dymka
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: funkcja esc zamienia tylko & i <, a wynik jest składany do innerHTML. Ryzyko dziś niskie — treść idzie do węzłów tekstowych; powstanie przy użyciu w atrybucie lub zmianie szablonu.
- Dowód: js/app.js:569 (esc), js/app.js:597-610 (innerHTML z nazwami przystanków i linii z feedów GTFS).
- Wdrożone 2026-11-16: `esc` obsługuje pełny zestaw `& < > " '`; dane z feedów idą przez nią także w linkach stopki (`c.url` wcześniej leżało w `href` bez escapowania).
- Pliki: js/app.js, tests/search-aria.test.mjs.

### Z-027 [P2] Semantyka combobox dla wyszukiwarek adresów
- Status: zrobione
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: `ul role="listbox"` jest, ale pole nie ma `role="combobox"`, `aria-expanded`, `aria-controls` ani `aria-activedescendant`, `li` nie mają `id`, a `li.empty` nie ma `role="option"` (nieprawidłowe dziecko listboxa). Czytnik ekranu nie ogłasza podświetlonego wyniku.
- Dowód: index.html:81,88.
- Wdrożone 2026-11-16: oba pola mają `role="combobox"`, `aria-autocomplete`, `aria-expanded`, `aria-controls` i `aria-activedescendant`; opcje mają własne `id` i `aria-selected`; komunikat „brak wyników" wyniesiony do elementu `role="status"`.
- Pliki: index.html, js/app.js, tests/search-aria.test.mjs.
- Niezweryfikowane: zachowanie prawdziwego czytnika ekranu.

### Z-028 [P2] Synchronizacja offsetu kontrolek mapy z wysokością panelu
- Status: zrobione
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: offset kontrolek mapy na mobile to stała `calc(62vh + 8px)`, a panel bywa niższy — kontrolki wiszą wtedy za wysoko. Dodatkowo atrybucja Leafletu zajmuje na mobile dwie linie nad panelem (kosmetyka).
- Dowód: css/style.css, reguła `.leaflet-bottom.leaflet-right` w `@media (max-width: 560px)`.
- Wdrożone 2026-11-16: `ResizeObserver` ustawia `--panel-h` z realnej wysokości panelu; kontrolki mapy stoją 8 px nad jego krawędzią niezależnie od stanu panelu. Atrybucja na mobile skrócona do jednej linii (doklejka o rozkładach ukryta, link OpenStreetMap bez zmian). Usunięto ukrytą usterkę: przy starym `bottom: 0` panel zasłaniał atrybucję przy zwiniętym panelu.
- Pliki: css/style.css, js/app.js, js/map.js, tests/mobile-layout.test.mjs.

### Z-029 [P2] Baner zgody zasłania panel na mobile
- Status: zrobione
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: `.consent` zakrywa dolną część panelu i utrudnia korzystanie, dopóki użytkownik nie podejmie decyzji. Nie ustalono, czy to regresja czy stan sprzed Z-020.
- Dowód: zrzut 360x740.
- Wdrożone 2026-11-16: baner przeniesiony na górę ekranu, panel w całości dostępny, wysokość 129 px (zmierzone), `role="region"` z etykietą, element przed `<main>` dla poprawnej kolejności Tab. Treść prawna bez zmian. Skrócony tekst: Z-038.
- Pliki: css/style.css, index.html.

### Z-030 [P2] Panel mobilny wymaga dużego przewijania
- Status: zrobione
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: `scrollHeight` panelu to ok. 1160 px przy ok. 386 px widocznych (`max-height: 62vh`) — legenda i status są dopiero na drugim ekranie. Wymaga decyzji projektowej (np. zwijane sekcje, kompaktowa legenda).
- Dowód: pomiar w przeglądarce 360x740.
- Wdrożone 2026-11-16 (wariant A): zagęszczone marginesy w widoku mobilnym, oszczędność ok. 70 px, pola dotykowe nadal 44 px. Wariant B: Z-036.
- Pliki: css/style.css, index.html.

### Z-040 [P1] Wyciek współrzędnych do Google Analytics
- Status: zrobione
- Zgłoszone: nieznane
- Problem: adres strony nosi w query współrzędne klikniętego punktu (`p=54.35540,18.64450`), a GA4 domyślnie wysyła `page_location` z pełnym query stringiem — lokalizacja użytkownika trafiała do Google.
- Dowód: nieznane.
- Wdrożone 2026-11-16: nadpisanie `page_location` i `page_referrer` w `gtag('config', …)` na sam origin ze ścieżką. Potwierdzone w przeglądarce: adres strony zawierał współrzędne, a do Analytics poszło `http://localhost:8123/`.
- Pliki: index.html.
- Niezweryfikowane: pozostałe żądania reklamowe — Z-032; zdarzenia `page_view` z history-change — Z-035.

### Z-041 [P2] Ostrzeżenie bramki o zgubionych metadanych opóźnień
- Status: zrobione
- Zgłoszone: nieznane
- Problem: `tools/build-data.mjs` nadpisuje `meta.json` w całości, więc samodzielna przebudowa miasta kasuje pole `delays` dodane przez `build-delays.mjs`, a front przestaje po cichu pokazywać informację o pokryciu.
- Dowód: nieznane.
- Wdrożone 2026-11-16: bramka jakości ostrzega (nigdy nie blokuje), gdy miasto ma niepusty `delays.json`, a `meta.json` nie ma pola `delays`. Realne uruchomienie: ostrzeżenie dla Trójmiasta, Krakowa i Poznania, nic dla pozostałych 15 miast.
- Pliki: tools/check-data.mjs, tests/check-data.test.mjs.

### Z-042 [P2] Porządki w komunikatach wyszukiwarki
- Status: zrobione
- Zgłoszone: nieznane
- Problem: nieznane (porządki w komunikatach wyszukiwarki: martwy CSS, sposób ogłaszania zmian przez czytniki ekranu).
- Dowód: nieznane.
- Wdrożone 2026-11-16: usunięty martwy CSS `.search-results li.empty`; komunikaty statusu obu wyszukiwarek są stale obecne w drzewie i zmienia się tylko ich tekst; `.hint:empty` zeruje margines, więc pusty komunikat nie robi luki.
- Pliki: css/style.css, index.html, js/app.js, tests/search-aria.test.mjs.

### Z-033 [P2] Wydzielenie czystych funkcji z tools/build-data.mjs
- Status: zrobione
- Zgłoszone: nieznane
- Problem: plik nic nie eksportuje, czyta `process.argv` na poziomie modułu i od razu uruchamia build, więc import ma efekty uboczne i nie da się przetestować `pickDate`, składania wzorców, normalizacji czasów ani liczenia przesiadek. Blokuje to pokrycie testami najdłuższego skryptu w `tools/` (644 linie).
- Dowód: nieznane.
- Wdrożone 2026-11-16: nowy `tools/build-lib.mjs` z czystymi funkcjami bez efektów ubocznych przy imporcie (bez `fs`, bez `process.argv`). `tools/build-data.mjs` ma o ok. 280 linii mniej i importuje z modułu; I/O i orkiestracja zostały w nim. Wydzielono 21 nazw (funkcje i stałą `WEEKDAY_COLS`), m.in. `splitCsv`, `parseStopTimeRow`, `buildDayPatterns`, `crossesWater`, `gridCoverage`. Nie wydzielono pętli decyzyjnej `buildTransfers` (zrośniętej z grafem pieszym) ani streamingu `stop_times`.
- Weryfikacja: build z `HEAD` i nowy build na syntetycznym GTFS dały `workday.json`, `saturday.json` i `sunday.json` bajt w bajt identyczne; `meta.json` identyczny poza polem `generated`.
- Pliki: tools/build-data.mjs, tools/build-lib.mjs (nowy), tests/build-lib.test.mjs (nowy, 32 testy).
- Niezweryfikowane: build na prawdziwych danych miast (ścieżka z `walknet.json` i `water.json`).

### Z-034 [P2] Testy logiki frontu bez DOM
- Status: zrobione
- Zgłoszone: nieznane
- Problem: `js/app.js`, `js/map.js` i `js/worker.js` nie mają testów, bo wymagają DOM, Leafletu albo środowiska workera. Wymaga wydzielenia logiki niezależnej od DOM.
- Dowód: nieznane.
- Wdrożone 2026-11-16: nowy `js/uilogic.js` (ok. 200 linii) z czystą logiką niezależną od `document`, `window` i `location`: 13 funkcji, m.in. `warsawNow`, `parseUrlState`, `buildQuery`, `statusLine`, `createLatestQueue`. `js/app.js`, `js/map.js` i `js/worker.js` importują z modułu; ręczna pętla `pump` w workerze zastąpiona kolejką „ostatni wygrywa". Zachowanie strony bez zmian.
- Pliki: js/uilogic.js (nowy), js/app.js, js/map.js, js/worker.js, tests/uilogic.test.mjs (nowy, 36 testów).
- Testy brzegowe: błędne parametry URL, północ, zmiana czasu CET/CEST, obca strefa czasowa procesu.
- Sprawdzone w przeglądarce: klik na mapie, zmiana dnia i godziny, dymek trasy, silnik w wątku głównym (`engine=main`), konsola bez nowych błędów.
- Odstępstwo: `esc`, `optionId` i tekst pokrycia opóźnień zostały w `app.js`, bo `search-aria.test.mjs` i `front-diag.test.mjs` czytają `app.js` jako tekst. Przeniesienie: Z-046.

### Z-035 [P2] Weryfikacja page_view z history-change w GA4
- Status: zrobione
- Zgłoszone: nieznane
- Problem: naprawa z Z-040 nadpisuje `page_location` w `gtag('config', …)`, ale GA4 z włączonym pomiarem rozszerzonym wysyła własne `page_view` przy zmianach historii, a strona używa `history.replaceState` do aktualizacji adresu ze współrzędnymi.
- Dowód: nieznane przy zgłoszeniu; weryfikacja 2026-11-16 w przeglądarce.
- Werdykt 2026-11-16: wycieku do Google Analytics NIE MA. Żądania do `region1.google-analytics.com/g/collect` niosą `dl=http%3A%2F%2Flocalhost%3A8123%2F` i `dr=` tej samej postaci, bez `p=` i bez współrzędnych. Po dwóch wywołaniach `history.replaceState` GA4 nie wysłało dodatkowego `page_view`; w całej sesji były tylko `page_view` (start) i `scroll`. Nadpisanie `page_location` z Z-040 działa i wystarcza.
- Zmiany w kodzie: brak. Pliki: index.html (bez zmian).
- Zastrzeżenie: obserwacja dla jednej wersji gtag.js, nie gwarancja na przyszłość; sprawdzone tylko na localhost w Chromium.

### Z-031 [P2] Kalibracja progów bramki jakości danych
- Status: zrobione
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: podłogi bezwzględne dla ostrzeżeń zostały dobrane arbitralnie, a `grid.outsideShare` ostrzega przy każdym odświeżeniu, jeśli miasto stale przekracza 2%. Po pierwszym przebiegu na prawdziwych danych trzeba sprawdzić, które miasta już są powyżej progu, i skalibrować.
- Dowód: obiekt `GATE` w tools/check-data.mjs. Stale powyżej progu 2 % na danych z 2026-11-16: Warszawa 8,94%, Kraków 5,88%, Trójmiasto 5,52%, Toruń 5,02%, Poznań 3,16%, Bydgoszcz 2,79%, Kielce 2,59%. Przyczyna: linie podmiejskie wychodzą poza siatkę.
- Wdrożone 2026-11-16: `outsideShareWarn` z 0,02 (2%) na 0,25 (zapas ok. 2,8x wobec najwyższego dzisiejszego udziału; nadal łapie błędny `gridBbox` nowego miasta bez punktu odniesienia); `outsideShareRiseWarn` bez zmian (0,005); nowe `outsideRiseMinStops` 5 (0,5 punktu procentowego to w Gorzowie tylko 2 przystanki, więc sam wzrost procentowy nie wystarcza). Pozostałych progów absolutnych nie ruszono — nie ma dowodu, że szumią.
- Pliki: tools/check-data.mjs; testy: tests/check-data.test.mjs (5 nowych).
- Niezweryfikowane: żaden `meta.json` nie ma jeszcze pól `counts` ani `grid`, więc bramka dla wszystkich miast kończy dziś jako „brak punktu odniesienia"; nowy próg do potwierdzenia po pierwszym odświeżeniu danych (Z-053).

### Z-045 [P2] ARIA dla stref izochron
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: czytnik ekranu nie ogłasza zasięgów stref, a legenda podaje same liczby. Szkic gotowy, bez decyzji właściciela.
- Dowód: nieznane.
- Rozwiązanie (szkic z wejścia fali, bez przeglądu rozwiazywacza): nowy region `<p class="sr-only" id="zoneSummary" role="status" aria-live="polite" aria-atomic="true">` tuż za `#status`; `#status` dostaje `aria-live="off"`, żeby nie dublować komunikatów. Treść: `statusText`, miasto, zasięgi w kilometrach na pasmo (tylko gdy włączone „Pokaż statystyki" i brak trybu porównania) i liczba przystanków w zasięgu; przy wyłączonych statystykach skrócony wariant z podpowiedzią. Ogłaszanie z debounce 1000 ms od ostatniej fazy `zones`, region czyszczony przed nowym tekstem. Legenda: `role="group"` z `aria-labelledby`, każda komórka `role="listitem"` z pełną etykietą („do 10 min", „10–20 min", „ponad 60 min"), swatche `aria-hidden="true"`. Wymaga klasy `.sr-only` w CSS.
- Wdrożone 2026-11-16: składanie tekstu w czystej funkcji `zoneSummaryText` w `js/uilogic.js`; `js/app.js` ma tylko `announce()` z debounce 1000 ms, czyszczeniem regionu przed nowym tekstem i `cancelAnnounce()` na starcie przeliczenia. Region `#zoneSummary` stoi tuż za `#status`, który dostał `aria-live="off"`. Legenda: `role="group"` z `aria-labelledby`, `#legendBar` jako `role="list"`, komórki `role="listitem"` z pełnymi etykietami, swatche `aria-hidden="true"` także w tabeli statystyk. Nowa klasa `.sr-only` w CSS. Komunikat dla Krakowa (potwierdzony w przeglądarce): „Zasięg z punktu · dzień roboczy, 08:30. Miasto: Kraków. Zasięg w linii prostej od punktu: do 10 min — 2,2 km, 0,7% miasta, 10–20 min — 5,8 km, 6,3% miasta, 20–30 min — 10,4 km, 19% miasta, 30–45 min — 17,3 km, 45% miasta, 45–60 min — 27,4 km, 59% miasta, ponad 60 min — 50,5 km, 70% miasta. Przystanków w zasięgu: 3697." Pięć szybkich zmian godziny dało jeden komunikat.
- Pliki: index.html, css/style.css, js/app.js, js/uilogic.js; testy: tests/uilogic.test.mjs (7 nowych).
- Niezweryfikowane: prawdziwy czytnik ekranu (NVDA, VoiceOver), tryb porównania i tryb tylko pieszo w przeglądarce, ścieżki błędu w przeglądarce.

### Z-046 [P2] Przepisanie testów tekstowych na importy
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: `tests/search-aria.test.mjs` wyciąga `esc` i `optionId` wyrażeniem regularnym z `js/app.js`, a `tests/front-diag.test.mjs` tnie źródło między `renderDelayCoverage` a `renderSafeNote`. Przez to te fragmenty nie mogły przejść do `js/uilogic.js` przy Z-034.
- Dowód: tests/search-aria.test.mjs, tests/front-diag.test.mjs (odstępstwo przy Z-034).
- Rozwiązanie (szkic z wejścia fali, bez przeglądu rozwiazywacza): przepisać oba testy na import z modułu, potem przenieść kod do `js/uilogic.js` i dopisać przypadki brzegowe `esc` (`& < > " '`).
- Wdrożone 2026-11-16: `esc`, `optionId`, `delayCoverageText` i `safeNoteText` przeniesione do `js/uilogic.js`; `renderDelayCoverage` i `renderSafeNote` w `js/app.js` tylko wstawiają wynik do DOM. Oba testy importują funkcje zamiast wycinać kod wyrażeniem regularnym. Dopisane przypadki brzegowe `esc`: każdy z pięciu znaków osobno, wszystkie naraz, znaki powtórzone i w środku tekstu, pusty string, `null`, `undefined`, tekst bez znaków specjalnych.
- Pliki: js/uilogic.js, js/app.js, tests/search-aria.test.mjs, tests/front-diag.test.mjs.

### Z-048 [P2] Interwencja Chrome przy `navigator.vibrate`
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: gdy pierwsze przeliczenie po wczytaniu strony trwa ponad 1,5 s, a użytkownik niczego nie dotknął, Chrome wypisuje w konsoli „Blocked call to navigator.vibrate because user hasn't tapped…". Nic się nie psuje, ale wpis zaśmieca konsolę.
- Dowód: obserwacja w konsoli Chrome (wersja i miejsce nieznane).
- Rozwiązanie (szkic z wejścia fali, bez przeglądu rozwiazywacza): sprawdzić `navigator.userActivation?.hasBeenActive` przed wywołaniem wibracji.
- Wdrożone 2026-11-16: `shouldVibrate` dostaje pole `userActivated` i blokuje wibrację tylko przy dokładnie `false`; `js/app.js` podaje `navigator.userActivation?.hasBeenActive`, a brak tego API (`undefined`) nie blokuje. Konsola nie zbiera już wpisu „Blocked call to navigator.vibrate", gdy pierwsze przeliczenie po wczytaniu strony trwa dłużej niż 1,5 s.
- Pliki: js/uilogic.js, js/app.js; testy: tests/uilogic.test.mjs.
- Niezweryfikowane: czysty dowód z konsoli (bufor narzędzia nie jest czyszczony po przeładowaniu); wibracja na prawdziwym urządzeniu dotykowym.

### Z-049 [P2] Próg 60 km w `nearestCity`
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: próg 60 km w `nearestCity` (miasto z `center` w promieniu 60 km, gdy punkt nie trafia w żaden `bbox`) został dobrany arbitralnie przy wdrożeniu Z-002 etap 2 i nie był kalibrowany na rozkładzie miast z `data/cities.json`.
- Dowód: js/uilogic.js, funkcja `nearestCity`. Pomiar z `data/cities.json`: odległość od środka miasta do krawędzi `bbox` wynosi od 5,3 km (Opole) do 47,7 km (GZM, do rogu 62,3 km), typowo 8–20 km. Stary próg dawał dwie wady: punkt bez żadnego `bbox` dostawał propozycję miasta oddalonego nawet o 53,6 km od jego krawędzi, a punkt 6 km za krawędzią dużego `bbox` (GZM) nie dostawał żadnej propozycji (156 takich punktów w symulacji siatką co 0,02°).
- Wdrożone 2026-11-16: funkcja mierzy odległość do prostokąta `bbox` (miasto bez `bbox` nadal od środka); próg to wyeksportowane `NEAREST_CITY_MAX_KM = 15` włącznie. 15 km to pas podmiejski; najbliższe sąsiednie `bbox` leżą dalej niż 30 km, więc miasta nie konkurują. **Zmiana widoczna dla użytkownika**: propozycja przełączenia miasta po użyciu lokalizacji pojawia się teraz w innych miejscach niż wcześniej.
- Pliki: js/uilogic.js; testy: tests/uilogic.test.mjs.
- Niezweryfikowane w przeglądarce: tylko testy i symulacja siatką.

### Z-050 [P1] Gubienie metadanych pokrycia opóźnieniami w `meta.json`
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: trzy miasta (Trójmiasto, Kraków, Poznań) mają `delays.json`, ale w `meta.json` zniknęło pole `delays`, więc stopka nie pokazuje pokrycia profilami opóźnień. Funkcja wdrożona przy Z-017 po cichu nie działa dla tych miast.
- Dowód: wykryte przebiegiem `node tools/check-data.mjs` na danych z 2026-11-16. `tools/build-data.mjs` składał `meta.json` od zera, bez czytania poprzedniej zawartości; `tools/build-delays.mjs` dopisuje do niego wyłącznie pole `delays`. Kolejność w `refresh-data.yml` (`build-data`, potem `build-delays`) jest poprawna, ale nie chroni ręcznego lub lokalnego uruchomienia `build-data` po `build-delays`.
- Wdrożone 2026-11-16: czysta funkcja `carryOverMeta(prevMeta, { delaysFileExists })` w `tools/build-lib.mjs` przenosi pole `delays` ze starego `meta.json` tylko wtedy, gdy `delays.json` nadal istnieje. Po wypadnięciu feedu GTFS-RT strona nie pokaże więc nieprawdziwej informacji. Naprawa przy zapisie, nie przez kolejność w workflow.
- Pliki: tools/build-lib.mjs, tools/build-data.mjs; testy: tests/build-lib.test.mjs (3 nowe).
- Niezweryfikowane: naprawa na prawdziwym buildzie. Oczekiwane: Trójmiasto, Kraków i Poznań odzyskają pole przy najbliższym odświeżeniu danych, bez osobnego kroku.

## Odrzucone

### Z-043 [P2] Szerokość korytarza mostu
- Status: odrzucone
- Zgłoszone: nieznane (dawny punkt #11 z CURRENT_STATE.md)
- Problem: szerokość korytarza mostu jako możliwe ograniczenie wyników.
- Dowód: brak potwierdzonego przypadku.
- Powód odrzucenia: analityk ocenił to jako ryzyko czysto teoretyczne bez potwierdzonego przypadku; graf ulic i przesiadki po grafie ograniczają skutki. Pozycja zniknęła przy aktualizacji CURRENT_STATE.md (Z-006) i zostaje świadomie odrzucona.
