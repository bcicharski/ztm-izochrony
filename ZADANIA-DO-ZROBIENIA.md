# Zadania do zrobienia

Aktywna kolejka pracy agentów: `w toku`, `zaprojektowane`, `nowe`. Utrzymuje ją wyłącznie agent `kronikarz`.
Zamknięte zadania (`zrobione`, `odrzucone`) i pełne historie skróconych wpisów są w `ZADANIA-ARCHIWUM.md`
— **tego pliku nie czyta się w całości**, tylko `Grep` po identyfikatorze.
Identyfikatory `Z-NNN` są trwałe — numer nigdy nie jest używany ponownie.
Statusy: `nowe` -> `zaprojektowane` -> `w toku` -> `zrobione` -> `odrzucone`.

Stary backlog `zadania.md` to archiwum, tylko do czytania.

## Wskaźniki (aktualizuje kronikarz)

- Najwyższy użyty numer: Z-085 (następne zadanie dostaje Z-086).
- Ostatnia analiza: nieznane (pierwsza fala po migracji ustawi datę i hash commita; `analityk` skanuje przyrostowo od tego commita).

## Kolejność ustalona z właścicielem

Data ustalenia: 2026-11-27 (zastępuje kolejność z 2026-11-24, zachowaną niżej jako historia).
- Praca autonomiczna, w tej kolejności:
  - Z-019 — w toku (część „awaria widoczna" wdrożona; Szczecin wdrożony 2026-11-27; GZM otwarte, bez profili, niewykonalne po naszej stronie).
  - Z-075 — ZROBIONE 2026-11-27 (wpis w „Zrobione").
  - Z-080 — ZROBIONE 2026-11-27 (wpis w „Zrobione").
  - Z-053 — ZROBIONE 2026-11-27 (wpis w „Zrobione"; potwierdzenie bez zmiany kodu).
  - Z-023 — w toku (kontrola spójności danych OSM wdrożona 2026-11-20; cykliczne odświeżanie czeka na zgodę właściciela).
  - Z-013 — ZROBIONE 2026-11-27 (wpis w „Zrobione"; zakres zawężony do tempa marszu, schody i bezbarierowość poza zakresem).
  - Z-003 — ZROBIONE 2026-11-27 (etap 1 i etap 2 wdrożone; wpis w „Zrobione").
  - Z-037 — ZROBIONE 2026-11-27 (wpis w „Zrobione").
  - Z-079 — ZROBIONE 2026-11-24 (wpis w „Zrobione"), poza kolejnością.
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
- Status: w toku
- Zgłoszone: 2026-11-16 (analityk)
- Problem: walknet.json, water.json, bridges.json i gridBbox nie mają cyklicznego odświeżania ani kontroli spójności.
- Dowód: żaden workflow nie wywołuje build-walknet, build-water ani build-bridges. Dane OSM mają datę modyfikacji z lipca 2026 (17 miast, 123–129 dni przed 2026-11-20; potwierdzone `git log` dla `data/gzm/walknet.json`, 2026-07-20); 2026-09-18 (63 dni) dotyczy tylko Trójmiasta. Wcześniejsza data 2026-09-18 z tego opisu była błędna, bo wzięta z `ls` jednego miasta.
- Wdrożone 2026-11-20 (część): kontrola spójności danych OSM, bez zmiany danych. Narzędzie `node tools/check-osm.mjs [miasto ...] [--stats] [--ignore-warnings]` sprawdza `walknet.json`, `water.json` i `bridges.json` w każdym mieście i wykrywa plik uszkodzony, pusty albo niespójny z `gridBbox`. Krok „Kontrola danych OSM" w CI, na końcu joba `check`, z `if: always()` i `--ignore-warnings`. Ograniczenie: w CI wiek plików liczony z daty modyfikacji po checkoutcie pokazuje ok. zero dni, więc tam działa tylko kontrola spójności; prawdziwy wiek pokazuje uruchomienie lokalne.
  - Progi ustalone pomiarem na 18 miastach 2026-11-20 (`--stats` drukuje tabelę ponownie). Format: wielkość — min / mediana / max — najgorsze miasto.
    - węzły grafu — 21 765 / 75 853 / 425 081 — gorzow najmniej, gzm najwięcej
    - krawędzie grafu — 31 169 / 107 748 / 604 894 — gorzow najmniej
    - węzły w `gridBbox` — 98,9% / 99,7% / 99,8% — opole najgorsze
    - pokrycie bboxa (siatka 10x10) — 76% / 100% / 100% — trojmiasto najgorsze (morze)
    - rozpiętość grafu do bboxa (mniejsza oś) — 1,065 / 1,147 / 1,300 — warszawa najgorsza
    - największa spójna składowa — 94,7% / 97,4% / 98,8% — torun najgorszy
    - woda: punkty w `gridBbox` — 31,4% / 82,6% / 93,8% — zielonagora najgorsza
    - mosty: punkty w `gridBbox` — 99,4% / 100% / 100% — gorzow najgorszy
  - Progi (BŁĄD, chyba że napisano inaczej): węzły w bboxie < 90%; pokrycie siatki < 50%; rozpiętość < 0,9 bboxa; największa składowa < 85% — OSTRZEŻENIE, nie błąd; mosty w bboxie < 95%; woda w bboxie < 10% (rozkład szeroki, rzeki wystają daleko za bbox).
  - Asercje (identyczny wynik we wszystkich 18 miastach): trzy pliki obecne; zero NaN; zero współrzędnych poza 48,9–55,0 N, 14,0–24,2 E; zero krawędzi z indeksem poza zakresem; zero węzłów izolowanych; poligon wody ≥ 4 punkty, linia wody lub mostu ≥ 2 punkty; ≥ 1 poligon wody i ≥ 1 linia mostu; węzły i krawędzie > 0.
  - Świadomie NIE kontrolowane: krawędzie zerowej długości (1–262 na miasto) i pętle `a == b` (70–1512 na miasto) — cecha kontrakcji grafu, nie wada.
- Pozostaje: cykliczne odświeżanie danych OSM (workflow z `build-walknet`, `build-water`, `build-bridges`). Nadpisuje `data/<miasto>/`, więc wymaga zgody właściciela. Dane mają 123–129 dni (Trójmiasto 63).
- Podpunkt (2026-11-27; status bez zmian): pozostała część zadania to automat cyklicznie przeliczający dane OSM (graf pieszy, woda, mosty). Do rozstrzygnięcia przed wdrożeniem:
  - częstotliwość: dane OSM zmieniają się wolno, a pełne przeliczenie 18 miast to godziny pobierania z Overpassa;
  - bramka: kontroler spójności z pierwszej części tego zadania (`node tools/check-osm.mjs`) już istnieje i sprawdza dokładnie te trzy pliki; automat ma się na nim opierać;
  - odporność na częściową awarię: nie nadpisać dobrych danych gorszymi przy awarii źródła. Dzisiejsza przebudowa wody pokazała, że Overpass zwraca błąd 502 dla pojedynczych miast, a przy powtórzeniu przechodzi;
  - zakres przebiegu: wszystkie miasta naraz czy po kilka na przebieg.
  - Automat musi uwzględnić zmiany z dziś: graf pieszy zapisuje nowy, oszczędniejszy format (Z-003, etap 2); narzędzie budujące wodę stosuje margines 2 km z przycięciem (Z-075).

## Zaprojektowane (gotowe do wdrożenia)

## Nowe (bez projektu rozwiązania)

### Z-007 [P2] Znane luki modelu
- Status: nowe (częściowo zrobione: luka 2 wdrożona 2026-11-21; luka 3 ODRZUCONA 2026-11-27; luka 1 ZATWIERDZONA 2026-11-27, bez projektu; zadanie NIE jest zamknięte — jedyny otwarty punkt: luka 1)
- Decyzja: ZATWIERDZONE do wdrożenia 2026-11-20 z zastrzeżeniem terminu — patrz „Decyzja właściciela (2026-11-20)" niżej. Luka 2 ma gotowy projekt; wdrożenie zmienia obraz izochrony i statystykę „% powierzchni" w Warszawie i Krakowie, czyli rdzeń produktu. Luki 1 i 3 bez projektu.
- Zgłoszone: 2026-11-16 (analityk)
- Problem: trzy luki — (1) stacje kolejowe 150-400 m od przystanku naziemnego niedostępne jako przesiadka w trybie bez spaceru (COMPLEX_MAX_M; Kraków SKA, 17 stacji); (2) dalekie przystanki poza gridBbox rysowane kołami 1 km bez bariery wody za krawędzią siatki (poprawione 2026-11-20, patrz niżej); (3) graf pieszy bez tagów krawędzi (schody, deptaki, foot=no dla roweru).
- Decyzja właściciela (2026-11-20): WDROŻYĆ, ale nie teraz. Projekt „nasiona na brzegu siatki" (luka 2, niżej) zatwierdzony do wdrożenia, z zastrzeżeniem terminu: nie w bieżącym limicie tygodniowym. Wykonać w całości przy pełnym limicie tygodniowym, nigdy w połowie.
  - Powód tego warunku (sedno): samo obcięcie promienia koła, bez zasiewania krawędzi siatki, ZABIERA pokrycie i nic nie daje w zamian — byłoby gorzej niż stan obecny. Obie części (obcięcie promienia i zasiewanie brzegu) muszą wejść razem.
  - Właściciel przyjął do wiadomości konsekwencje: widoczna zmiana obrazu izochrony na obrzeżach Warszawy i Krakowa oraz wzrost statystyki „% powierzchni".
- Wdrożono 2026-11-21 (tylko luka 2, „nasiona na brzegu siatki"; wpis w CHANGELOG.md, sekcja 2026-11-21): przystanki do 1 km za krawędzią `gridBbox` zasiewają brzeg siatki zamiast płaskiego koła na wierzchu wyniku; dalej liczy fala po lądzie (woda, mosty, sieć ulic); koło przystanku obcięte do odległości od siatki; dalsze przystanki bez zmian. Testy: 19 nowych, `npm run check`: tests 511, pass 510, fail 0, skipped 1, lint czysty.
- ZMIERZONY EFEKT (2026-11-21), ODBIEGA OD OCZEKIWANIA: statystyka „% powierzchni" NIE wzrosła. Zmiana wynosi 0,000 punktu procentowego w każdym z sześciu pasm, we wszystkich siedmiu sprawdzonych trybach. Przyczyna ustalona: żaden przystanek z pierścienia (Warszawa 52, Kraków 38, Olsztyn 7, Opole 4) nie ma w promieniu 1 km ani jednego piksela maski granic miasta; poprawione piksele leżą poza maską, której statystyka używa. Zmiana jest widoczna na mapie, nie w liczbie. Wzrost statystyki założony w projekcie i w decyzji właściciela (2026-11-20) nie wystąpił.
- Decyzja właściciela (2026-11-27), rozstrzygnięcie dwóch z trzech luk:
  - Luka 1 (stacje kolejowe 150–400 m od przystanku naziemnego, niedostępne jako przesiadka w trybie bez spaceru; 17 stacji, głównie Kraków SKA): ZATWIERDZONA do wdrożenia. Wymaga przeliczenia danych miast. Projekt jeszcze nie powstał.
  - Luka 3 (graf pieszy bez tagów krawędzi: schody, deptaki, zakaz ruchu pieszego): ODRZUCONA. Świadoma rezygnacja, nie odłożenie na później.
  - Luka 2: wdrożona 2026-11-21 (patrz wyżej).
  - Po tej decyzji z zadania pozostaje jeden otwarty punkt: luka 1. Zadanie zostaje otwarte do jej wdrożenia.
- Pozostaje otwarte (bez projektu): luka 1 (stacje kolejowe 150–400 m od przystanku naziemnego niedostępne jako przesiadka w trybie bez spaceru) — NIE ruszana; luka 3 (graf pieszy bez tagów krawędzi) — NIE ruszana. Dalekie przystanki powyżej 1 km — bez zmian, wymagają szerszego `gridBbox` (zgoda właściciela).
- Luka 2 — sprostowanie opisu (2026-11-20). Trzy dawne twierdzenia są nieaktualne:
  - „Koła bez bariery wody" — nieprawda. Koła SĄ maskowane wodą przy rysowaniu: warstwa w `js/map.js` wycina poligony i linie z `water.json` trybem `destination-out`. Koło nie maluje po zatoce tam, gdzie zatoka jest w `water.json`.
  - Promień koła jest już ograniczony do 1 km stałą `OUTSIDE_MAX_RADIUS_M` w `js/isochrone.js`. Nie ma kół o promieniu 5 km.
  - Szczecin nie jest dotknięty w praktyce: 3 pozycje poza siatką, wszystkie 0,42–0,68 km na zachód, w okolicy bez większej wody.
- Luka 2 — prawdziwa wada (2026-11-20), trzy części:
  - Koła rysują się NA WIERZCHU obrysów (`js/map.js`: najpierw kontury, potem koła, ten sam bufor, `source-over`). Dla przystanku 80–900 m za krawędzią siatki płaski dysk jednego koloru zamazuje poprawny wynik fali lądowej WEWNĄTRZ `gridBbox`, czyli tam, gdzie dziś jest dobrze.
  - Woda nie jest barierą dla propagacji poza siatką, więc pasmo może pojawić się po drugim brzegu.
  - Dla przystanków dalszych niż kilka km od krawędzi nie ma w `data/<miasto>/water.json` ani jednego poligonu. `tools/build-water.mjs` buduje wodę na `gridBbox`, a poza prostokąt wycieka tylko tyle, ile sięga pojedynczy way z Overpass. Nie ma czym stawiać bariery.
- Luka 2 — pomiar (2026-11-20, dane w `data/`, unikalne pozycje współrzędnych, nie wpisy tablicy; odległość od krawędzi `gridBbox`):
  - Poza siatką, suma po miastach: 0–200 m: 41; 200–500 m: 62; 500 m–1 km: 73; 1–5 km: 349; powyżej 5 km: 455.
  - Pierścień 0–1 km: 176 pozycji, z tego 53 ma geometrię wody w promieniu 1 km.
  - Po miastach (pierścień / z wodą w promieniu 1 km / najbliższa pozycja): warszawa 50/11/26 m; krakow 38/12/27 m; poznan 18/8/26 m; torun 14/0/86 m; kielce 13/7/34 m; bydgoszcz 10/2/140 m; wroclaw 8/4/348 m; olsztyn 6/3/3 m; lublin 6/0/182 m; opole 4/0/52 m; trojmiasto 4/3/718 m; szczecin 3/1/420 m; gzm 2/2/395 m.
  - Zero pozycji poza siatką: lodz, bialystok, rzeszow, zielonagora, gorzow.
  - Dalej niż 1 km (nienaprawialne): warszawa 391, krakow 146, trojmiasto 95, poznan 88, torun 31, bydgoszcz 23, kielce 22. Przyczyna: budowa danych zatrzymuje cały kurs, jeśli dotyka bboxa, więc feedy kolejowe (SKM, PolRegio, KM, WKD) ciągną ogon przystanków nawet 120 km od miasta (Trójmiasto aż po Bydgoszcz i okolice Olsztyna).
- Luka 2 — projekt (rozwiazywacz, 2026-11-20): „nasiona na brzegu siatki".
  - Przystanek leżący poza siatką nie dalej niż 1 km przestaje być kołem wewnątrz siatki. Zasiewa piksele BRZEGU siatki wartością „przyjazd + odległość w linii prostej / tempo", a dalej pracuje istniejąca fala po lądzie — z wodą, mostami i obejściem brzegu. Jego własne koło dostaje promień obcięty do odległości od siatki, więc nie wchodzi na obrysy. Przystanki dalsze: bez żadnej zmiany.
  - Uzasadnienie: każda droga z takiego przystanku do wnętrza siatki musi przeciąć brzeg, a poza brzegiem danych nie ma, więc zakładamy ruch w linii prostej — dokładnie to, co zakłada dzisiejsze koło.
  - Kontrakty i zmiany: `js/walkgrid.js` — nowe czyste funkcje `gapToGrid` (odległość punktu od prostokąta siatki) i `borderSeeds` (nasiona brzegowe, pomijające piksele wody, duplikaty rozstrzygane mniejszym czasem). Zgodność w tył: opcja `reset:false` w `computeTimeGrid` (domieszkuje minimum, nie zeruje) oraz opcjonalny trzeci element krotki nasienia — zasięg początkowy w metrach, żeby limit spaceru obejmował też metry przebyte w przerwie. `js/isochrone.js` — `buildZones` przyjmuje cap promienia per przystanek zamiast jednego wspólnego i respektuje cap także w trybie bez spaceru (dziś go tam ignoruje). `js/engine.js` — wpięcie w trzy istniejące ścieżki fali: rastrową, po sieci ulic (osobny drugi przebieg, bo pierwszy ma limit rozlania 75 m, który obcięłby strefę do paska przy krawędzi) i tryb bez spaceru. `js/map.js` bez zmian. Cała dodatkowa praca w workerze; wątek główny bez zmian.
  - Odrzucone opcje: (a) przycinanie koła do poligonów wody — tam, gdzie leży większość przystanków, `water.json` nie ma ani jednego punktu; dla pierścienia wynik gorszy niż fala, bo ucięty promień nie obchodzi brzegu; (b) lokalna siatka rastrowa wokół przystanku — druga siatka pokrywająca się z istniejącą, szwy na granicy, a dla dalekich nie ma z czego powstać; (c) poszerzenie `gridBbox` — przeliczenie wody, mostów i grafu pieszego dla 18 miast (zob. niżej); (d) padding rastra w runtime — rozdzielczość siatki jest wyliczana z pola bboxa, więc padding przesunąłby wszystkie piksele, a pierścień bez danych o wodzie byłby „cały ląd", więc fala skracałaby sobie drogę poza mapą.
- Luka 2 — dlaczego obie części muszą wejść razem: (1) obcięcie promienia i zasiewanie brzegu to para, nie dwie osobne zmiany. Samo obcięcie zabiera pokrycie i nic nie daje w zamian, więc byłoby regresem użyteczności; para musi wejść razem. (2) Para zmienia widocznie obraz izochrony w Warszawie i Krakowie i podnosi statystykę „% powierzchni" (przystanki z pierścienia zaczną wchodzić do statystyki; dziś ich koło nie jest w niej liczone wcale). Wzrost będzie realny i poprawny, ale to zmiana rdzenia produktu.
- Luka 2 — czego projekt NIE naprawia: 804 pozycje dalej niż 1 km od krawędzi (349 w pasie 1–5 km, 455 powyżej 5 km) zostają kołami 1 km. Jedyne wyjście to szerszy `gridBbox` i przeliczenie `water.json`, `bridges.json` oraz `walknet.json` dla 18 miast — wymaga zgody właściciela i jest poza tym zadaniem. Sama przerwa między przystankiem a siatką (do 1 km) nadal nie ma bariery wody, bo nie ma tam danych.
- Luka 2 — jak sprawdzić przy wdrożeniu: test monotoniczności (nasiona mogą tylko skracać czas, nigdy go nie wydłużać, dla każdego piksela); regresja na Łodzi (bez przystanków poza siatką) — obraz i statystyki bez żadnej zmiany; regresja barierowa — siatka z pasem wody bez mostu, przystanek za krawędzią po stronie A: piksele po stronie B muszą zostać nieosiągalne; ten sam układ z mostem daje stronę B osiągalną i dłuższy czas; przystanek 10 km za krawędzią daje wynik identyczny jak dziś; narożnik siatki (nasiona na dwóch bokach, bez duplikatów); zgodność w tył obu rozszerzeń krotki i opcji `reset`.
- Dowód: luka 2 — pomiar 2026-11-20 (wyżej) oraz `js/engine.js:360` (`maxRadiusM: Math.min(OUTSIDE_MAX_RADIUS_M, maxWalkSec * WALK_MPS)`). Luki 1 i 3: nieznane.
- Pliki: tools/build-data.mjs, tools/build-walknet.mjs, js/walkgrid.js (luki 1 i 3). Luka 2: js/walkgrid.js, js/isochrone.js, js/engine.js, testy w tests/ (walkgrid, isochrone, engine).

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

### Z-082 [P2] Fala rastrowa liczy tempem pieszym także w trybie rowerowym
- Status: nowe
- Zgłoszone: 2026-11-27 (nieznane)
- Problem: zapasowa ścieżka liczenia na rastrze (używana, gdy graf ulic nie jest jeszcze wczytany) bierze promień rozlania i tempo fali z prędkości pieszej również wtedy, gdy użytkownik wybrał tryb „rower w pojeździe", w którym wyjście z przystanku jest rowerowe. Ścieżka główna robi to inaczej — niespójność.
- Dowód: znalezione przy projektowaniu Z-013 i nie naprawiane, bo było poza zakresem tamtego zadania. Numer linii: nieznany.
- Pliki: js/engine.js.

### Z-083 [P2] Wigilia oznaczona jako dzień wolny bez ograniczenia roku
- Status: nowe
- Zgłoszone: 2026-11-27 (nieznane)
- Problem: w module kalendarza 24 grudnia jest oznaczona jako dzień wolny bez warunku na rok, a w Polsce jest wolna dopiero od 2025. Dla dat wstecznych sprzed 2025 odpowiedź byłaby błędna. Przy dzisiejszym zastosowaniu (pytamy zawsze o „dziś") nie ma to wpływu; ujawni się, gdy pojawi się wybór daty historycznej.
- Dowód: znalezione przy Z-037. Numer linii: nieznany.
- Pliki: js/calendar.js.

### Z-084 [P3] Święto wypadające w sobotę nie przełącza rozkładu na niedzielny
- Status: nowe
- Zgłoszone: 2026-11-27 (nieznane)
- Problem: po wdrożeniu Z-037 święto w dzień roboczy przełącza rozkład na niedzielny, ale święto wypadające w sobotę zostaje sobotą. To zachowanie sprzed zmiany, nierozstrzygnięte. Do ustalenia: czy w sobotnie święto komunikacja jedzie rozkładem sobotnim czy niedzielnym. To pytanie o teren, nie o kod, i prawdopodobnie odpowiedź zależy od miasta.
- Dowód: znalezione przy Z-037. Numer linii: nieznany.
- Pliki: js/uilogic.js.

### Z-085 [P3] Komentarz w arkuszu stylów wspomina usunięty przycisk
- Status: nowe
- Zgłoszone: 2026-11-27 (nieznane)
- Problem: komentarz przy regule stylu nadal opisuje przycisk „Pokaż niedzielę", usunięty w Z-037. Reguła obsługuje teraz tylko przycisk kopiowania raportu diagnostycznego. Drobiazg porządkowy.
- Dowód: znalezione przy Z-037. Numer linii: nieznany.
- Pliki: css/style.css.

