# Changelog

Historia wdrożonych zmian i prac w toku. Najnowsze na górze.
Utrzymuje ten plik wyłącznie agent `kronikarz`. Historia nie jest kasowana.

## W toku
- Z-019 Brakujące profile opóźnień dla GZM i Szczecina — etap: weryfikacja (oczekiwanie na pierwszy przebieg kolektora z nową diagnostyką).

## 2026-11-16

### Dodane
- Z-022 Strona rozpoznaje polskie święta: w stopce widać datę rozkładu dla wybranego typu dnia, a gdy dziś jest święto albo rozkład pochodzi z innego okresu (np. wakacyjnego), pojawia się wyjaśnienie z możliwością przełączenia na rozkład niedzielny jednym kliknięciem. Domyślna godzina i dzień liczone są w czasie polskim, a nie w strefie przeglądarki. (pliki: js/calendar.js, tools/build-data.mjs, js/app.js, index.html, css/style.css; testy: tests/calendar.test.mjs; nowe pola w meta.json pojawią się po najbliższym odświeżeniu danych)
- Z-017 Widać, skąd bierze się margines w trybie ostrożnym: stopka pokazuje, dla ilu linii są pomiary opóźnień, a przy przełączniku jest wyjaśnienie, czy margines pochodzi z pomiarów, czy z szacunku. (pliki: tools/build-delays.mjs, js/data.js, index.html, js/app.js; testy: tests/build-delays.test.mjs, tests/front-diag.test.mjs; informacja pojawi się po przebiegu kompilacji profili)
- Z-025 Diagnostyka błędów: po awarii panel pokazuje blok „Coś nie zadziałało" z przyciskiem kopiowania raportu, a raport nie zawiera lokalizacji użytkownika ani pełnego adresu. (pliki: js/diag.js, js/data.js, js/worker.js, index.html, js/app.js, css/style.css; testy: tests/diag.test.mjs, tests/front-diag.test.mjs)
- Z-019 (częściowo) Awaria zbierania opóźnień przestała być niewidoczna — przebieg zgłasza przyczynę per miasto i per adres feedu. (pliki: tools/collect-delays.mjs, .github/workflows/collect-delays.yml, README.md; testy: tests/collect-delays.test.mjs; przyczyna braku danych dla GZM i Szczecina nadal nieznana)
- Z-021 Bramka jakości danych: dane z podejrzanym spadkiem (mniej kursów, wzorców, przystanków, linii albo mniejsze pliki niż w poprzednim buildzie) nie trafiają już automatycznie na stronę — takie miasto jest cofane do poprzedniej wersji, pozostałe publikują się normalnie, a workflow zgłasza raport z instrukcją ręcznego przepuszczenia. (pliki: tools/build-data.mjs, tools/check-data.mjs, .github/workflows/refresh-data.yml, README.md, CURRENT_STATE.md; testy: tests/check-data.test.mjs; npm run check: lint czysty, 43/43 testy OK; bramka zadziała od drugiego odświeżenia, bo pierwsze nie ma punktu odniesienia; nie sprawdzone na prawdziwym przebiegu workflow)

### Zmienione
- Z-030 (wariant A) Panel na telefonie ma gęstsze odstępy — ok. 70 px mniej przewijania, pola dotykowe nadal 44 px. (pliki: css/style.css)
- Z-027 Wyszukiwarki adresów mają pełną semantykę listy podpowiedzi, więc czytnik ekranu ogłasza podświetlony wynik. (pliki: index.html, js/app.js; testy: tests/search-aria.test.mjs)
- Z-042 Komunikat „nie znaleziono" jest pewniej ogłaszany przez czytniki ekranu. (pliki: css/style.css, index.html, js/app.js)
- Z-020 Dostępność: wszystkie kontrolki panelu mają obszar dotyku co najmniej 44x44 px (ikonki nagłówka zostają wizualnie małe), poprawiony kontrast nieaktywnych etykiet i obramowań pól, widoczny obrys fokusu na wszystkich kontrolkach, a przy systemowym ustawieniu „ogranicz ruch" strona i mapa nie animują niczego. Na telefonie pola mają 16 px, żeby iOS Safari nie przybliżał strony. (pliki: css/style.css, js/map.js, js/app.js; testy: tests/a11y-css.test.mjs; npm run check: lint czysty, 43/43 testy OK; nie sprawdzone w przeglądarce: prawdziwa emulacja prefers-reduced-motion, dymek trasy, zachowanie zoomu z klawiatury)

