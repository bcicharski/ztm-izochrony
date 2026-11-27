# Zadania do zrobienia

Aktywna kolejka pracy agentów: `w toku`, `zaprojektowane`, `nowe`. Utrzymuje ją wyłącznie agent `kronikarz`.
Zamknięte zadania (`zrobione`, `odrzucone`) i pełne historie skróconych wpisów są w `ZADANIA-ARCHIWUM.md`
— **tego pliku nie czyta się w całości**, tylko `Grep` po identyfikatorze.
Identyfikatory `Z-NNN` są trwałe — numer nigdy nie jest używany ponownie.
Statusy: `nowe` -> `zaprojektowane` -> `w toku` -> `zrobione` -> `odrzucone`.

Stary backlog `zadania.md` to archiwum, tylko do czytania.

## Wskaźniki (aktualizuje kronikarz)

- Najwyższy użyty numer: Z-088 (następne zadanie dostaje Z-089).
- Ostatnia analiza: nieznane (pierwsza fala po migracji ustawi datę i hash commita; `analityk` skanuje przyrostowo od tego commita).

## Kolejność ustalona z właścicielem

Data ustalenia: 2026-11-27 (zastępuje kolejność z 2026-11-24, zachowaną niżej jako historia).
- Praca autonomiczna, w tej kolejności:
  - Z-019 — w toku (część „awaria widoczna" wdrożona; Szczecin wdrożony 2026-11-27; GZM otwarte, bez profili, niewykonalne po naszej stronie).
  - Z-075 — ZROBIONE 2026-11-27 (wpis w „Zrobione").
  - Z-080 — ZROBIONE 2026-11-27 (wpis w „Zrobione").
  - Z-053 — ZROBIONE 2026-11-27 (wpis w „Zrobione"; potwierdzenie bez zmiany kodu).
  - Z-023 — w toku (kontrola spójności wdrożona 2026-11-20; cykliczne odświeżanie kroki 1–6 wdrożone 2026-11-27; zostają krok 7 i pierwsze ręczne uruchomienie).
  - Z-013 — ZROBIONE 2026-11-27 (wpis w „Zrobione"; zakres zawężony do tempa marszu, schody i bezbarierowość poza zakresem).
  - Z-003 — ZROBIONE 2026-11-27 (etap 1 i etap 2 wdrożone; wpis w „Zrobione").
  - Z-037 — ZROBIONE 2026-11-27 (wpis w „Zrobione").
  - Z-082, Z-083, Z-085, Z-086 — ZROBIONE 2026-11-27 (wpisy w „Zrobione”, poza kolejnością).
  - Z-079 — ZROBIONE 2026-11-24 (wpis w „Zrobione"), poza kolejnością.
  - Z-087 — ZROBIONE 2026-11-27 (wpis w „Zrobione"). Z-088 — ZAMKNIĘTE 2026-11-27 jako zamierzone, bez zmiany zachowania (wpis w „Zrobione").
  - Z-007 — ZROBIONE 2026-11-27 (wpis w „Zrobione"; luka 2 wdrożona 2026-11-21, luka 3 odrzucona, luka 1 wdrożona 2026-11-27).
- Wstrzymane (nie pominięte; właściciel wymienił je 2026-11-24 jako ważne w drugiej kolejności, nic tego nie odwołało; w zleceniu z 2026-11-27 ich nie ma):
  - Z-038 — czeka na decyzję właściciela: treść prawna banera zgody, nie wolno jej zmieniać bez jego słowa.
  - Z-009 — czeka na adresy profili społecznościowych od właściciela; bez nich nie ma czego wstawić.
- Poprzednia kolejność (2026-11-24, zastąpiona): Z-079 (zrobione), Z-003, Z-037; następnie Z-013, Z-038, Z-009.

## W toku

### Z-019 [P1] Brakujące profile opóźnień dla GZM i Szczecina
- Status: w toku (część „awaria widoczna" wdrożona; Szczecin wdrożony 2026-11-27; GZM bez profili, niewykonalne po naszej stronie; zadanie otwarte)
- Zgłoszone: 2026-11-16 (analityk)
- Problem: oba miasta mają skonfigurowane źródło rt, ale nie mają danych opóźnień. Diagnoza: config, mapy `routeNames` i próg `MIN_OBS` są poprawne; ścieżka urywa się w `tools/collect-delays.mjs` — kolektor dostaje zero obserwacji przy każdym przebiegu, a błędy HTTP i wyjątki kończyły się cichym ostrzeżeniem przy sukcesie przebiegu, więc awaria była niewidoczna od lipca 2026. Pliki `data/delays/gzm.json` i `szczecin.json` nigdy nie istniały w żadnym commicie.
- Dowód: data/cities.json:300,344; data/delays/ zawiera tylko krakow.json, poznan.json, trojmiasto.json, a rt jest ustawione dla 5 miast.
- Wdrożono część „awaria widoczna" (2026-11-16): klasyfikacja wyniku per URL (`ok`, `http`, `exception`, `undecodable`, `no-entities`, `no-tripupdate`, `no-routeid`, `no-delay`), diagnostyka w logu, tabela werdyktów w podsumowaniu przebiegu, kod wyjścia 1 przy mieście z `rt` i zerem obserwacji; miasta działające dalej zapisują dane. Czerwony status tylko przy uruchomieniu ręcznym i w pierwszej godzinie dnia (cron daje 76 przebiegów dziennie).
- Złagodzenie (świadome, z wcześniejszej fali; doprecyzowane 2026-11-20): przebieg kolektora jest czerwony tylko przy ręcznym uruchomieniu i o 03 UTC (4 z 76 przebiegów dziennie); w pozostałych 72 daje żółtą adnotację, żeby nie zalewać skrzynki. Awaria jest widoczna codziennie. Wcześniejsze zdanie „tylko przy uruchomieniu ręcznym i w pierwszej godzinie dnia" jest nieaktualne.
- Wdrożono 2026-11-20 (część, testowalność; zadanie otwarte): ścieżka pobierania w `tools/collect-delays.mjs` da się testować bez sieci. Wydzielono funkcję zbierającą dane jednego miasta z podstawialnym pobieraniem i dekoderem; nie rzuca wyjątków — błąd pobrania, błąd dekodera i nieznany typ źródła stają się wpisem w wyniku. 7 testów na atrapie, bez sieci (`tests/collect-delays.test.mjs`). Zachowanie przy awarii: miasto bez źródła pomijane (nie błąd); miasto ze źródłem i obserwacjami przechodzi; miasto ze źródłem i zerem obserwacji jest awarią, tak samo jak błąd HTTP, wyjątek, treść niedekodowalna i feed bez użytecznych pól. Kod wyjścia 1, gdy którekolwiek miasto ze źródłem zawiodło; agregaty miast działających zapisują się przed zakończeniem procesu.
- SPROSTOWANIE (2026-11-20): zlecenie zakładało, że awaria kolektora jest cicha i trzeba ją dopiero uczynić głośną. To była nieprawda. Werdykty per miasto, kod wyjścia 1, tabela w podsumowaniu przebiegu, klasyfikacja błędów i zapis działających miast przed ustaleniem kodu wyjścia były już w repozytorium z wcześniejszej fali. Wdrożono tylko brakującą testowalność. Przyczyna pomyłki: zlecenie powstało z opisu zadania w kolejce, bez sprawdzenia bieżącego stanu kodu.
- Przyczyna zerowych obserwacji (pomiar 2026-11-20; ustalona, nie zakładana): oba źródła działają poprawnie. GZM: HTTP 200, `application/x-protobuf`, 107 648 B, dekoduje się jako GTFS-RT, 1175 encji, wszystkie z aktualizacją kursu. Szczecin: HTTP 200, `application/octet-stream`, 92 343 B, dekoduje się poprawnie, 900 encji, wszystkie z aktualizacją kursu. W żadnej encji nie występuje identyfikator linii (0 z 1175 i 0 z 900); jest wyłącznie identyfikator kursu (GZM np. `1_7298305`, Szczecin np. `436853_POWS`). Opóźnienia w feedach są (aktualizacje przystankowe). Kolektor odrzuca encje bez identyfikatora linii, stąd zero obserwacji. To nie awaria źródła ani zły adres: założenie kolektora nie pasuje do tego, co wystawiają przewoźnicy.
- Pozostaje (wymaga decyzji właściciela): wyznaczanie linii z identyfikatora kursu przez `trips.txt`. Wymaga mapy „kurs na linię" w danych miejskich, czyli zmiany formatu danych i prawdopodobnie przeliczenia miast; nie wykonano. Niesprawdzone: czy identyfikatory kursów z feedów pasują do `trips.txt` w `data/gzm` i `data/szczecin`; trzeba to zmierzyć, zanim powstanie projekt. Werdykt pierwszego przebiegu kolektora w GitHub Actions: nieznane (workflow nie był uruchamiany; prawdziwy przebieg nie był odpalany, bo zapisałby do `data/delays/`).
- Nowe zadanie powstałe przy Z-019: Z-079 (uszkodzony agregat jednego miasta przerywa przebieg kolektora).
- Pomiar 2026-11-27 (identyfikatory kursów; wynik ustalony, zadanie zostaje otwarte):
  - Szczecin: naprawialny. 837 z 837 identyfikatorów kursów z feedu czasu rzeczywistego ma dopasowanie w publikowanym rozkładzie (100%, 62 linie). Identyfikator nie jest dzienny i jest stabilny w obrębie wersji rozkładu.
  - GZM: niewykonalny po naszej stronie. 0 z 1020. Identyfikatory w feedzie to liczby od 6,5 do 7,5 mln, w publikowanym rozkładzie tego przewoźnika do 2,1 mln: inna przestrzeń identyfikatorów, bez klucza łączącego. Sprawdzono też pliki rozszerzone i feed pozycji pojazdów. Opóźnienia w feedzie są prawdziwe (od −180 do 2220 s, mediana 60), ale nie da się ich przypisać do linii. Naprawa wymagałaby dodania identyfikatora linii przez przewoźnika.
  - Ustalenie wspólne: identyfikator kursu nie przeżywa prekompilacji (`data/<miasto>/` go nie zawiera), więc mapa „kurs → linia" musi powstawać w kolektorze, a nie w danych miejskich. Rozmiar takiej mapy dla Szczecina: 283 kB jako JSON, 36,6 kB po kompresji. Nie trafia do przeglądarki; używa jej wyłącznie kolektor.
  - SPROSTOWANIE (2026-11-27): to ustalenie unieważnia wcześniejsze założenie zadania, że naprawa wymaga zmiany formatu danych i przeliczenia miast.
  - Wdrożono 2026-11-27 (Szczecin, Z-019): kolektor buduje mapę „kurs → linia" z publikowanego rozkładu i przez nią wyznacza linię dla feedu bez identyfikatora linii. Mapa w pamięci podręcznej na gałęzi kolektora, poza katalogiem kopiowanym na stronę. Nagłówki rozkładu sprawdzane co 6 h; treść ściągana ponownie tylko przy zmianie sygnatury albo gdy mapa ma ponad tydzień. Kurs bez wpisu pomijany; ponad 20% braków wymusza przebudowę (co najwyżej raz na 2 h). Zmierzone na żywym feedzie: 831 obserwacji z mechanizmem, 0 bez; 62 linie. Testy: 28 nowych, tests/trip-map.test.mjs. Nie sprawdzone: workflow na GitHubie (odtwarzanie i zapis pamięci podręcznej mapy).
  - Pozostaje: (a) GZM bez profili opóźnień — feed nie podaje linii, identyfikatory kursów nie pasują do rozkładu; naprawa wymaga identyfikatora linii od przewoźnika; zadanie zostaje otwarte.
  - Rozstrzygnięte 2026-11-27 (b): GZM bez linii i bez mapy dostaje w raporcie werdykt „ograniczenie feedu" i nie wywraca przebiegu (kod wyjścia 0). Nie jest to wyciszenie: błędy pobrania, wyjątki, treść niedekodowalna i brak encji nadal dają awarię. Gdy przewoźnik doda identyfikator linii, GZM wraca do normalnego działania (pokrywa to test).
- Pliki: data/delays/, tools/collect-delays.mjs, tools/trip-map.mjs, data/cities.json, .github/workflows/collect-delays.yml, README.md, tests/collect-delays.test.mjs, tests/trip-map.test.mjs.

### Z-051 [P1] Rozkład Opola kończy się 2026-11-16
- Status: w toku
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: rozkład Opola kończy się dziś. To nie błąd kodu — feed przewoźnika wymaga odświeżenia albo trzeba znaleźć nowe źródło. Wymaga działania poza repozytorium.
- Dowód: `node tools/check-data.mjs` (2026-11-16) zgłasza „rozkład kończy się za mniej niż 7 dni (16.11.2026)"; build z 2026-11-02.
- Wdrożone 2026-11-16 (częściowo): cztery miasta (lodz, opole, olsztyn, gorzow) miały feed na `cdn.zbiorkom.live/gtfs/*.zip`; wszystkie cztery adresy zwracają 404 (strona HTML zamiast ZIP), host odpowiada, padła ścieżka. Cotygodniowe `refresh-data.yml` pomijało te miasta od co najmniej 2026-11-09; ostrzeżenie było tylko `::warning::` i wpisem z etykietą „dane". Zmienione adresy: Łódź (`https://otwarte.miasto.lodz.pl/wp-content/uploads/2025/06/GTFS.zip`, ZDiT Łódź), Olsztyn (`https://zdzit.olsztyn.eu/gtfs/` z `resolve: "html-latest"`, ZDZiT Olsztyn). Gorzów COFNIĘTY, nie podmieniony: `data/gorzow/meta.json` (build 2026-11-02) ma `feedEndDate` 2026-12-30, a feed mkuran.pl kończy się 2026-10-23, więc podmiana zamieniłaby ważne dane na ostrzeżenie. Adres `mzk-gorzow` wraca do `https://cdn.zbiorkom.live/gtfs/gorzow.zip` i jest martwy świadomie — cotygodniowe odświeżenie pomija Gorzów i zostawia dobre dane. `tools/fetch-feeds.mjs`: pętla główna w `main()` za strażnikiem `isMain`, nowa czysta funkcja `pickLatestZip` i tryb `resolve: "html-latest"` (najnowsze `.zip` z listingu po dacie z tekstu linku; wygrywa największa data <= dziś; brak linków = wyjątek z nazwą feedu). Dane w `data/<miasto>/` nietknięte; pobrania tylko do katalogu tymczasowego.
- Wdrożone 2026-11-17 (ręczne przeliczenie za zgodą właściciela): Łódź i Olsztyn przeszły pierwsze pełne przeliczenie z nowych źródeł (`tools/fetch-feeds.mjs`, `tools/build-data.mjs`); bramka jakości (`tools/check-data.mjs`) przepuściła oba miasta bez problemów. Zadanie zostaje otwarte dla Opola.
- Pozostaje: Opole zamknięte w Z-054 (zrobione 2026-11-17; Opole nie jest już otwartą częścią tego zadania); Gorzów -> Z-055 (termin przeglądu przed 2026-12-30).
- Decyzja właściciela (2026-11-17): Opole zostaje widoczne na stronie ze starymi danymi i z ostrzeżeniem o nieaktualnym rozkładzie. Wariant „czasowo ukryć miasto" odrzucony. Zweryfikowano w przeglądarce 2026-11-17 (`?city=opole`): `meta.feedEndDate` 2026-11-16, `#dataWarn` widoczny z `role="alert"`, treść: „Uwaga: rozkład tego miasta jest nieaktualny (ważny do 16.11.2026). Wyniki mogą odbiegać od dzisiejszych kursów.", stopka: rozkład z 03.11.2026, ważny do 16.11.2026; blok 88 px wysokości mieści się w pierwszym ekranie panelu. Zmiana kodu nie była potrzebna. Niezweryfikowane: wygląd na prawdziwym telefonie, odczyt przez czytnik ekranu.
- Ryzyka: Łódź — jeśli przy kolejnym wgraniu powstanie nowa ścieżka zamiast nadpisania, przełączyć na `resolve: "html-latest"` z `https://otwarte.miasto.lodz.pl/transport_komunikacja/`. Olsztyn — okno obowiązywania kończy się 2026-11-30; jeśli ZDZiT nie opublikuje pliku grudniowego na czas, `feedEndDate` w `check-data.mjs` to wyłapie. Pierwsze przeliczenie Łodzi i Gorzowa może obudzić bramkę regresji (inny namespace identyfikatorów); URL-e w stanie strony to współrzędne, więc zapisane linki użytkowników się nie psują.
- Pliki: data/cities.json, tools/fetch-feeds.mjs, tests/fetch-feeds.test.mjs.
- Niezweryfikowane: poprawność rozkładów Łodzi i Olsztyna względem terenu; przełączniki środków transportu w obu miastach; tryb porównania i tryb ostrożny na nowych danych; zachowanie przy następnym automatycznym odświeżeniu.

### Z-009 [P2] Stopka i onboarding
- Status: w toku
- Zgłoszone: 2026-11-16 (analityk)
- Problem: z pierwotnego zakresu zostało jedno — odnośniki do profili społecznościowych w stopce. **Czeka na dane od właściciela**: adresów profili nie ma nigdzie w repozytorium, więc nie zaczynać tego zadania bez nich. (Stan sprawdzony w kodzie 2026-11-17; zrobione części opisano niżej.)
- Dowód: nieznane.
- Wdrożone 2026-11-16 (część D, wskazówka przy pierwszej wizycie): blok z trzema krokami, przyciskiem „Rozumiem" i linkiem „Pełna pomoc" w panelu, wariant niemodalny (`showModal()` odrzucone, bo czyniłoby pasek zgody `#consentBar` nieklikalnym). Znika po „Rozumiem" albo po pierwszym wskazaniu punktu i nie wraca. Warunek `shouldShowIntro({ seen, consentPending, pointFromUrl })` w `js/uilogic.js`; klucz `seen-intro`; brak pamięci = wskazówka wraca przy każdej wizycie, ale znika po pierwszej interakcji. Zmierzone: 155 px wysokości przy 800 px szerokości, 138 px przy 360 px.
- Zrobione poza częścią D: kontakt w stopce już istniał (`index.html`, `mailto:Bartosz@excelninja.pro`); przycisk wsparcia zrobiono w Z-065 (ikona ☕ w nagłówku panelu, widoczna także przy zwiniętym panelu; pełny link „Podoba się? Postaw kawę" w sekcji „Dane i kontakt"; zarzut „za nisko" nieaktualny); samouczek w trzech krokach to część D tego zadania (wskazówka przy pierwszej wizycie, wyżej).
- Pozostaje: odnośniki do profili społecznościowych w stopce — **czeka na dane od właściciela** (adresy profili). Nie zaczynać bez nich.
- Pliki: index.html, css/style.css, js/app.js, js/uilogic.js.
- Niezweryfikowane: nieznane.

### Z-015 [P2] Udostępnianie i wyszukiwarka
- Status: w toku
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak krótkich linków, dynamicznego obrazka OG, iframe, wyszukiwania po nazwie przystanku offline i historii adresów.
- Dowód: statyczny obrazek OG istnieje — `assets/og-image.png` w repozytorium od commitu d837462, `index.html` wskazuje go w `og:image` (sprawdzone 2026-11-17).
- Wdrożone 2026-11-16 (część A, historia ostatnich punktów): klik w puste pole adresu pokazuje do pięciu ostatnio wybranych punktów bieżącego miasta; jeden klik ustawia punkt; ostatnia pozycja czyści historię. Wpis powstaje tylko przy wyborze z listy wyników (nie przy kliknięciu w mapę, przeciągnięciu znacznika, GPS ani punkcie z URL). 12 wpisów globalnie, 5 pokazywanych po filtrze na miasto, deduplikacja po współrzędnych zaokrąglonych do 5 miejsc, wygasanie po 90 dniach, klucz `recent-points`, kształt `{v:1, items:[...]}`, `localStorage` w `try/catch`. Pamięć funkcjonalna, nie analityczna — zdanie o tym jest w pomocy. ARIA: nagłówek grupy jako `li[role=presentation]` pomijany strzałkami, wiersze `role="option"`.
- Pozostaje (stan 2026-11-17):
  - Statyczny obrazek OG: ZROBIONY, nie jest już do zrobienia (`assets/og-image.png`, `og:image` w `index.html`).
  - Dynamiczny obrazek OG (inny dla każdego miasta albo widoku): NIEWYKONALNY w obecnej architekturze. Wymagałby generowania po stronie serwera, a projekt ma nienegocjowalny zakaz backendu; wykonanie wymaga zmiany zasad projektu.
  - Krótkie linki: NIEWYKONALNE w obecnej architekturze bez zewnętrznej usługi przekierowań, która też wychodzi poza „zero backendu" (ustalenie `liczytokena`).
  - Iframe: da się zrobić statycznie, ale to nowy sposób użycia strony; wymaga zgody właściciela (ustalenie `liczytokena`).
  - Część B (wyszukiwanie przystanków po nazwie) zrobiona jako Z-056.
- Pliki: js/uilogic.js, js/app.js, index.html, css/style.css.
- Niezweryfikowane: zachowanie przy niedostępnym `localStorage` (kod w `try/catch`, nie wymuszano); wybór z żywych wyników Nominatim.

### Z-023 [P2] Odświeżanie danych OSM
- Status: w toku (kroki 1–6 wdrożone 2026-11-27; krok 7 i pierwsze ręczne uruchomienie workflow przed nami)
- Zgłoszone: 2026-11-16 (analityk)
- Problem: walknet.json, water.json, bridges.json i gridBbox nie miały cyklicznego odświeżania; dane OSM miały 123–129 dni.
- Dowód: żaden workflow nie wywoływał build-walknet, build-water ani build-bridges (stan 2026-11-16); `git log` dla `data/gzm/walknet.json` (2026-07-20).
- Wdrożone: kontrola spójności 2026-11-20 (`tools/check-osm.mjs`, krok CI); cotygodniowe odświeżenie OSM w `refresh-data.yml` 2026-11-27 — najwyżej trzy miasta na przebieg wg wieku danych, najwyżej jedno duże; bramka `tools/check-osm-diff.mjs` tylko raportuje; cofanie całego miasta przy niezaliczonej bramce; stan w `data/osm-state.json`. Szczegóły: CHANGELOG, sekcja 2026-11-27.
- Pozostaje: (7) przełączenie bramki porównawczej w tryb blokujący po 2–3 obserwowanych przebiegach; (8) pierwsze ręczne uruchomienie na jednym małym mieście z pominięciem przeliczenia rozkładów. Niezweryfikowane: workflow na GitHubie nie był uruchamiany.
- Pokrewne: Z-086 (wejście `force` niezadeklarowane w workflow).
- Pliki: tools/osm-rotate.mjs, tools/osm-state.mjs, tools/check-osm-diff.mjs, tools/check-osm.mjs, tools/geo.mjs, tools/walknet-ab.mjs, .github/workflows/refresh-data.yml; `data/<miasto>/` nietknięte.
- Jak sprawdzić: ręczny przebieg workflow na jednym małym mieście (krok 8); po 2–3 przebiegach ocena bramki porównawczej (krok 7).
- Pełna historia: ZADANIA-ARCHIWUM.md, „Historia wpisów skróconych w kolejce" (Z-023, 2026-11-27).

## Zaprojektowane (gotowe do wdrożenia)

## Nowe (bez projektu rozwiązania)

### Z-014 [P2] Funkcje analityczne i produktowe
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak dostępności adresu z POI/GUS, mapy cieplnej, osi czasu z animacją, porównania przed/po oraz kolejnych miast i kolei regionalnych.
- Dowód: nieznane.
- Pliki: nieznane.

### Z-016 [P2] Wielojęzyczność, ARIA stref, płynne przejścia i wysoki kontrast stref
- Status: nowe
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak wielojęzyczności, opisów ARIA dla stref, płynnych przejść i wariantu wysokiego kontrastu stref.
- Dowód: stan sprawdzony 2026-11-21 — wielojęzyczność: `index.html:2` ma `lang="pl"`, nie ma mechanizmu wyboru języka; ARIA stref: etykiety są tylko w legendzie (`js/app.js:838`), warstwa stref na mapie nie ma opisu; wysoki kontrast: brak `prefers-contrast` w css/style.css; płynne przejścia: istnieje obsługa `prefers-reduced-motion` (`css/style.css:1415`), zakres „płynnych przejść" w opisie nie jest zdefiniowany.
- Tryb ciemny (2026-11-21): zrobiony w Z-044, patrz wpis Z-044 w sekcji „Zrobione". Mapa i kolory pasm świadomie zostały jasne. „Wariant wysokiego kontrastu stref" z tego zadania to nadal otwarta, osobna sprawa; nie jest tym samym co tryb ciemny.
- Pliki: css/style.css, index.html, js/app.js.

### Z-038 [P2] Skrócony tekst banera zgody (decyzja właściciela)
- Status: nowe
- Zgłoszone: nieznane
- Problem: obecny tekst: „Strona korzysta z Google Analytics (anonimowe statystyki) oraz reklam Google — pliki cookie zapisywane tylko po zgodzie." Propozycja: „Używamy cookies Google (statystyki, reklamy) — tylko po zgodzie." Skróciłoby baner na telefonie ze 129 do ok. 105 px. To treść prawna, więc decyzja należy do właściciela.
- Dowód: nieznane.
- Przegląd (2026-11-17): tekst banera zależy od decyzji o AdSense (Z-064); jeśli reklamy znikną, zdanie o reklamach przestaje być prawdziwe. Wymaga przeglądu przez właściciela.
- Z-064 (2026-11-17): częściowo wykonane — zdanie o reklamach znikło z banera, który jest krótszy o ten człon. Nowa treść dosłownie: „Strona korzysta z Google Analytics (anonimowe statystyki) — pliki cookie zapisywane tylko po zgodzie." Propozycja z tego wpisu nie została przyjęta dosłownie. Nie zamknięte.
- Pliki: index.html.

### Z-055 [P1] Gorzów: żywe źródło rozkładu po 2026-12-30
- Status: nowe
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: dane Gorzowa z builda 2026-11-02 (`data/gorzow/meta.json`, `feedEndDate` 20261230) są ważne jeszcze ok. sześć tygodni. Feed mkuran.pl (`gorzow_wlkp.zip`, zakres 20261001-20261023) jest wygasły, więc nie zastępuje danych; adres `mzk-gorzow` jest świadomie martwy, żeby cotygodniowe odświeżenie zostawiało dobre dane. Jedyne żywe i oficjalne źródło (BIP MZK) wystawia rozkład w oknach siedmiodniowych, więc build z niego byłby aktualny najwyżej przez tydzień. Termin przeglądu: przed 2026-12-30.
- Dowód: pobranie z `https://bip.mzk-gorzow.com.pl/gtfs.html` 2026-11-16: HTTP 200, 1,22 MB, poprawny ZIP z `shapes` i `transfers`; `feed_info.txt` 20261103-20261110; `calendar.txt` i 18122 wiersze `calendar_dates.txt` w tym samym oknie. `cdn.zbiorkom.live` i `api.zbiorkom.live` zwracają 404; strona główna zbiorkom to SPA bez linków do danych. Gorzowa nie ma na dane.gov.pl ani w sekcji dla deweloperów na stronie MZK.
- Kierunki do rozważenia: częstsze odświeżanie tylko dla Gorzowa; sklejanie kolejnych tygodniowych paczek w dłuższy kalendarz; kontakt z MZK o dłuższy feed. Uwaga (2026-11-17): rejestr formatów w `tools/fetch-feeds.mjs` i tryb `resolve: "html-latest"` są już dostępne (Z-054, Z-051), więc wpięcie BIP MZK będzie tańsze niż zakładano.
- Wymagane rozszerzenie, gdyby wpinać BIP: `pickLatestZip` dziś tam nie trafi (tekst linku „GTFS MZK Gorzów Wlkp." bez daty, data w href w formacie `DD-MM-RRRR`). Potrzebna gałąź: gdy żadna data się nie parsuje, a na stronie jest dokładnie jeden link `.zip`, wziąć ten link; opcjonalnie rozpoznawanie `DD-MM-RRRR`. Bez nowego trybu i bez nowego pola w `cities.json`. Credits, gdyby doszło do wpięcia: `{ "label": "MZK Gorzów Wlkp. (BIP)", "url": "https://bip.mzk-gorzow.com.pl/gtfs.html" }`.
- Pomiar na żywych źródłach (2026-11-23):
  - `cdn.zbiorkom.live` — nadal 404.
  - `mkuran.pl` — plik się pobiera (HTTP 200, 995 KB), ale `feed_info.txt` ma `20261001,20261023`, czyli rozkład skończył się miesiąc temu. Bez zmian wobec poprzedniego sprawdzenia.
  - BIP MZK — strona działa, ale wystawia tę samą paczkę co 16 listopada: okno 3–10 listopada, nazwa pliku `85_gtfs03-11-202610-11-202603112026071127.zip`. MZK nie opublikował nowego rozkładu od co najmniej trzech tygodni.
  - SPROSTOWANIE założenia: poprzedni opis mówił, że BIP publikuje w oknach siedmiodniowych, więc build z niego byłby aktualny najwyżej przez tydzień. Pomiar pokazuje coś gorszego: publikacja nie jest cykliczna, a obecnie wystawiony rozkład jest już wygasły. Build z BIP wykonany dziś dałby dane starsze od tych, które mamy.
  - Wpięcie BIP jest teraz bezpieczne dzięki zabezpieczeniu z Z-081: próba podmiany na starszy rozkład skończy się blokadą, a nie cichym cofnięciem danych.
  - Martwy adres `mzk-gorzow` w `cities.json` zostaje jako prowizoryczna zapora; zdejmiemy go dopiero przy wpinaniu nowego źródła.
  - Właściciel dostał 2026-11-23 gotowy draft pisma do MZK z prośbą o paczkę obejmującą dłuższy okres albo o stały adres najnowszego pliku. Pismo NIE zostało wysłane; decyzja i wysyłka należą do właściciela.
- Pliki: data/cities.json, tools/fetch-feeds.mjs (gałąź BIP, jeśli wpinane), tests/fetch-feeds.test.mjs.

### Z-084 [P3] Święto wypadające w sobotę nie przełącza rozkładu na niedzielny
- Status: nowe
- Zgłoszone: 2026-11-27 (nieznane)
- Problem: po wdrożeniu Z-037 święto w dzień roboczy przełącza rozkład na niedzielny, ale święto wypadające w sobotę zostaje sobotą. To zachowanie sprzed zmiany, nierozstrzygnięte. Do ustalenia: czy w sobotnie święto komunikacja jedzie rozkładem sobotnim czy niedzielnym. To pytanie o teren, nie o kod, i prawdopodobnie odpowiedź zależy od miasta.
- Dowód: znalezione przy Z-037. Numer linii: nieznany.
- Pliki: js/uilogic.js.

