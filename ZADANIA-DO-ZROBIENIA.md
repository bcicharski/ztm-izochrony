# Zadania do zrobienia

Kolejka pracy agentów. Utrzymuje ją wyłącznie agent `kronikarz`.
Identyfikatory `Z-NNN` są trwałe — numer nigdy nie jest używany ponownie.
Statusy: `nowe` -> `zaprojektowane` -> `w toku` -> `zrobione` -> `odrzucone`.

Stary backlog `zadania.md` to archiwum, tylko do czytania.

## W toku

_(pusto)_

## Zaprojektowane (gotowe do wdrożenia)

_(pusto)_

## Nowe (bez projektu rozwiązania)

### Z-001 [P1] Certyfikowany CMP (Consent Mode v2)
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: własny baner zgody nie spełnia wymogu Google dla EOG — potrzebny certyfikowany CMP. Uwaga: ryzyko prawne.
- Dowód: index.html:321-359.
- Pliki: index.html oraz ustawienie w panelu AdSense (poza kodem).

### Z-002 [P1] Mobile i PWA
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak manifest.json i service workera; offline tylko przez cache przeglądarki. Dochodzi bottom sheet, przycisk „wyśrodkuj na mnie" i wibracja.
- Dowód: brak odwołań do manifestu i service workera w index.html.
- Pliki: index.html, js/app.js, css/style.css, nowy manifest.json.

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

### Z-005 [P2] Zabezpieczenie niezmiennika earliestTrip
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: js/router.js:294 zakłada monotoniczność odjazdów względem kursów, a build sortuje tylko po pierwszym odjeździe. Sprawdzono 18 miast x 3 dni — 0 przypadków wyprzedzania, więc wyniki są dziś poprawne; zadanie to wymuszenie niezmiennika (asercja w buildzie albo rozbicie wzorca), nie naprawa błędu.
- Dowód: js/router.js:294, tools/build-data.mjs:429.
- Pliki: tools/build-data.mjs, js/router.js.

### Z-006 [P2] Aktualizacja CURRENT_STATE.md
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: nagłówek mówi „Stan na 2026-07-27", brakuje prac wrześniowych (Worker, obrysy, rower, testy, monitoring), wiele sekcji ma przestarzałe adnotacje „niezacommitowane".
- Dowód: CURRENT_STATE.md.
- Pliki: CURRENT_STATE.md.

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

### Z-017 [P2] Licznik profili opóźnień w stopce
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak informacji „profile opóźnień: N linii" i ewentualnego data/status.json dla frontu.
- Dowód: nieznane.
- Pliki: js/app.js, tools/collect-delays.mjs.

### Z-018 [P2] Monitoring ruchu na kafelkach OSM
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: strona z reklamami używa publicznych kafelków tile.openstreetmap.org; przy wzroście ruchu trzeba przejść na własne źródło.
- Dowód: js/map.js:26.
- Pliki: js/map.js (decyzja poza kodem).

### Z-019 [P1] Brakujące profile opóźnień dla GZM i Szczecina
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: oba miasta mają skonfigurowane źródło rt, ale nie mają danych opóźnień. Niezweryfikowane: zawartość gałęzi delays i log kolektora.
- Dowód: data/cities.json:300,344; data/delays/ zawiera tylko krakow.json, poznan.json, trojmiasto.json, a rt jest ustawione dla 5 miast.
- Pliki: data/delays/, tools/collect-delays.mjs, data/cities.json.

### Z-022 [P2] Reprezentatywna data i „dziś"
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: każdy typ dnia to jedna data (pierwszy wtorek-czwartek od dnia builda), bez sprawdzenia świąt, ferii i reżimu wakacyjnego; UI wybiera typ dnia po getDay() w strefie przeglądarki.
- Dowód: tools/build-data.mjs:168-172 (pickDate), js/app.js:25, stopka pokazuje tylko feedDate (js/app.js:760).
- Pliki: tools/build-data.mjs, js/app.js.