### Naprawione
- Z-040 Współrzędne klikniętego punktu nie trafiają już do Google Analytics — adres wysyłany do statystyk nie zawiera parametrów. (pliki: index.html; potwierdzone w przeglądarce)
- Z-028 Przyciski powiększania mapy i atrybucja OpenStreetMap nie chowają się już pod panelem na telefonie i trzymają się jego krawędzi niezależnie od wysokości. (pliki: css/style.css, js/app.js, js/map.js; testy: tests/mobile-layout.test.mjs)
- Z-029 Baner zgody nie zasłania już panelu na telefonie — przeniesiony na górę ekranu. (pliki: css/style.css, index.html)
- Z-026 Nazwy przystanków i linii z danych przewoźników są poprawnie escapowane we wszystkich miejscach, także w linkach stopki. (pliki: js/app.js; testy: tests/search-aria.test.mjs)

### Wewnętrzne
- Wprowadzono stały zespół agentów (`analityk`, `rozwiazywacz`, `esteta`,
  `wdrozeniowiec`, `kronikarz`, `sekretarz`) w `.claude/agents/`.
- Dodano `CLAUDE.md` z zasadami pracy w projekcie oraz pliki pamięci projektu
  `ZADANIA-DO-ZROBIENIA.md` i `CHANGELOG.md`. (bez zmian w kodzie strony)
- Zlikwidowano stary backlog `zadania.md`. Analityk zweryfikował jego zawartość wobec kodu: większość punktów była już zrobiona albo straciła sens, a 18 żywych zadań przeniesiono do `ZADANIA-DO-ZROBIENIA.md` jako Z-001..Z-018. Plik usunięty z repozytorium (zostaje w historii gita). (bez zmian w kodzie strony)
- Z audytu analityka doszło 8 nowych ustaleń jako Z-019..Z-026, a z wdrożeń 5 kolejnych jako Z-027..Z-031.
- Z-005 Wyniki są odporne na kursy wyprzedzające się w obrębie wzorca: build rozbija takie wzorce automatycznie, a stare dane włączają bezpieczniejszy wariant wyszukiwania. Dzisiejsze dane są czyste, więc dla użytkownika nic się nie zmienia. (pliki: js/data.js, js/router.js, tools/build-data.mjs, tools/check-data.mjs; testy: tests/data.test.mjs, tests/router.test.mjs, tests/check-data.test.mjs — 12 nowych)
- Z-024 Silnik dostał 10 testów orkiestracji, każdy istotny zweryfikowany mutacją kodu. (pliki: tests/engine.test.mjs)
- Z-041 Bramka jakości ostrzega, gdy miasto zgubi metadane pokrycia profilami opóźnień. (pliki: tools/check-data.mjs; testy: tests/check-data.test.mjs)
- Z-006 CURRENT_STATE.md opisuje stan na 2026-11-16; 23 przestarzałe adnotacje usunięte, backlog zastąpiony odesłaniem do ZADANIA-DO-ZROBIENIA.md. (pliki: CURRENT_STATE.md)
- Łącznie w tej fali: lint czysty, 123 testy (122 pass, 0 fail, 1 pomijany), 8 nowych plików testowych. `npm run check`: lint czysty, 123 testy, 122 pass, 0 fail, 1 skipped (test skanujący `data/` tylko z `ZTM_SCAN_DATA=1`).
