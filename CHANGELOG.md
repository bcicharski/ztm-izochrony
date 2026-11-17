# Changelog

Historia wdrożonych zmian i prac w toku. Najnowsze na górze.
Utrzymuje ten plik wyłącznie agent `kronikarz`. Historia nie jest kasowana.

## W toku
- Z-019 Brakujące profile opóźnień dla GZM i Szczecina — etap: weryfikacja (oczekiwanie na pierwszy przebieg kolektora z nową diagnostyką).
- Z-002 Mobile i PWA — etap: wdrożenie (etapy 1 i 2 wdrożone; etap 3, service worker, czeka na decyzję właściciela).
- Z-051 Rozkład Opola kończy się 2026-11-16; Łódź i Olsztyn mają nowe adresy źródeł i przeliczone dane (2026-11-17) — etap: wdrożenie (częściowo; Opole -> Z-054, Gorzów -> Z-055, przegląd przed 2026-12-30).
- Z-009 Stopka i onboarding — etap: wdrożenie (wskazówka przy pierwszej wizycie zrobiona; stopka i przycisk Suppi otwarte).
- Z-015 Udostępnianie i wyszukiwarka — etap: wdrożenie (historia ostatnich punktów i wyszukiwanie przystanków zrobione (Z-056); krótkie linki, dynamiczny obrazek OG i iframe otwarte).