### Z-023 [P2] Odświeżanie danych OSM
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: walknet.json, water.json, bridges.json i gridBbox nie mają cyklicznego odświeżania ani kontroli spójności.
- Dowód: żaden workflow nie wywołuje build-walknet, build-water ani build-bridges; pliki mają datę 2026-09-18.
- Pliki: .github/workflows/, tools/build-walknet.mjs, tools/build-water.mjs, tools/build-bridges.mjs.

### Z-024 [P2] Luka w testach
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: orkiestracja silnika nie ma testów, a tools/build-data.mjs (644 linii) ma tylko jeden test danych. Bez testów są zamiana ról rower/pieszy przy kierunku „do miejsca" (ACCESS_MODES, speedsFor), cap dojazdu i zależność wyniku od trybu; collect-delays i check-data też nie mają testów.
- Dowód: żaden plik w tests/ nie importuje engine.js, app.js, map.js ani worker.js.
- Pliki: tests/, js/engine.js, tools/.

### Z-025 [P2] Brak telemetrii błędów po stronie klienta
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: nie ma window.onerror ani unhandledrejection, a błędy Workera kończą się komunikatem tylko dla użytkownika.
- Dowód: js/worker.js:50,63; grep po unhandledrejection, window.onerror i addEventListener('error' nie zwraca niczego.
- Pliki: index.html, js/app.js, js/worker.js.

### Z-026 [P2] Escapowanie w HTML dymka
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: funkcja esc zamienia tylko & i <, a wynik jest składany do innerHTML. Ryzyko dziś niskie — treść idzie do węzłów tekstowych; powstanie przy użyciu w atrybucie lub zmianie szablonu.
- Dowód: js/app.js:569 (esc), js/app.js:597-610 (innerHTML z nazwami przystanków i linii z feedów GTFS).
- Pliki: js/app.js.

### Z-027 [P2] Semantyka combobox dla wyszukiwarek adresów
- Status: nowe
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: `ul role="listbox"` jest, ale pole nie ma `role="combobox"`, `aria-expanded`, `aria-controls` ani `aria-activedescendant`, `li` nie mają `id`, a `li.empty` nie ma `role="option"` (nieprawidłowe dziecko listboxa). Czytnik ekranu nie ogłasza podświetlonego wyniku.
- Dowód: index.html:81,88.
- Pliki: index.html, js/app.js

### Z-028 [P2] Synchronizacja offsetu kontrolek mapy z wysokością panelu
- Status: nowe
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: offset kontrolek mapy na mobile to stała `calc(62vh + 8px)`, a panel bywa niższy — kontrolki wiszą wtedy za wysoko. Dodatkowo atrybucja Leafletu zajmuje na mobile dwie linie nad panelem (kosmetyka).
- Dowód: css/style.css, reguła `.leaflet-bottom.leaflet-right` w `@media (max-width: 560px)`.
- Pliki: css/style.css, js/app.js

### Z-029 [P2] Baner zgody zasłania panel na mobile
- Status: nowe
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: `.consent` zakrywa dolną część panelu i utrudnia korzystanie, dopóki użytkownik nie podejmie decyzji. Nie ustalono, czy to regresja czy stan sprzed Z-020.
- Dowód: zrzut 360x740.
- Pliki: css/style.css, index.html

### Z-030 [P2] Panel mobilny wymaga dużego przewijania
- Status: nowe
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: `scrollHeight` panelu to ok. 1160 px przy ok. 386 px widocznych (`max-height: 62vh`) — legenda i status są dopiero na drugim ekranie. Wymaga decyzji projektowej (np. zwijane sekcje, kompaktowa legenda).
- Dowód: pomiar w przeglądarce 360x740.
- Pliki: css/style.css, index.html

### Z-031 [P2] Kalibracja progów bramki jakości danych
- Status: nowe
- Zgłoszone: 2026-11-16 (wdrozeniowiec)
- Problem: podłogi bezwzględne dla ostrzeżeń zostały dobrane arbitralnie, a `grid.outsideShare` ostrzega przy każdym odświeżeniu, jeśli miasto stale przekracza 2%. Po pierwszym przebiegu na prawdziwych danych trzeba sprawdzić, które miasta już są powyżej progu, i skalibrować.
- Dowód: obiekt `GATE` w tools/check-data.mjs.
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

## Odrzucone

_(pusto)_