## 2026-11-17
### Dodane
- Z-008 Zwinięty panel pokazuje legendę, więc zrzut ekranu z mapą ma objaśnienie kolorów. Czysty widok mapy powstaje przez istniejący przycisk zwijania, bez osobnego trybu. Na telefonie przy zwiniętym panelu widać źródło rozkładów; atrybucja OpenStreetMap widoczna zawsze. Przy okazji naprawiono błąd dostępności (przycisk zwijania po zwinięciu mówił „Zwiń panel") i dołożono ogłaszanie stanu panelu dla czytnika ekranu („Panel zwinięty. Widać samą mapę i legendę." / „Panel rozwinięty."). Odrzucono osobny tryb czystego widoku. (pliki: css/style.css, js/app.js, tests/mobile-layout.test.mjs; index.html bez zmian; testy: tests/mobile-layout.test.mjs — 2 nowe plus poprawiony test doklejki atrybucji, `TAP_USES_MIN` bez zmian (23); npm run check: lint czysty, 307 testów, 306 pass, 0 fail, 1 skipped (dosłowny wynik w sekcji Wewnętrzne); zmierzone w przeglądarce (Trójmiasto): desktop 1024 px panel 666 px rozwinięty, 143 px zwinięty; 360 px 459 px rozwinięty, 143 px zwinięty; legenda 50 px rozwinięta, 70 px zwinięta; odstępstwo: specyfikacja szacowała zwinięty panel na ok. 105 px; nie sprawdzone: odczyt prawdziwym czytnikiem ekranu (sprawdzono tylko treść regionu i atrybuty), wygląd legendy w stanie zwiniętym (nie przeszedł przeglądu estety), obrót ekranu przy zwiniętym panelu; znane ryzyko: ogłoszenie stref oczekujące w momencie kliknięcia może po swojej sekundzie nadpisać komunikat o panelu)
### Zmienione
- Z-051 Dane rozkładowe Łodzi i Olsztyna odświeżone z nowych źródeł (ręczne przeliczenie za zgodą właściciela; pierwsze nadpisanie `data/<miasto>/` od podmiany źródeł). Łódź: feed UMŁ, zakres 2026-11-16–2026-12-31, dni 2026-11-17 (roboczy), 2026-11-21 (sobota), 2026-11-22 (niedziela); 24161 kursów, 2390 przystanków w 1336 zespołach, 674361 wierszy `stop_times`, 10350 przesiadek pieszych; jeden wzorzec rozbity przez wyprzedzanie w niedzielę. Olsztyn: feed ZDZiT (tryb `html-latest`), zakres 2026-10-26–2026-11-30, te same dni; 5570 kursów, 842 przystanki (603 po usunięciu bez kursów), 2036 przesiadek pieszych. Nic się nie zgubiło: lodz/workday 591578 → 597587 B, lodz/saturday 494458 → 499447, lodz/sunday 482585 → 488111; olsztyn/workday 137585 → 147801, olsztyn/saturday 103303 → 113587, olsztyn/sunday 87083 → 97415. Bramka jakości (`node tools/check-data.mjs`) nie zgłasza problemów dla Łodzi ani Olsztyna. Sprawdzone w przeglądarce (`?city=lodz`, `?city=olsztyn`, punkt w centrum): izochrona się liczy, sześć pasm w legendzie, status „Zasięg z punktu · dzień roboczy, 08:00.", brak ostrzeżenia o nieaktualnym rozkładzie; stopka: Łódź rozkład z 17.11.2026 ważny do 31.12.2026, Olsztyn rozkład z 17.11.2026 ważny do 30.11.2026. (pliki: data/lodz/meta.json, data/lodz/workday.json, data/lodz/saturday.json, data/lodz/sunday.json, data/olsztyn/meta.json, data/olsztyn/workday.json, data/olsztyn/saturday.json, data/olsztyn/sunday.json; testy: bez nowych; npm run check: 269 testów, 268 pass, 0 fail, 1 skipped, lint czysty — wynik podany w zleceniu, nie wklejony dosłownie z terminala; nie sprawdzone: poprawność rozkładów względem terenu, przełączniki środków transportu, tryb porównania i tryb ostrożny na nowych danych, zachowanie przy następnym automatycznym odświeżeniu; Opole nadal otwarte w Z-051 i Z-054)
- Z-059 Panel nie przewija się już w widoku domyślnym: trzy sekcje (Czas i kierunek, Dojście i środki transportu, Opóźnienia i statystyki) są zwinięte, a „Dane i kontakt" jest przypięta na dole panelu i zawsze widoczna. Zmierzone w przeglądarce (Trójmiasto, 1024x768): przed `scrollHeight` 1243 px przy 663 px, po zwinięciu 550 px przy 550 px. Stan sekcji zapamiętywany lokalnie, nie w adresie URL; sekcja „Czas i kierunek" otwiera się sama przy komunikacie o święcie, bez zapisu jako wybór użytkownika. Zmiana układu zatwierdzona przez właściciela. (pliki: index.html, css/style.css, js/uilogic.js, js/app.js, README.md, CURRENT_STATE.md; testy: tests/uilogic.test.mjs (18 nowych), tests/mobile-layout.test.mjs (TAP_USES_MIN 22 -> 23), tests/a11y-css.test.mjs (`.sec > summary` w inwentarzu); npm run check: dosłowny wynik poniżej, lint czysty; nie sprawdzone: pusta przestrzeń nad stopką na produkcji z włączonym AdSense, czytnik ekranu, prawdziwe urządzenie dotykowe)
Dosłowny wynik `npm run check` po Z-059:
```
ℹ tests 296
ℹ pass 295
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 801.3152
```

### Naprawione
- Z-052 Ostrzeżenie o wyprzedzaniu kursów w bramce jakości danych nie zapala się już przy niezmienionej liczbie wzorców — alarmuje tylko wzrost. Po przeliczeniu Łodzi fałszywy alarm dotyczył wartości, która się nie zmieniła. Ostrzeżenie nigdy nie blokuje publikacji. Dane na stronie bez zmian. (pliki: tools/check-data.mjs; testy: tests/check-data.test.mjs — 1 nowy przypadek „niezmieniona liczba nie ostrzega (Z-052)"; npm run check: lint czysty, 270 testów, 269 pass, 0 fail, 1 skipped — dosłowny wynik w sekcji Wewnętrzne; nie sprawdzone: zachowanie bramki przy następnym automatycznym odświeżeniu)
- Z-060 Pięć drobnych usterek: komunikaty lokalizacji i eksportu docierają do czytnika ekranu; Enter przy jednym lub dwóch znakach pokazuje komunikat, że trzeba wpisać co najmniej 3 znaki (próg dla adresów bez zmian); awaryjne kopiowanie linku zostawia adres do zaznaczenia w polu; wyłączony przycisk lokalizacji ma trwały opis powodu zamiast `title`; kolory w CSS wyłącznie z tokenów w `:root` (wartości bez zmian, zero różnicy wizualnej). (pliki: js/app.js, js/uilogic.js, css/style.css; testy: tests/a11y-css.test.mjs (1 nowy); wdrożenie w commicie 29b0d6b; npm run check: 278 testów, 277 pass, 0 fail, 1 skipped, lint czysty (wynik podany w zleceniu, nie wklejony dosłownie z terminala); nie sprawdzone: weryfikacja ręczna każdego punktu)

### Wewnętrzne
- Z-051 i Z-054 Decyzja właściciela: rozkład Opola zostaje widoczny ze starymi danymi i z ostrzeżeniem o nieaktualnym rozkładzie; wariant „czasowo ukryć miasto" odrzucony. Ostrzeżenie potwierdzone w przeglądarce dla `?city=opole`; Z-054 (konwerter TransXChange na GTFS) pozostaje otwarte jako jedyna droga do naprawy Opola. (bez zmian w kodzie; npm run check: nie dotyczy, brak zmian w kodzie)
- Z-050 Domknięcie obserwacji z 2026-11-17: za zgodą właściciela uruchomiono `node tools/build-delays.mjs`. Pole `delays` wróciło do `meta.json` wszystkich 18 miast; Trójmiasto 170 z 187 linii, Poznań 155 z 213, Kraków 87 z 215; pozostałe 15 miast bez pokrycia (GZM i Szczecin — Z-019). Bramka jakości nie zgłasza już zgubionych metadanych. Pliki `delays.json` i rozkłady bez zmian. (pliki: data/<miasto>/meta.json dla 18 miast; testy: bez nowych; npm run check: patrz wynik poniżej; sprawdzone w przeglądarce: stopka Trójmiasta „170 z 187 linii (pomiary do 17.11.2026)"; nie sprawdzone: odczyt stopki przez czytnik ekranu)
- Z-058 Domknięcie: konwersja CRLF na LF objęła pliki z raportu i `tools/check-data.mjs`, który też miał CRLF (pliki: .github/workflows/refresh-data.yml, CLAUDE.md, CURRENT_STATE.md, README.md, tools/build-bridges.mjs, tools/check-data.mjs, tools/geo.mjs, vendor/leaflet/leaflet.css; treść bez zmian). Otwarte: `.claude/agents/*.md` (sześć plików) nadal z CRLF, zostawione, bo zmiany w agentach wymagają wyraźnej prośby właściciela. Wynik `npm run check` poniżej.
- Dosłowny wynik `npm run check` po domknięciach Z-050, Z-052 i Z-058 (2026-11-17):
```
ℹ tests 270
ℹ suites 0
ℹ pass 269
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 500.5958
```
  Lint czysty.
- Powstał agent `liczytokena` (`.claude/agents/liczytokena.md`, wiersz w tabeli i w przepływie pracy w `CLAUDE.md`); pilnuje budżetu tokenów i układa plan fali. Utworzony na wyraźną prośbę właściciela 2026-11-17. (bez zmian w kodzie strony)
- Z-057 Współrzędne przystanku z podpowiedzi liczone z pełną dokładnością (`Float64Array` zamiast `Float32Array`; ok. 28 kB więcej w komunikacie `stops` dla GZM); indeks przystanków trzymany w cache po miastach i dniach, więc przełączenie typu dnia nie buduje go od nowa. Widoczna zmiana to tylko dokładność współrzędnych w adresie i w historii ostatnich punktów. Starsze wpisy w historii zachowują dawną wartość. (pliki: js/uilogic.js, js/app.js; testy: tests/uilogic.test.mjs (zmieniony), tests/stops.test.mjs (nowy); npm run check: wynik dosłowny poniżej, lint czysty; sprawdzone w przeglądarce: „Wrzeszcz PKP" w Trójmieście ustawia 54.38125, 18.60442; nie sprawdzone: podgląd na telefonie, ścieżka `engine=main` w przeglądarce)
- Z-061 Dodano 8 testów ścieżki workera `stops` (`tests/stops.test.mjs`): indeks dla załadowanego i niezaładowanego miasta, zmiana miasta w trakcie budowy, błąd pobrania, cache i limit. Znana luka: strażnik `state.city === city` w `getStopIndex` (`js/app.js`) wymaga DOM i nie jest pokryty testami. (pliki: tests/stops.test.mjs (nowy); npm run check: wynik dosłowny poniżej, lint czysty)
- Z-062 Test dostępności pilnuje wszystkich `<summary>` w `index.html`: każdy musi być w `.sec` albo `.diag`, a żadna reguła `summary` w CSS nie ustawia wysokości innej niż `var(--tap)`. CSS bez zmian. (pliki: tests/a11y-css.test.mjs; npm run check: wynik dosłowny poniżej, lint czysty)
- Dosłowny wynik `npm run check` po Z-057, Z-061 i Z-062 (2026-11-17):
```
ℹ tests 305
ℹ pass 304
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
```
  Lint czysty.
- Dosłowny wynik `npm run check` po domknięciu Z-008 (2026-11-17):
```
ℹ tests 307
ℹ suites 0
ℹ pass 306
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 648.9991
```
  Lint czysty.

## 2026-11-16

### Dodane
- Z-008 Przycisk „Pobierz strefy (GeoJSON)" pod „Kopiuj link do tego widoku" zapisuje aktualne strefy izochron jako plik do QGIS, geojson.io albo własnej mapy; nazwa pliku zawiera miasto i datę. (pliki: js/walkgrid.js, js/worker.js, js/uilogic.js, js/app.js, index.html, css/style.css; testy: tests/walkgrid.test.mjs — 1 nowy; npm run check: lint czysty, 259 testów, 258 pass, 0 fail, 1 skipped (pełny wynik w sekcji Wewnętrzne); nie sprawdzone: otwarcie w QGIS, faktyczne pobranie pliku przez przeglądarkę, wygląd stanu wyłączonego)
- Z-009 Przy pierwszej wizycie strona pokazuje trzy kroki pierwszego użycia z przyciskiem „Rozumiem" i linkiem „Pełna pomoc"; blok znika po „Rozumiem" albo po wskazaniu pierwszego punktu i nie wraca. Nie zasłania paska zgody. (pliki: index.html, css/style.css, js/app.js, js/uilogic.js; testy: tests/uilogic.test.mjs; npm run check: lint czysty, 259 testów, 258 pass, 0 fail, 1 skipped (pełny wynik w sekcji Wewnętrzne); sprawdzone w przeglądarce w czystym profilu, widok 360 px; nie sprawdzone: stopka i przycisk Suppi — poza zakresem tej fali)
- Z-015 Wyszukiwarka adresów pamięta ostatnie punkty: klik w puste pole pokazuje do pięciu ostatnio wybranych punktów bieżącego miasta, a jeden klik ustawia punkt; historię można wyczyścić. Punkt trafia do historii tylko przy wyborze z listy wyników, nie przy kliknięciu w mapę ani przy lokalizacji. (pliki: js/uilogic.js, js/app.js, index.html, css/style.css; testy: tests/uilogic.test.mjs; npm run check: lint czysty, 259 testów, 258 pass, 0 fail, 1 skipped (pełny wynik w sekcji Wewnętrzne); sprawdzone w przeglądarce; nie sprawdzone: zachowanie przy niedostępnym localStorage, wybór z żywych wyników Nominatim)
- Z-022 Strona rozpoznaje polskie święta: w stopce widać datę rozkładu dla wybranego typu dnia, a gdy dziś jest święto albo rozkład pochodzi z innego okresu (np. wakacyjnego), pojawia się wyjaśnienie z możliwością przełączenia na rozkład niedzielny jednym kliknięciem. Domyślna godzina i dzień liczone są w czasie polskim, a nie w strefie przeglądarki. (pliki: js/calendar.js, tools/build-data.mjs, js/app.js, index.html, css/style.css; testy: tests/calendar.test.mjs; nowe pola w meta.json pojawią się po najbliższym odświeżeniu danych)
- Z-017 Widać, skąd bierze się margines w trybie ostrożnym: stopka pokazuje, dla ilu linii są pomiary opóźnień, a przy przełączniku jest wyjaśnienie, czy margines pochodzi z pomiarów, czy z szacunku. (pliki: tools/build-delays.mjs, js/data.js, index.html, js/app.js; testy: tests/build-delays.test.mjs, tests/front-diag.test.mjs; informacja pojawi się po przebiegu kompilacji profili)
- Z-025 Diagnostyka błędów: po awarii panel pokazuje blok „Coś nie zadziałało" z przyciskiem kopiowania raportu, a raport nie zawiera lokalizacji użytkownika ani pełnego adresu. (pliki: js/diag.js, js/data.js, js/worker.js, index.html, js/app.js, css/style.css; testy: tests/diag.test.mjs, tests/front-diag.test.mjs)
- Z-019 (częściowo) Awaria zbierania opóźnień przestała być niewidoczna — przebieg zgłasza przyczynę per miasto i per adres feedu. (pliki: tools/collect-delays.mjs, .github/workflows/collect-delays.yml, README.md; testy: tests/collect-delays.test.mjs; przyczyna braku danych dla GZM i Szczecina nadal nieznana)
- Z-021 Bramka jakości danych: dane z podejrzanym spadkiem (mniej kursów, wzorców, przystanków, linii albo mniejsze pliki niż w poprzednim buildzie) nie trafiają już automatycznie na stronę — takie miasto jest cofane do poprzedniej wersji, pozostałe publikują się normalnie, a workflow zgłasza raport z instrukcją ręcznego przepuszczenia. (pliki: tools/build-data.mjs, tools/check-data.mjs, .github/workflows/refresh-data.yml, README.md, CURRENT_STATE.md; testy: tests/check-data.test.mjs; npm run check: lint czysty, 43/43 testy OK; bramka zadziała od drugiego odświeżenia, bo pierwsze nie ma punktu odniesienia; nie sprawdzone na prawdziwym przebiegu workflow)

- Z-002 (etap 1) Strona da się dodać do ekranu głównego telefonu: ma własny manifest, komplet ikon i kolor paska zgodny z motywem. (pliki: manifest.json, index.html, tools/build-icons.mjs, assets/icon.svg, assets/icon-192.png, assets/icon-512.png, assets/icon-maskable-512.png, assets/apple-touch-icon.png; testy: tests/pwa-manifest.test.mjs (5), tests/build-icons.test.mjs (2); npm run check: lint czysty, 202 testy, 201 pass, 0 fail, 1 skipped; nie sprawdzone: instalowalność na telefonie i na iOS, ścieżki pod github.io/ZTM/)
- Z-002 (etap 2) Przycisk „Wyśrodkuj na mnie" pokazuje Twoją pozycję na mapie bez zmiany punktu startowego, a kółko dokładności mówi, jak pewny jest pomiar; w dymku można ustawić tu punkt startowy. Komunikaty o błędzie lokalizacji są konkretne, poza obszarem strona podpowiada najbliższe miasto, a po przeliczeniu dłuższym niż 1,5 s telefon wibruje raz. Gdy nie ma sieci, strona mówi, że rozkłady wymagają połączenia. (pliki: js/map.js, js/app.js, js/uilogic.js, css/style.css; testy: tests/uilogic.test.mjs, tests/mobile-layout.test.mjs (TAP_USES_MIN 19 -> 21); npm run check: lint czysty, 202 testy, 201 pass, 0 fail, 1 skipped; nie sprawdzone: prawdziwy prompt o zgodę, timeout lokalizacji (kod 3), komunikat offline w przeglądarce, kontrolka na wąskim ekranie, wibracja na urządzeniu)
- Z-045 Czytnik ekranu ogłasza wynik przeliczenia słowami: miasto, zasięg w kilometrach i procentach miasta dla każdego pasma oraz liczbę przystanków; legenda czytana jest pełnymi etykietami („do 10 min", „ponad 60 min"). Dla wzroku nic się nie zmienia. Pięć szybkich zmian godziny daje jeden komunikat. (pliki: index.html, css/style.css, js/app.js, js/uilogic.js; testy: tests/uilogic.test.mjs — 7 nowych; npm run check: lint czysty, 228 testów, 227 pass, 0 fail, 1 skipped; potwierdzone w przeglądarce dla Krakowa; nie sprawdzone: NVDA, VoiceOver, tryb porównania, tryb tylko pieszo, ścieżki błędu w przeglądarce)
- Z-056 Wpisanie nazwy przystanku (od 2 znaków) od razu pokazuje pasujące przystanki, bez zapytania do sieci. Enter dokleja pod spodem adresy z geokodera. Każdy wiersz mówi, czy to przystanek, czy adres. Wybór przystanku ustawia punkt i trafia do historii ostatnich punktów. (pliki: js/uilogic.js, js/engine.js, js/worker.js, js/app.js, css/style.css, README.md; testy: tests/uilogic.test.mjs, tests/search-aria.test.mjs, tests/front-diag.test.mjs (asercja `reportError` podniesiona z 2 do 3); npm run check: lint czysty, 269 testów, 268 pass, 0 fail, 1 skipped (dosłowny wynik w sekcji Wewnętrzne); nie sprawdzone: wygląd oceniony z DOM i stylów, nie ze zrzutu ekranu (kontrast chipa i stan `.active` tylko z CSS), komunikat błędu geokodera na żywo, stan „dane miasta jeszcze się ładują", ścieżka `engine=main` (tylko w kodzie), czas dopasowania na ok. 15 tys. nazw, czytnik ekranu)

### Zmienione
- Z-051 Łódź i Olsztyn pobierają rozkład z działających adresów (stare zwracały 404, przez co cotygodniowe odświeżenie pomijało te miasta od co najmniej 2026-11-09). Gorzów nie zmieniony — jego dane są ważne do 2026-12-30. Opole bez zmian: rozkład kończy się 2026-11-16 (Z-054). Strona nadal pokazuje dane z poprzedniego przeliczenia; nowe pliki pobrano tylko do katalogu tymczasowego. (pliki: data/cities.json, tools/fetch-feeds.mjs; testy: tests/fetch-feeds.test.mjs — 7 nowych; npm run check: lint czysty, 259 testów, 258 pass, 0 fail, 1 skipped; nie sprawdzone: przeliczenie danych z nowych feedów, bramka jakości na nowych feedach)
- Z-030 (wariant A) Panel na telefonie ma gęstsze odstępy — ok. 70 px mniej przewijania, pola dotykowe nadal 44 px. (pliki: css/style.css)
- Z-027 Wyszukiwarki adresów mają pełną semantykę listy podpowiedzi, więc czytnik ekranu ogłasza podświetlony wynik. (pliki: index.html, js/app.js; testy: tests/search-aria.test.mjs)
- Z-042 Komunikat „nie znaleziono" jest pewniej ogłaszany przez czytniki ekranu. (pliki: css/style.css, index.html, js/app.js)
- Z-020 Dostępność: wszystkie kontrolki panelu mają obszar dotyku co najmniej 44x44 px (ikonki nagłówka zostają wizualnie małe), poprawiony kontrast nieaktywnych etykiet i obramowań pól, widoczny obrys fokusu na wszystkich kontrolkach, a przy systemowym ustawieniu „ogranicz ruch" strona i mapa nie animują niczego. Na telefonie pola mają 16 px, żeby iOS Safari nie przybliżał strony. (pliki: css/style.css, js/map.js, js/app.js; testy: tests/a11y-css.test.mjs; npm run check: lint czysty, 43/43 testy OK; nie sprawdzone w przeglądarce: prawdziwa emulacja prefers-reduced-motion, dymek trasy, zachowanie zoomu z klawiatury)
- Z-049 Propozycja przełączenia miasta po użyciu lokalizacji liczy odległość do prostokąta obszaru miasta (nie do jego środka) i obowiązuje w promieniu 15 km. Punkt tuż za granicą dużego obszaru (np. GZM) dostaje propozycję, a punkt bez obszaru miasta nie dostaje już propozycji miasta oddalonego o kilkadziesiąt kilometrów. Zmiana widoczna: propozycja pojawia się w innych miejscach niż wcześniej. (pliki: js/uilogic.js; testy: tests/uilogic.test.mjs; npm run check: lint czysty, 228 testów, 227 pass, 0 fail, 1 skipped; nie sprawdzone w przeglądarce — tylko testy i symulacja siatką)

### Naprawione
- Z-040 Współrzędne klikniętego punktu nie trafiają już do Google Analytics — adres wysyłany do statystyk nie zawiera parametrów. (pliki: index.html; potwierdzone w przeglądarce)
- Z-028 Przyciski powiększania mapy i atrybucja OpenStreetMap nie chowają się już pod panelem na telefonie i trzymają się jego krawędzi niezależnie od wysokości. (pliki: css/style.css, js/app.js, js/map.js; testy: tests/mobile-layout.test.mjs)
- Z-029 Baner zgody nie zasłania już panelu na telefonie — przeniesiony na górę ekranu. (pliki: css/style.css, index.html)
- Z-026 Nazwy przystanków i linii z danych przewoźników są poprawnie escapowane we wszystkich miejscach, także w linkach stopki. (pliki: js/app.js; testy: tests/search-aria.test.mjs)
- Z-050 Stopka znów pokazuje pokrycie profilami opóźnień dla Trójmiasta, Krakowa i Poznania. Ponowne składanie `meta.json` nie kasuje już pola `delays`, a pole znika dopiero wtedy, gdy `delays.json` przestaje istnieć. (pliki: tools/build-lib.mjs, tools/build-data.mjs; testy: tests/build-lib.test.mjs — 3 nowe; npm run check: lint czysty, 228 testów, 227 pass, 0 fail, 1 skipped; nie sprawdzone na prawdziwym buildzie — trzy miasta mają odzyskać pole przy najbliższym odświeżeniu danych)

### Wewnętrzne
- Właściciel zdecydował 2026-11-16, że commit i push po wdrożeniu są autonomiczne, bez pytania (CLAUDE.md §7). Nieodwracalne rzeczy poza kodem (nadpisanie `data/<miasto>/`, usuwanie plików danych, `push --force`, zmiany historii) nadal wymagają zgody. (bez zmian w kodzie)
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
- Z-033 Logika budowania danych (`tools/build-data.mjs`) rozdzielona: czyste funkcje przeniesiono do `tools/build-lib.mjs`, a skrypt zostawił I/O i orkiestrację. Dane wyjściowe bez zmian: na syntetycznym GTFS pliki dni i `meta.json` (poza `generated`) identyczne z poprzednim buildem. (pliki: tools/build-data.mjs, tools/build-lib.mjs; testy: tests/build-lib.test.mjs — 32 nowe; npm run check: lint czysty, 202 testy, 201 pass, 0 fail, 1 skipped; nie sprawdzone: build na prawdziwych danych miast)
- Z-034 Logika frontu (formatowanie czasu, parametry URL, kolejka zapytań, statusy) wydzielona do `js/uilogic.js` i testowana bez przeglądarki. Zachowanie strony bez zmian. (pliki: js/uilogic.js, js/app.js, js/map.js, js/worker.js; testy: tests/uilogic.test.mjs — 36 nowych; npm run check: lint czysty, 202 testy, 201 pass, 0 fail, 1 skipped; sprawdzone w przeglądarce: klik na mapie, zmiana dnia i godziny, dymek trasy, `engine=main`, konsola)
- Z-035 Zweryfikowano w przeglądarce, że po zmianie adresu strony GA4 nie wysyła współrzędnych; kod bez zmian. (pliki: brak zmian; npm run check: nie dotyczy, brak zmian w kodzie; nie sprawdzone: inne wersje gtag.js i przeglądarki poza Chromium)
- Z-031 Próg `outsideShareWarn` bramki jakości podniesiony z 0,02 (2%) do 0,25, bo siedem miast stale przekraczało 2% przez linie podmiejskie wychodzące poza siatkę; nowy `outsideRiseMinStops` 5 chroni przed alarmem przy kilku przystankach. Progi absolutne bez zmian. (pliki: tools/check-data.mjs; testy: tests/check-data.test.mjs — 5 nowych; npm run check: lint czysty, 228 testów, 227 pass, 0 fail, 1 skipped; nie sprawdzone: progi na realnych `counts` i `grid`, Z-053)
- Z-046 Testy `search-aria` i `front-diag` importują funkcje z `js/uilogic.js` zamiast wycinać kod z `js/app.js` wyrażeniem regularnym; `esc` ma przypadki brzegowe (pięć znaków, pusty string, `null`, `undefined`). (pliki: js/uilogic.js, js/app.js, tests/search-aria.test.mjs, tests/front-diag.test.mjs; npm run check: lint czysty, 228 testów, 227 pass, 0 fail, 1 skipped)
- Z-048 Konsola nie zbiera już ostrzeżenia Chrome „Blocked call to navigator.vibrate", gdy pierwsze przeliczenie po wczytaniu strony trwa ponad 1,5 s; brak API `userActivation` nie blokuje wibracji. (pliki: js/uilogic.js, js/app.js; testy: tests/uilogic.test.mjs; npm run check: lint czysty, 228 testów, 227 pass, 0 fail, 1 skipped; nie sprawdzone: czysty dowód z konsoli, wibracja na urządzeniu dotykowym)
- Łącznie po trzeciej fali (2026-11-16): `npm run check`: lint czysty, 202 testy, 201 pass, 0 fail, 1 skipped (test skanujący `data/` tylko z `ZTM_SCAN_DATA=1`).
- Łącznie po czwartej fali (2026-11-16): `npm run check`: lint czysty, 228 testów, 227 pass, 0 fail, 1 skipped (test skanujący `data/` tylko z `ZTM_SCAN_DATA=1`).
- Łącznie po piątej fali (2026-11-16): lint czysty; dosłowny wynik `npm run check` po połączeniu wdrożeń (po cofnięciu zmiany adresu Gorzowa):
```
ℹ tests 259
ℹ suites 0
ℹ pass 258
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 527.329
```
- Z-056 Dosłowny wynik `npm run check` po wdrożeniu wyszukiwania przystanków:
```
ℹ tests 269
ℹ suites 0
ℹ pass 268
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 473.6722
```
- Z-058 Repozytorium ma jedną konwencję końców linii: nowy `.gitattributes` (`* text=auto eol=lf`, wyłączenie dla plików binarnych), a `js/calendar.js`, `js/walkgrid.js` i `tests/a11y-css.test.mjs` przekonwertowane z CRLF na LF bez zmian treści. (pliki: .gitattributes, js/calendar.js, js/walkgrid.js, tests/a11y-css.test.mjs; testy: bez nowych; npm run check: 269 testów, 268 pass, 0 fail, 1 skipped, lint czysty (wynik podany przez wątek główny); nie sprawdzone: checkout na czystym klonie Windows)
