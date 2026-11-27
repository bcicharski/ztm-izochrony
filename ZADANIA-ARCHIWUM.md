# Zadania: archiwum

Zamknięte zadania (`zrobione`, `odrzucone`) i pełna historia wpisów skróconych w kolejce.
Utrzymuje je wyłącznie agent `kronikarz`. **Nie czytaj tego pliku w całości** — szukaj po
identyfikatorze: `Grep "^### Z-045" ZADANIA-ARCHIWUM.md` i Read z `offset`/`limit`.
Aktywna kolejka: `ZADANIA-DO-ZROBIENIA.md`.

Nowe wpisy dopisuje się tuż pod markerem danej sekcji (najnowsze na górze sekcji; starsze
wpisy poniżej zachowują dotychczasową kolejność).

## Zrobione

<!-- NOWE-ZROBIONE -->

### Z-075 [P2] Wyciek `water.json` poza `gridBbox` jest przypadkowy
- Status: zrobione 2026-11-27 (wpis w CHANGELOG.md, sekcja 2026-11-27)
- Zgłoszone: 2026-11-20 (nieznane)
- Problem: `tools/build-water.mjs` buduje wodę na `gridBbox`, ale Overpass zwraca pełną geometrię way'a, który ma choć jeden węzeł w prostokącie. Zasięg wycieku był losowy: przed zmianą Bydgoszcz 72,5 km na północ, Warszawa 66 km na zachód, Trójmiasto 34,3 km na południe, w innych kierunkach kilkaset metrów. Tą maską przycinane są koła 804 przystanków leżących poza siatką, więc w jednym kierunku koło respektowało brzeg, w drugim nie.
- SPROSTOWANIE (2026-11-27): dotychczasowy opis podawał dla Trójmiasta 4,3 km na południe i 0,6 km na zachód. Te liczby pochodziły z wcześniejszego raportu projektowego i były o rząd wielkości za małe. Koordynator przekazał je do zlecenia bez sprawdzenia; wdrożeniowiec zmierzył je sam i zatrzymał pracę zamiast wdrażać na błędnej przesłance. Prawidłowe liczby są w punkcie Problem.
- Dowód: pomiar 2026-11-20 (Trójmiasto, geometria wody za krawędzią `gridBbox`; liczby sprostowane wyżej); pomiar wdrożeniowca przed zmianą (2026-11-27): Bydgoszcz, Warszawa, Trójmiasto, jak w punkcie Problem.
- Opcje (rozstrzygnięte i wdrożone 2026-11-27): zapytanie do Overpass idzie dla siatki powiększonej o 2 km, a wynik jest przycinany do tego samego prostokąta. Stała marginesu w `tools/geo.mjs`. Margines wynika z pomiaru: przystanek może leżeć do 1 km za krawędzią (176 pozycji w pierścieniu 0–1 km), a jego koło ma promień do 1 km, więc najdalszy punkt wymagający przycięcia leży 2 km za siatką. Żadne z dwóch pierwotnie rozważanych wyjść nie wystarczało osobno: sam margines nie daje jednakowego zachowania (serwer i tak oddaje rzekę w całości), a samo przycięcie do siatki zabrałoby barierę kołom przystanków leżących do 1 km za krawędzią.
- Efekt: maska wody ma jednakowy zasięg 2 km poza siatką pieszą we wszystkich 18 miastach i we wszystkich kierunkach. Zmierzone po przebudowie: maksymalne wystawanie wynosi dokładnie 2000 m, w żadnym mieście ani metr więcej.
- Oczekiwanie, które się nie sprawdziło: zapowiadano ok. 50 kB oszczędności po gzipie. Wynik: 559,1 kB wobec 555,3 kB przed przebudową, czyli 3,8 kB WIĘCEJ. Próba na sucho tylko przycinała istniejące dane; prawdziwe pobranie dołożyło wodę w promieniu 2 km tam, gdzie wcześniejszy przypadkowy wyciek był krótszy niż margines. Bilans rozmiaru jest neutralny; jedynym zyskiem jest przewidywalność maski. Nie szukać oszczędności, której nie ma.
- Pliki: tools/geo.mjs (nowe funkcje przycinania i wyznaczania zasięgu zapytania, stała marginesu), tools/build-water.mjs, tests/build-water.test.mjs (nowy), `data/<miasto>/water.json` w 18 miastach. `js/map.js` nietknięty (sposób użycia maski się nie zmienia); pola w `data/cities.json` nie dodano.
- Jak sprawdzić: 10 nowych testów na danych syntetycznych (obiekt w całości wewnątrz; przecinający granicę; całkowicie poza; rzeka 72 km jako regresja tego zadania; linia wchodząca i wychodząca dwukrotnie; pierścień przecinający granicę z zachowaniem obiegu; pierścień obejmujący cały prostokąt). `npm run check`: tests 621, pass 620, fail 0, skipped 1, lint czysty. Przebieg: Warszawa i Wrocław padły w pierwszym przebiegu na błędzie 502 po stronie Overpass, przeszły przy powtórzeniu (awaria przejściowa, nie w kodzie). Nie sprawdzone: wygląd map po przebudowie w przeglądarce w żadnym mieście; sprawdzono zasięg liczbowo i wynik testów.

### Z-037 [P2] Automatyczne ustawianie niedzieli w święto
- Status: zrobione 2026-11-27 (wpis w CHANGELOG.md, sekcja 2026-11-27)
- Zgłoszone: nieznane
- Problem: dziś w święto strona pokazuje komunikat z przyciskiem przełączającym na rozkład niedzielny (Z-022). Wariant pełny ustawiałby typ dnia sam. To naprawa (w Boże Ciało rozkład roboczy nie istnieje w terenie), ale zmienia domyślny stan kontrolki.
- Dowód: nieznane.
- Pliki: js/uilogic.js, js/app.js, tests/uilogic.test.mjs.
- Decyzja właściciela (2026-11-24): zatwierdzone, ma się przełączać automatycznie. Wdrożone 2026-11-27.

### Z-013 [P2] Profil pieszego
- Status: zrobione 2026-11-27 (zakres zawężony do tempa marszu; schody i bezbarierowość poza zakresem, powód w CHANGELOG.md, sekcja 2026-11-27)
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak ustawień prędkości, schodów i bezbarierowości.
- Dowód: nieznane.
- Pliki: js/data.js, js/engine.js, js/router.js, js/uilogic.js, js/app.js, index.html, css/style.css, README.md, CURRENT_STATE.md.

### Z-003 [P1] Mniejsze dane
- Status: zrobione (etap 1, dekoder, wdrożony 2026-11-27; etap 2, przeliczenie `walknet.json` w 18 miastach, wdrożony 2026-11-27)
- Zgłoszone: 2026-11-16 (analityk)
- Problem: walknet.json ładowany w całości — 3,3 MB dla Trójmiasta, ok. 2,4 MB po gzipie dla GZM. Pomysły: format binarny, kafle wokół widoku, wersjonowanie nazw plików.
- Dowód: rozmiary plików w data/<miasto>/. Pomiar 2026-11-24 (`tools/measure-data.mjs`, tylko odczyt): graf pieszy to 63,5% danych pobieranych po gzipie (11 886 KB z 18 732 KB dla 18 miast), w GZM 68%. Całe pobranie po gzipie: Warszawa 3307 KB, GZM 3464 KB, Trójmiasto 1702 KB, Opole 214 KB, Gorzów 199 KB.
- Rozwiązanie (wdrożone 2026-11-27): kodowanie długości krawędzi jako reszta względem odległości w linii prostej między jej końcami. Etap 1: dekoder grafu pieszego w `js/walknet.js` czyta nowy format; rozpoznawany po obecności pola, nie po numerze wersji; pliki w starym formacie dekodują się jak dotąd. Etap 2: przeliczenie `walknet.json` w 18 miastach, osobnym commitem po rozejściu się nowego dekodera. Zysk po gzipie: 15,2–17,3% (najmniej Kraków, najwięcej Łódź); GZM 2350 → 1966 KB, Warszawa 2001 → 1659 KB, Trójmiasto 1048 → 883 KB, Opole 129 → 107 KB. Graf pieszy to 63,5% danych pobieranych przez przeglądarkę, czyli ok. 10% całego pobrania. Bez utraty dokładności: błąd położenia węzła 0,56 m, jak dziś.
- Brama jakości (18 miast, po zapisie): graf po zdekodowaniu identyczny co do wartości; mediana, 95. percentyl i maksimum różnicy czasu dojścia równe zero; zmiana osiągalnych metrów 0,00% w każdym z pięciu pasm; udział głównej składowej spójnej bez zmian; zero przypadków jednostronnych; 13 262–32 204 pary punkt–przystanek na miasto.
- Kolejność wdrożenia (wniosek na przyszłość): dekoder wyszedł osobnym, wcześniejszym commitem i zdążył się rozejść (zweryfikowano na produkcji: nowy plik od 10:51 UTC, pamięć podręczna wygasała o 11:03), a dane poszły dopiero po tym czasie. Odwrotna kolejność — nowe dane przy starym kodzie w pamięci podręcznej przeglądarki — wywaliłaby stronę. Ten sam porządek obowiązuje przy każdej przyszłej zmianie formatu plików.
- Wynik zadania: z czterech pomysłów pomiar obalił trzy. Porządek węzłów (krzywa Hilberta zamiast pasm 500 m): od −2,0% do +1,0%. Format binarny: 10–15% wobec JSON z tym samym kodowaniem, poniżej progu 15%, odrzucony. Przerzedzanie grafu: krawędzie krótsze niż 25 m to 34–54% krawędzi, ale 3,6–9,5% km sieci; mały zysk w bajtach, zmiana topologii. Wdrożony został czwarty, początkowo niewymieniony w zadaniu: kodowanie reszty długości krawędzi. Wariant z grubszą kwantyzacją (do 18,6%) ODRZUCONY: kwantyzacja 1e4 to błąd położenia do 5,6 m. Narzędzia pomiarowe (`tools/measure-data.mjs`, `tools/measure-lib.mjs`) zostają w repozytorium, żeby powtórzyć pomiar przy następnej takiej decyzji.
- Pliki: js/walknet.js, tools/build-walknet.mjs, tools/measure-lib.mjs, README.md, tools/walknet-codec.mjs (nowy), tools/reencode-walknet.mjs (nowy; domyślnie na sucho, zapis wymaga jawnej flagi, przez plik tymczasowy z ponownym odczytem i weryfikacją grafu), tools/walknet-ab.mjs (nowy), tools/measure-data.mjs (nowy), data/<miasto>/walknet.json w 18 miastach (etap 2).
- Jak sprawdzić: 8 nowych testów w tests/walknet-codec.test.mjs (regresja starego formatu, obieg zamknięty, reszta zerowa i duża, krawędź zerowej długości, pętla z węzła do siebie, brama zielona na identycznym grafie i czerwona na popsutych długościach); `npm run check`: tests 588, pass 587, fail 0, skipped 1, lint czysty. Weryfikacja w przeglądarce: Trójmiasto renderuje się poprawnie, konsola bez błędów. Nie sprawdzone: pozostałe 17 miast w przeglądarce (tylko brama jakości); realny czas pobierania na łączu mobilnym nie mierzony; zgodność zaokrągleń Node–przeglądarka nie mierzona (rozbieżność możliwa tylko dla cięciwy wypadającej dokładnie na pół metra).

### Z-053 [P2] Potwierdzenie progów bramki na realnych `counts` i `grid`
- Status: zrobione (2026-11-27; potwierdzenie na 16 z 18 miast, zero rozbieżności; Gorzów i Zielona Góra bez pól — znany i nieszkodliwy brak)
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: progi z Z-031 dobrano z wartości policzonych z plików rozkładowych, a nie z pól `counts` i `grid` w `meta.json`, bo tych jeszcze nie ma. Po pierwszym odświeżeniu danych trzeba sprawdzić, czy wyliczone udziały zgadzają się z zapisanymi.
- Dowód: obserwacja 2026-11-16: żaden `meta.json` nie ma pól `counts` ani `grid`.
- Wynik końcowy (2026-11-27): progi bramki jakości potwierdzone na zapisanych polach `counts` i `grid` w metadanych, dla 16 z 18 miast — zero rozbieżności. Policzone wartości zgadzają się z zapisanymi co do jednego przystanku i co do setnej części procenta. Domyka wynik częściowy z 2026-11-24 (wtedy pola miały tylko Łódź, Olsztyn i Opole, wszystkie o niskim udziale). Od tego czasu odświeżenia przebudowały kolejne miasta; pola ma też Warszawa, miasto o najwyższym udziale przystanków poza siatką pieszą.
- Zmierzone udziały poza siatką, zapisane w metadanych (2026-11-27): Warszawa 8,89%, Kraków 5,90%, Trójmiasto 5,55%, Toruń 5,02%, Poznań 3,16%, Bydgoszcz 2,79%, Kielce 2,59%, Olsztyn 1,00%, Opole 0,77%, Lublin 0,76%, Wrocław 0,44%, Szczecin 0,19%, Łódź 0,08%, GZM 0,07%, Białystok i Rzeszów 0,00%. Próg ostrzegawczy 25%: wobec najgorszego realnego miasta zapas blisko trzykrotny, potwierdzony na liczbach, które zapisuje sam build. Progów nie zmieniano.
- Pozostałe dwa miasta: Gorzów i Zielona Góra nie mają jeszcze pól, bo ich dane nie były przebudowywane po zmianie, która je wprowadziła. Gorzów — świadomie martwe źródło rozkładu (Z-055). Oba mają zerowy albo bliski zeru udział przystanków poza siatką, więc nie wpływają na ocenę progów. Znany i nieszkodliwy brak, nie otwarty punkt.
- Wynik wcześniejszy (2026-11-20; częściowy, 3 z 18 miast): progi są w porządku, logika bez zmian; zgadzają się z polami `counts` i `grid`. Pola miały Łódź, Olsztyn i Opole; dla nich wszystkie wielkości z `counts` i `grid` policzono tą samą funkcją co build i porównano z `meta.json`: zero różnic, w tym `outsideStops`, `outsideShare` i `maxOutsideKm`. Jedyna rozbieżność (liczba linii w plikach dnia Łodzi 129 / 133 / 134 wobec `counts.routes` 134) ma przyczynę w kodzie i została zgłoszona jako Z-080 (naprawiona 2026-11-27).
- Pliki: tools/check-data.mjs (wdrożenie 2026-11-27: żadne; zadanie weryfikacyjne, kod bez zmian; komentarz przy `outsideShareWarn` dopisany 2026-11-20 zostaje aktualny).
- Testy: bez zmian. Niezweryfikowane: Gorzów i Zielona Góra, do czasu przebudowy ich danych.
- Notatka (2026-11-27): Gorzów i Zielona Góra nadal nie mają pól `counts` i `grid` w metadanych; dostaną je dopiero przy pierwszej przebudowie swoich danych rozkładowych. Dla Gorzowa oznacza to „po rozwiązaniu Z-055”, bo jego źródło jest świadomie martwe. Zadanie pozostaje zamknięte.

### Z-080 [P3] Lista linii zapisywana w plikach dnia zależy od kolejności budowania dni
- Status: zrobione (wdrożone 2026-11-27)
- Zgłoszone: 2026-11-20 (nieznane; znalezione przy Z-053)
- Problem: lista linii w `tools/build-data.mjs` jest uzupełniana leniwie w trakcie budowania kolejnych dni i zapisywana do każdego pliku w chwili jego zapisu. Łódź ma w plikach dnia 129 (dzień roboczy), 133 (sobota) i 134 (niedziela) linii, a `counts.routes` to 134. Dziś nieszkodliwe, bo bramka porównuje `counts` z `counts`, ale plik dnia niesie wtedy niepełną listę linii.
- Dowód: pomiar 2026-11-20 (Łódź: liczba linii w `data/lodz/workday.json`, `saturday.json`, `sunday.json` wobec `counts.routes` w `data/lodz/meta.json`); przyczyna ustalona z kodu `tools/build-data.mjs`.
- Rozwiązanie (wdrożone 2026-11-27): wszystkie dni budowane najpierw, ładunki do zapisu składane potem z końcową listą linii. Każdy plik dnia niesie pełną listę niezależnie od kolejności budowania. Plik niepełny, nie błędny: indeksy linii są tylko dopisywane, więc wzorce w starszych plikach wskazują poprawne nazwy; brakowało pozycji na liście, nic nie było źle wyświetlane. Format plików i numer wersji bez zmian; front nietknięty. Wpływ na rozmiar: rząd 100 bajtów na plik (Łódź).
- Pliki: tools/build-data.mjs, tools/build-lib.mjs (nowa funkcja; odstępstwo świadome: `tools/build-data.mjs` nie ma eksportów, więc nie dało się jej przetestować), tests/build-lib.test.mjs. `data/` i `js/` nietknięte; pliki dnia odświeżą się przy najbliższym cotygodniowym buildzie.
- Jak sprawdzić: 3 nowe testy w `tests/build-lib.test.mjs` (budowanie dni w trzech kolejnościach daje tę samą listę; indeksy wskazują właściwe nazwy; plik ze starą, niepełną listą dekoduje się). Dowód, że test łapie wadę: po tymczasowym przywróceniu starego zachowania test kolejności padł (lista 2 pozycje zamiast 4). Słabość: test zgodności wstecznej sprawdza tylko dekodowanie bez błędu, nie wykryje zmiany sposobu, w jaki front korzysta z listy. `npm run check`: tests 555, pass 554, fail 0, skipped 1, lint czysty (wynik podany w zleceniu, nie wklejony dosłownie z terminala). Nie sprawdzone: przebieg na realnym mieście (wymaga pobranego feedu), więc przepięta pętla zapisu nie była wykonana na prawdziwych danych.

### Z-079 [P2] Uszkodzony agregat jednego miasta przerywa cały przebieg kolektora
- Status: zrobione
- Zgłoszone: 2026-11-20 (nieznane; znalezione przy Z-019)
- Problem: uszkodzony plik agregatu jednego miasta wywróciłby cały proces `tools/collect-delays.mjs` już po zebraniu danych: podsumowanie przebiegu nie zostałoby wydrukowane, a miasta przetwarzane po nim straciłyby zapis.
- Dowód: odtworzone na kopii starego skryptu z lokalnym serwerem i trzema miastami: ucięty plik pierwszego miasta dawał błąd parsowania, przerwanie procesu, brak podsumowania, a dwa pozostałe miasta nie zostały zapisane mimo poprawnie pobranych danych. Parsowanie agregatu stało w pętli po miastach bez zabezpieczenia, a wywołanie całej funkcji nie miało przechwycenia błędu.
- Wdrożono 2026-11-24: pętla po miastach wyniesiona do osobnej, testowalnej funkcji. Odczyt agregatu rozróżnia brak pliku (stan normalny, pierwsze uruchomienie) od pliku nieczytelnego lub o złym kształcie (awaria tego miasta). Awaria odczytu i awaria zapisu dają werdykt błędu dla swojego miasta, trafiają do tabeli podsumowania z powodem i nie przerywają pozostałych. Zapis idzie przez plik tymczasowy w tym samym katalogu co docelowy i atomowe przeniesienie (konwencja jak w konwerterze TransXChange). Po nieudanym zapisie plik tymczasowy jest sprzątany, a docelowy zostaje nietknięty. Podsumowanie drukuje się zawsze, a kod wyjścia odzwierciedla awarię.
- Zakres rozszerzony w trakcie: zapis agregatu nie był atomowy (kolektor pisał wprost na plik docelowy), więc najbardziej prawdopodobnym producentem uszkodzonego pliku był sam kolektor przerwany w trakcie zapisu (przebieg w GitHub Actions może zostać ucięty limitem czasu albo anulowany). Atomowy zapis wszedł w to samo zadanie.
- Świadomy wybór: uszkodzony plik nie jest nadpisywany ani przemianowywany; zostaje bajt w bajt. Skutek: obserwacje z tego przebiegu dla tego miasta są tracone, a miasto zgłasza awarię w każdym kolejnym przebiegu, dopóki plik nie zostanie naprawiony ręcznie. Historia opóźnień jest do odzyskania z historii gita.
- Sprawdzone inne miejsca: odczyt listy miast może wywrócić całość, ale bez tej listy nie ma czego przetwarzać (nie zmieniano); mapa nazw linii i dopisywanie do podsumowania przebiegu mają już własne zabezpieczenia; funkcja zbierająca dane jednego miasta nie rzuca od Z-019.
- Pliki: tools/collect-delays.mjs, tests/collect-delays.test.mjs. `data/`, workflow, `js/` i `data/cities.json` nietknięte.
- Jak sprawdzić: 7 nowych testów: uszkodzony agregat pierwszego miasta (pozostałe zapisane, stary plik nietknięty); zły kształt danych zamiast obiektu; poprawne agregaty bez zmian zachowania; brak pliku i brak katalogu jako stan normalny; katalog w miejscu pliku; przerwany zapis; brak pliku tymczasowego po udanym zapisie. Test przerwanego zapisu padał przed poprawką (stary agregat zostawał nadpisany uciętą treścią). Dla wady głównej dowodem jest realny przebieg starego skryptu, bo na starym kodzie testów jednostkowych nie dało się zaimportować. `npm run check`: tests 540, pass 539, fail 0, skipped 1, lint czysty. Niezweryfikowane: przebieg w GitHub Actions i na realnych feedach; atomowość przeniesienia sprawdzona lokalnie na Windows, nie na runnerze.

### Z-081 [P1] Bramka jakości nie broniła przed cofnięciem rozkładu
- Status: zrobione
- Zgłoszone: 2026-11-23 (wdrozeniowiec)
- Problem: `tools/check-data.mjs` porównywała świeże dane z poprzednią wersją pod kątem liczby kursów, przystanków i udziałów, ale nie sprawdzała, czy nowy rozkład nie kończy się wcześniej niż obecny. Data końca ważności trafiała wyłącznie do tekstu raportu, a decyzja o blokadzie jej nie uwzględniała. Cotygodniowe odświeżenie mogło więc zastąpić dobre dane starszymi. Zawór (miękkie blokady przepuszczane awaryjnie, gdy stary rozkład wygasa w ciągu kilku dni) pogarszał sprawę: w okresie końca danych bramka była najbardziej skłonna wpuścić gorsze dane.
- Dowód: pomiar 2026-11-23 na żywym źródle: BIP MZK Gorzów wystawia paczkę z rozkładem ważnym od 3 do 10 listopada 2026 (`feed_info.txt`: `20261103,20261110`; `calendar.txt` i wszystkie 18122 wiersze `calendar_dates.txt` w tym samym oknie). Dane Gorzowa w repozytorium są ważne do 30 grudnia 2026. Bez zabezpieczenia wpięcie tego źródła cofnęłoby rozkład o siedem tygodni.
- Wdrożono 2026-11-23: nowa reguła w bramce — rozkład kończący się wcześniej niż obecny to twarda blokada, której zawór nie przepuszcza. Daty równe przechodzą (przebudowa tego samego okna to nie cofnięcie). Brak poprzedniej wersji albo brak daty po którejkolwiek stronie nie blokuje. Reguła stoi przed wczesnym wyjściem dla braku pola z licznościami, więc działa także przy niepełnych metadanych; to była świadoma poprawka w drugim podejściu. Przykładowy komunikat: „BLOKADA: rozkład cofnięty: nowy feed kończy się 10.11.2026, a obecny jest ważny do 30.12.2026".
- Ustalenia:
  - Ręczne obejście (`--force`) przepuszcza także twarde blokady, w tym tę nową. Tak było wcześniej dla innych twardych blokad i nie zostało zmienione; to świadome obejście człowieka, nie luka.
  - Jedno twarde znalezisko wyłącza zawór dla całego przebiegu, także dla miękkich spadków (zachowanie sprzed zmiany).
  - Decyzja wdrożeniowca, odnotowana jako jego własna: w ścieżce blokady bez pola z licznościami raport nie jest oznaczany jako „brak poprzedniej wersji", bo inaczej zniknęłaby z niego podpowiedź, jak blokadę świadomie obejść.
- Pliki: tools/check-data.mjs, tests/check-data.test.mjs. Nie zmieniano: `data/`, `data/cities.json`, workflow, `js/`.
- Jak sprawdzić: testy — 6 nowych: blokada, daty równe, datę późniejszą, brak poprzedniej wersji, brak daty po którejś stronie, interakcja z zaworem, przypadek bez pola z licznościami, ręczne obejście oraz scenariusz Gorzowa z prawdziwymi datami. Dowód, że testy łapią lukę: na kodzie sprzed zmiany padły trzy testy, kluczowy z zaworem (spadek kursów przy wygasającym rozkładzie i cofniętej dacie stary kod przepuszczał jako `warn` zamiast `block`); po przeniesieniu reguły przed wczesne wyjście padał dodatkowo test przypadku bez liczności. `npm run check`: tests 533, pass 532, fail 0, skipped 1, lint czysty (wynik podany w zleceniu, nie wklejony dosłownie z terminala). Wynik na realnych danych: `node tools/check-data.mjs` wypisuje to samo co przed zmianą — problemy w 2 z 18 miast (Wrocław i GZM, rozkłady kończące się 29.11.2026, ostrzeżenia sprzed zmiany); nowa reguła nie zapaliła się nigdzie, czyli żadne miasto nie ma dziś cofniętej daty. Nie sprawdzone: zachowanie w workflow `refresh-data.yml` na żywo; wygląd raportu dla blokady przy niepełnych metadanych (sprawdzono tylko bezpieczeństwo ścieżki kodu).

### Z-044 [P2] Tryb ciemny (`prefers-color-scheme: dark`) — decyzja właściciela
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: strona nie ma wariantu dla systemowego trybu ciemnego. Zmiana wpływa na wygląd dla wszystkich z ciemnym motywem systemu, dlatego wymaga zgody właściciela. Powiązane: Z-016 (szerszy zakres).
- Dowód: brak `prefers-color-scheme` w css/style.css (sprawdzone 2026-11-16).
- Wygląd i UX (esteta, specyfikacja z wejścia fali): tokeny ciemne `--surface #1b1c24`, `--ink #ececf1` (14,40:1), `--muted #a3a7b5` (7,07:1), `--accent #e872bd` (6,12:1), `--line #3a3c4a`, `--line-strong #6b6e82` (3,37:1), nowe `--on-accent`, `--dot-a`, `--dot-b`; `color-scheme: dark` na `.panel`, nie na `:root`. Mapa zostaje jasna: filtr `invert` na kafelkach odrzucony (psuje wodę, zieleń i etykiety). Ciemna mapa wymagałaby nowej palety stref, bo pasma 45 i 60 min dają na ciemnym tle kontrast 1,19 i 1,06:1. Swatche legendy w ciemnym motywie bez alfa, z obrysem. Przełącznik w interfejsie niepotrzebny.
- Wdrożono 2026-11-21 (w CHANGELOG.md: 2026-11-21, Dodane): przy systemowym trybie ciemnym panel, dymki na mapie oraz okna pomocy i polityki prywatności są ciemne; mapa, kolory pasm izochron i ich krycie bez zmian. Mapa zostaje jasna: odwrócenie kafelków filtrem odrzucono, bo warstwa stref to osobne płótno, a filtr zmienia tylko podkład, na którym pasma się składają (na ciemnym podkładzie pasmo 45–60 min spada z około 3,9:1 do 1,1:1, „ponad 60" do 1,6:1, a 30–45 i 45–60 zlewają się). Osobnej rampy dla ciemnego tła nie wprowadzono, bo rozjechałaby się z legendą, eksportem GeoJSON i zrzutami. Odrzucono też inne źródło kafelków (zakaz zależności i serwera) oraz przyciemnienie jasnych kafelków (pasmo 45–60 spada do około 3,4:1, to szacunek, nie pomiar). Bez przełącznika ręcznego, tylko `prefers-color-scheme`. Tokeny: pięć nadpisanych w trybie ciemnym; `--accent` jaśniejszy niż w jasnym, bo dotychczasowy na ciemnym tle ma 3,2:1. Trzy nowe tokeny elementów na mapie (linia trasy, pinezki spotkania, ramka i krzyżyk klawiatury) mają wartości stałe, nieprzesłaniane w trybie ciemnym. Osobne reguły: `color-scheme` (natywne kontrolki), jawne tło okien dialogowych, dymki Leaflet z literalnym białym tłem w swoim arkuszu (bez reguły miałby tekst pomocniczy 2,7:1), przycisk zamknięcia dymka, obrys 1 px na próbkach pasm w legendzie i tabeli statystyk (trzy z sześciu pasm mają na ciemnym panelu poniżej 3:1).
- Kontrasty (policzone niezależnie, progi spełnione): tekst główny na panelu 14,32:1; pomocniczy na panelu 6,19:1; pomocniczy na kontrolkach 4,76:1 (najmniejszy zapas); tekst główny na kontrolkach 11,02:1; akcent na panelu 5,08:1; akcent na kontrolkach 3,91:1 (element nietekstowy); punkt A 4,09:1; punkt B 5,52:1; akcent mapowy na białym 5,45:1. Audyt na żywo (kolor wobec efektywnego tła): zero elementów poniżej 4,5:1 (84 w panelu i banerze zgody, 33 w oknie polityki).
- Dowód, że mapa się nie zmienia: zrzut samej mapy w trybie jasnym i ciemnym jest pikselowo identyczny po ukryciu panelu i kontrolek (ten sam SHA-256). Zastrzeżenie: w pierwszej próbie, przy widocznym cieniu znacznika, 32 z 33 pikseli wokół znacznika różniły się, maks. 5 na 255 na kanał; po ukryciu cienia różnica znikła. Cień to obrazek rastrowy, nie CSS; przyczyny nie ustalono.
- Czego się wyrzekamy: wieczorem mapa pozostaje jasną płachtą, ciemny jest panel (na telefonie do 62% wysokości ekranu). Kto chce ciemny panel przy jasnym systemie, nie ma jak go wymusić. Przyciemnienie kafelków to ewentualne osobne zadanie, wymagające pomiaru na prawdziwych kafelkach.
- Niezweryfikowane: strzałki i najechanie na liście podpowiedzi, nagłówek historii i jej czyszczenie, stan bez wyników, tryb dwóch punktów z kropką B, przycisk zaproszenia w dymku spotkania, dymek kółka lokalizacji, rozwinięty wybierak godziny i lista wyboru, stany wygaszone; czy płótno stref przerysowuje się przy zmianie motywu (w kodzie nie ma nasłuchu na zmianę schematu, nie mierzono).
- Pliki: css/style.css, CURRENT_STATE.md; testy: tests/dark-mode.test.mjs (nowy), tests/a11y-css.test.mjs i tests/keyboard-journey.test.mjs (zaktualizowane, bo sprawdzały linię trasy na tokenach panelu). README.md bez zmian (nie opisuje motywu); js/ i index.html nietknięte (wcześniej w plikach wpisano js/app.js).
- Jak sprawdzić: `npm run check` — tests 527, pass 526, fail 0, skipped 1, lint czysty; weryfikacja w przeglądarce (panel, baner, okna, dymki, linia trasy, klawiatura, tryb spotkania, legenda; telefon i komputer).

### Z-076 [P2] Cap przerwy liczony zawsze w tempie pieszym, także w trybie rowerowym
- Status: zrobione
- Zgłoszone: 2026-11-20 (nieznane)
- Problem: w `js/engine.js` ograniczenie promienia dla przystanków poza siatką mnoży limit spaceru przez prędkość pieszą, również gdy dojście do przystanku jest rowerem. Niespójność znaleziona przy projekcie Z-007.
- Dowód: `js/engine.js:360` (`maxRadiusM: Math.min(OUTSIDE_MAX_RADIUS_M, maxWalkSec * WALK_MPS)`). Otoczenia tej linii w tym wpisie nie czytano.
- Rozwiązanie (wdrożone 2026-11-20): tempo wyjścia liczone raz w `js/engine.js` i przekazywane do capu oraz do obu wywołań `buildZones`; `buildZones` w `js/isochrone.js` przyjmuje dwie opcje — tempo wyjścia (domyślnie piesze) i tempo wokół punktu użytkownika (domyślnie równe tempu wyjścia), więc wywołania bez nowych opcji dają wynik identyczny. Zakres rozszerzony o `js/isochrone.js`: `buildZones` liczy promień pasma też stałą `WALK_MPS`, a cap jest tylko górnym ograniczeniem, więc sama poprawka capu nie zmieniała nic bez limitu spaceru — to druga połowa tego samego problemu, nie osobne zadanie. Świadome odstępstwo: koło wokół punktu użytkownika w gałęzi awaryjnej dostaje tempo dojścia, bo statystyki liczą ten punkt tempem dojścia; różnica widoczna tylko w trybie „rowerem do przystanku” z kierunkiem „do miejsca”. Gałąź bez capu jest uruchamiana tylko, gdy wczytanie geometrii miasta się nie powiedzie; wszystkie 18 miast ma komplet plików, Białystok i Rzeszów (bez `gridBbox`) budują siatkę ze swojego `bbox`, a w gałęzi z siatką obowiązuje cap 1000 m.
- Pliki: js/engine.js, js/isochrone.js; testy: tests/engine.test.mjs, tests/isochrone.test.mjs.
- Jak sprawdzić: 5 nowych testów w `tests/engine.test.mjs` i `tests/isochrone.test.mjs`. Po cofnięciu poprawki przez `git stash` cztery padają (pass 31, fail 4): promień pasma w trybie rowerowym 4422 m zamiast 14740 m, test `buildZones` 5192,3 zamiast 16200, dwa testy capu 240,38 zamiast 801,28; piąty (regresja dotychczasowego zachowania) przechodzi przed i po. `npm run check`: tests 484, pass 483, fail 0, skipped 1, lint czysty. Zmierzone: przy limicie spaceru 250 s promień dalekiego koła 240,4 m → 801,3 m; bez limitu pasmo „do 90 min” wokół przystanku osiąganego w 13,35 min 4422,1 m → 14740,4 m (oba razy 3,33, zgodnie ze stosunkiem prędkości). Sprawdzone w przeglądarce: Trójmiasto, tryb „rowerem w pojeździe”, limit spaceru 5 min — strona renderuje się, woda blokuje zasięg, konsola bez błędów; Białystok w trybie rowerowym bez błędów. Niezweryfikowane: wygląd po zmianie na pozostałych 16 miastach; realny zasięg po poprawce na danych produkcyjnych nieporównany z rozkładem; widok mobilny.

### Z-077 [P3] Dalekie koła wyglądają jak wynik pomiaru, a są zgadywaniem
- Status: zrobione
- Zgłoszone: 2026-11-20 (nieznane)
- Problem: płaski dysk 1 km dla przystanku dalej niż 1 km od siatki (349 pozycji w pasie 1–5 km, 455 powyżej 5 km, najdalej ok. 120 km) był nie do odróżnienia wizualnie od policzonej strefy. Dotyczyło 804 pozycji w 8 miastach (najwięcej: Warszawa 391, Kraków 146, Trójmiasto 95).
- Dowód: pomiar 2026-11-20 (patrz Z-007, luka 2).
- Wygląd i UX (wdrożone 2026-11-20): koła zasięgu szacunkowego w linii prostej są kreskowane pod 45 stopni na lekkim podkładzie w kolorze pasma; strefa policzona zostaje pełnym wypełnieniem. W legendzie nota „Kreskowane: zasięg szacunkowy, w linii prostej" z próbką wzoru, widoczna tylko wtedy, gdy wynik zawiera koła. Przy oddaleniu do zoomu ok. 9 i mniej kreskowanie znika, zostaje jednolite, jaśniejsze wypełnienie (świadome ustępstwo). Bez nowych tokenów, bez animacji i przejść.
- Pliki: js/map.js, index.html, css/style.css, tests/approx-circles.test.mjs.
- Jak sprawdzić: 4 nowe testy w `tests/approx-circles.test.mjs` (próg małej skali, znacznik legendy dla pustych i niepustych kształtów, pamięć podręczna wzorów, kontrakt noty i reguł jej pokazywania); `npm run check`: tests 488, pass 487, fail 0, skipped 1, lint czysty. Sprawdzone w przeglądarce: Trójmiasto (okolice Tczewa i Pruszcza Gdańskiego), Warszawa (Legionowo, Pruszków), Łódź bez kół i bez noty, przełączenie miast zdejmuje notę, widok 375 px, konsola bez błędów. Niezweryfikowane: Kraków, Poznań, Toruń, Bydgoszcz, Kielce; zwinięty panel z notą; wzór w powiększeniu pikselowym potwierdzony odczytem pikseli, nie obrazem.

### Z-071 [P2] Dymek przystanku spotkania z trasami obu osób i kopiowanie zaproszenia
- Status: zrobione
- Zgłoszone: 2026-11-19 (nieznane; etap drugi Z-004 wskazany przez właściciela)
- Problem: dymek wybranego przystanku na spotkanie jest statyczny (nazwa i dwa czasy); brak tras obu osób i przycisku „Kopiuj zaproszenie" z gotowym tekstem do wysłania.
- Dowód: wdrożenie Z-004 (2026-11-19), dymek przystanku spotkania.
- Pliki: js/engine.js, js/worker.js, js/uilogic.js, js/app.js, css/style.css, README.md, CURRENT_STATE.md; testy: tests/engine.test.mjs, tests/uilogic.test.mjs, tests/keyboard-journey.test.mjs.
- Jak sprawdzić: testy — 9 nowych w tests/engine.test.mjs, tests/uilogic.test.mjs, tests/keyboard-journey.test.mjs, dwa istniejące zaktualizowane; `npm run check`: tests 454, pass 453, fail 0, skipped 1, lint czysty. Sprawdzone w przeglądarce: dwie linie na mapie, znikają po zamknięciu dymka i po Escape; aktywacja pozycji listy bez myszy przenosi fokus do dymka, Escape oddaje go pozycji; przycisk ma 44 px; komunikat „Zaproszenie skopiowane do schowka." trafia do kanału dla czytnika; przy nieudanym kopiowaniu tekst zostaje w awaryjnym polu, zaznaczony; konsola bez błędów. Niezweryfikowane: prawdziwy schowek systemowy (testowano na podstawionej funkcji), czytnik ekranu, kliknięcie pinezki myszą, widok mobilny; awaryjne pole siedzi w panelu bocznym, więc przy zwiniętym panelu na telefonie może być niewidoczne (niesprawdzone); w małym oknie wysoki dymek z dwiema trasami wystaje u góry, tak samo jak dotychczasowy dymek porównania.

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
- Obserwacja 2026-11-17: `node tools/check-data.mjs` po ręcznym przeliczeniu Łodzi i Olsztyna zgłasza ostrzeżenie o utraconych metadanych pokrycia opóźnieniami dla Trójmiasta, Krakowa i Poznania. Te trzy miasta mają budy z 2026-11-16, sprzed wdrożenia tej poprawki, więc ostrzeżenie zniknie przy następnym przeliczeniu albo po ręcznym `node tools/build-delays.mjs`.
- Domknięcie obserwacji 2026-11-17: za zgodą właściciela uruchomiono `node tools/build-delays.mjs`; zmienione zostały wyłącznie `data/<miasto>/meta.json` wszystkich 18 miast (pole `delays`), pliki `delays.json` i rozkłady bez zmian. Pokrycie: Trójmiasto 170 z 187 linii (5052 klucze, źródło `gdansk-departures`), Poznań 155 z 213 (3965 kluczy, `gtfsrt`), Kraków 87 z 215 (2063 klucze, `gtfsrt`). Pozostałe 15 miast ma `routes: 0`, `keys: 0`; GZM i Szczecin mają `source: "gtfsrt"` przy zerowym pokryciu (to Z-019), reszta `source: null`. Bramka jakości nie zgłasza już zgubionych metadanych dla żadnego miasta. Sprawdzone w przeglądarce: stopka Trójmiasta pokazuje „170 z 187 linii (pomiary do 17.11.2026)"; przed zmianą wiersz był ukryty. Niezweryfikowane: odczyt stopki przez czytnik ekranu.

### Z-056 [P2] Wyszukiwanie przystanku po nazwie w załadowanych danych
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: wyszukiwarka adresów nie znajduje przystanków po nazwie; część B Z-015. Historia punktów (część A Z-015) jest na to przygotowana.
- Dowód: nieznane.
- Rozwiązanie (z wdrożenia fali 5, bez przeglądu rozwiazywacza; wdrożone 2026-11-16): wymaga nowego komunikatu workera `stops` — worker buduje kompaktowy indeks z `net` i odsyła go raz na miasto, leniwie przy pierwszym wpisanym znaku. Czyste funkcje w `js/uilogic.js`: `normalizeStopQuery`, `buildStopIndex`, `searchStops`, `mergeSearchResults`. Wyniki lokalne i z geokodera w jednej liście: przystanki na górze, chip tekstowy „przystanek" / „adres", `optionId` numeruje scaloną listę. `rememberPoint(label, latlng)` przyjmie też przystanek. Ocena analityka: średnie zadanie, nie drobne.
- Wdrożone 2026-11-16: nowy komunikat workera `stops`: worker buduje z `net` kompaktowy indeks nazw i odsyła go raz na miasto i typ dnia, leniwie przy pierwszym wpisanym znaku (galąź w `js/worker.js` z transferem buforów `lat`/`lon`; błąd idzie do `reportError` i do wiadomości `error`). `Engine.stopIndex(dayKey)` w `js/engine.js` buduje indeks z `loadDay` (trafienie w cache) albo zwraca null. W `js/uilogic.js`: `normalizeStopQuery` (lowercase, jawne `ł` -> `l`, NFD bez znaków łączących, nie-alfanumeryczne na spacje), `buildStopIndex`, `searchStops` (memo znormalizowanych nazw w `index._norm`; priorytet: prefiks całej nazwy, prefiks słowa, podciąg; w obrębie rangi krótsza nazwa wyżej), `mergeSearchResults` (przystanki zawsze na górze), stałe `STOP_QUERY_MIN` = 2 i `STOP_CLUSTER_KM` = 1. `js/app.js`: `stopIndex` w obu klientach silnika (worker i direct), leniwy cache indeksu na miasto i dzień, debounce 150 ms, limit 5 wyników lokalnych, scalanie z geokoderem, render wiersza (ikona `🚏`/`📍` z `aria-hidden`, chip, `aria-label` np. „Wrzeszcz PKP, przystanek"), `pick()` bierze `r.label`, wybór przystanku idzie przez `rememberPoint` do historii. Gdy geokoder padnie, przystanki zostają, a komunikat idzie do `#searchStatus`; dotyczy obu wyszukiwarek w trybie porównania. `css/style.css`: `gap: 8px` w wierszu wyników, klasy `.res-icon`, `.res-name`, `.res-kind`, chip `9.5px` przy `max-width: 560px`; bez nowego koloru i bez nowego `var(--tap)`. `README.md`: akapit o wyszukiwarce. Zmiana zakresu względem projektu: skupiska przystanków liczone odległością do już przyjętych przystanków o tej samej nazwie, próg `STOP_CLUSTER_KM` = 1 km, zamiast klucza siatkowego (nazwa + komórka 0,01°) z pierwotnego projektu — klucz dawał dwa identyczne wiersze, gdy zespół leżał na granicy komórki („Wrzeszcz PKP" w Trójmieście pokazywał się dwa razy). Poprawione przed commitem przez wątek główny. Ta sama nazwa dalej niż kilometr (np. „Ratuszowa" w dwóch dzielnicach) nadal daje osobne wpisy.
- Pliki: js/uilogic.js, js/engine.js, js/worker.js, js/app.js, css/style.css, README.md; testy: tests/uilogic.test.mjs (w tym dwa przypadki skupisk: zespół na granicy komórki daje jeden wpis, ta sama nazwa 2,2 km dalej dwa), tests/search-aria.test.mjs (chip i `aria-label`, ciągła numeracja `id` scalonej listy, `r.label` zamiast `textContent`, CSS chipa), tests/front-diag.test.mjs (asercja liczby `reportError` w `worker.js` podniesiona z 2 do 3, bo doszedł trzeci `catch`).
- Sprawdzone w przeglądarce (Trójmiasto): wpisanie „wrzesz" bez Entera daje pięć przystanków z ikoną i chipem, status „Enter szuka też adresów.", zero zapytań do Nominatim (mierzone przez `performance.getEntriesByType`); „wrzesz" daje pięć różnych przystanków, „Wrzeszcz PKP" tylko raz; Enter na „Długa" dokleja adresy pod przystankami, a podczas zapytania lista przystanków zostaje ze statusem „Szukam adresu…"; strzałkami przez całą scaloną listę, w tym zawinięcie, `aria-activedescendant` wskazuje istniejące `id` na każdym kroku; klik w przystanek ustawia punkt, zmienia `p=` w adresie, zostawia w polu czystą etykietę i dopisuje wpis do historii; przy 360 px wiersz ma 44 px, chip się mieści, nazwa nie jest ucinana; zero nowych błędów w konsoli.
- Niezweryfikowane: wygląd oceniony z DOM i wyliczonych styli, nie ze zrzutu ekranu (panel podglądu nie zdążył narysować strony) — kontrast chipa i stan `.active` sprawdzone tylko z CSS; komunikat o błędzie geokodera nie był wywołany na żywo; stan „dane miasta jeszcze się ładują" nie testowany na żywo; ścieżka `engine=main` sprawdzona tylko w kodzie; czas dopasowania na ok. 15 tys. nazw nie był mierzony; czytnik ekranu nie był użyty.

### Z-058 [P2] Niespójne końcówki linii w repozytorium
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: `js/calendar.js`, `js/walkgrid.js` i `tests/a11y-css.test.mjs` miały końcówki CRLF, reszta plików LF. `tests/front-diag.test.mjs` szuka dosłownego `"\n}\n"`, więc rozjazd mógł wywalić testy po edycji niewłaściwym narzędziem.
- Dowód: nieznane (zgłoszone przy wdrożeniu Z-056, 2026-11-16).
- Wdrożone 2026-11-16: nowy `.gitattributes` w korzeniu: `* text=auto eol=lf`, z wyłączeniem konwersji dla `*.png`, `*.zip`, `*.ico`, `*.woff2`; trzy wymienione pliki przekonwertowane z CRLF na LF, treść bez zmian. Od teraz jedna konwencja w repozytorium, a checkout na Windowsie daje LF. `npm run check` po zmianie (wynik podany przez wątek główny): 269 testów, 268 pass, 0 fail, 1 skipped, lint czysty.
- Pliki: .gitattributes (nowy), js/calendar.js, js/walkgrid.js, tests/a11y-css.test.mjs.
- Domknięcie 2026-11-17: konwersja CRLF na LF objęła wszystkie pliki śledzone przez git, bo `tools/check-data.mjs` też miał CRLF i edycja narzędziem zakładającym LF nie trafiała we wzorzec. Zmienione (treść bez zmian): `.github/workflows/refresh-data.yml`, `CLAUDE.md`, `CURRENT_STATE.md`, `README.md`, `tools/build-bridges.mjs`, `tools/check-data.mjs`, `tools/geo.mjs`, `vendor/leaflet/leaflet.css`. Otwarty drobiazg: `.claude/agents/*.md` (sześć plików) nadal ma CRLF; `CLAUDE.md` pozwala je ruszać tylko na wyraźną prośbę właściciela, więc zostały nietknięte — do zrobienia przy najbliższej zmianie definicji agentów. `npm run check` po domknięciu: 270 testów, 269 pass, 0 fail, 1 skipped, lint czysty.

### Z-052 [P2] Ostrzeżenie `overtaking` było stałym szumem
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: bramka zapala ostrzeżenie przy każdym `overtaking > 0`, gdy poprzedni build ma to pole. Czy to szum, da się ocenić dopiero na realnych wartościach po następnym buildzie — dziś nie ma ich w `meta.json`.
- Dowód: pole `counts.days.<dzień>.overtaking` wprowadzone przy Z-005; ostrzeżenie w tools/check-data.mjs.
- Wdrożone 2026-11-17: po przeliczeniu Łodzi bramka zgłosiła „niedziela: 1 wzorców z wyprzedzaniem kursów (było 1)" — alarm przy niezmienionej wartości. Warunek rozszerzony o `f.overtaking > b.overtaking`: ostrzeżenie tylko przy wzroście liczby wzorców z wyprzedzaniem; stała wartość i spadek są ciche. Brak pola po którejkolwiek stronie dalej oznacza pominięcie; ostrzeżenie nie blokuje publikacji. Test: nowy przypadek „niezmieniona liczba nie ostrzega (Z-052)" w `tests/check-data.test.mjs`. `node tools/check-data.mjs` na realnych danych zgłasza teraz problem w 1 z 18 miast (Opole, zgodnie z Z-051/Z-054), wcześniej w 2.
- Pliki: tools/check-data.mjs; testy: tests/check-data.test.mjs.

### Z-059 [P1] Zwijane sekcje panelu i przypięta stopka (decyzja właściciela)
- Status: zrobione
- Zgłoszone: 2026-11-17 (właściciel)
- Problem: panel sterowania jest bardzo długi, pod nim wyświetla się pusta przestrzeń, a dopiero pod nią dane kontaktowe.
- Dowód: pomiar wątku głównego w przeglądarce, 2026-11-17, Trójmiasto, okno 800 px: `#panelBody` ma `scrollHeight` 1244 px przy `clientHeight` 663 px (prawie 600 px przewijania); `footer.credits` zaczyna się na 1182 px. Pusta przestrzeń nie występuje lokalnie: `#adBox` jest ukryty (wysokość 0), a treść jest ciągła. Hipoteza estety: na produkcji jednostka AdSense rezerwuje wysokość bez wypełnienia (`<ins>` ma inline `style="display:block"` i `data-full-width-responsive="true"`, etykieta „Reklama" jest ukryta). Komentarz w `css/style.css` mówi, że witryna czeka na zatwierdzenie AdSense. Do sprawdzenia na produkcji po zgodzie: czy `ins.adsbygoogle` ma inline `height` i `data-ad-status="unfilled"`.
- Rozwiązanie (rozwiazywacz): nieznane — brak przeglądu rozwiazywacza. Zalecenie estety do wdrożenia po potwierdzeniu na produkcji: `.ad-box:has(ins[data-ad-status="unfilled"]) { display: none }`; nie dodawać `min-height` na boksie reklamy.
- Wygląd i UX (esteta, 2026-11-17): natywne `<details>`/`<summary>` dla trzech sekcji panelu (Czas i kierunek, Dojście i środki transportu, Opóźnienia i statystyki), domyślnie zamkniętych; stopka „Dane i kontakt" przypięta na dole panelu. Nagłówek sekcji pokazuje bieżące wartości w jednej linii z wielokropkiem. Nienegocjowalne: bez animacji wysokości; stan sekcji nie trafia do URL; `#status`, `#diagBox` i `#dataWarn` nie w zamkniętych sekcjach; pamięć stanu w `localStorage` w `try/catch`; żadnych nowych tokenów.
<details>
<summary>Pełna specyfikacja estety</summary>

Mechanizm: natywne `<details>`/`<summary>`. Powody: Enter i Spacja działają bez JS; Tab omija zawartość zamkniętej sekcji; stan „zwinięte/rozwinięte" podawany natywnie, bez ręcznego `aria-expanded`; wyszukiwanie na stronie samo otwiera pasującą sekcję; wzorzec jest już w projekcie (`.diag`). Cena: brak animacji wysokości, zgodnie z `prefers-reduced-motion`.

Układ panelu od góry:
1. Zawsze widoczne: miasto, tryb, wyszukiwarka(i) adresu, podpowiedź, intro, ostrzeżenie o danych.
2. Zawsze widoczny wynik: legenda, status, `#zoneSummary`, `#diagBox`.
3. Sekcja „Czas i kierunek" (fieldsety Czas z `#dayNote` oraz Kierunek) — domyślnie zamknięta.
4. Sekcja „Dojście i środki transportu" — domyślnie zamknięta.
5. Sekcja „Opóźnienia i statystyki" (tryb ostrożny z `#safeNote`, przełącznik statystyk i `#statsBox`) — domyślnie zamknięta.
6. Zawsze widoczne: dwa przyciski w jednym rzędzie po 50 procent („Kopiuj link" i „Pobierz strefy", pełny `aria-label` „Pobierz strefy (GeoJSON)"), pod nimi `#adBox` bez rezerwacji miejsca.
7. Sekcja „Dane i kontakt" przypięta na dole panelu, poza `#panelBody`, `flex: none`: źródła, daty rozkładu, kontakt, przycisk kawy. Domyślnie zamknięta, widoczna jako wiersz 44 px. Po otwarciu treść ma `max-height: 28vh` i własne przewijanie.

Pierwsza wizyta: wszystkie sekcje zamknięte. Jedyne automatyczne otwarcie: „Czas i kierunek", gdy `#dayNote` jest niepusty (komunikat o święcie z przyciskiem, Z-022). Opcje przyniesione linkiem sekcji nie otwierają jej; sygnalizuje je znacznik w nagłówku.

Pamięć stanu: `localStorage`, jeden klucz z mapą `{id: bool}`, zapis w zdarzeniu `toggle`, odczyt i zapis w `try/catch` wzorem `consentGet`. Do adresu URL nie trafia nic; format linków zostaje nietknięty.

Nagłówek sekcji: zawsze bieżące wartości, nie tylko zmienione. Jedna linia z wielokropkiem. Przykłady: „08:15 · dzień roboczy · z miejsca", „pieszo · wszystkie środki", „standardowo", „rozkład z 2026-11-10". Przy liście środków do trzech nazw, powyżej „3 z 5 środków". Stan odbiegający od domyślnego: tekst `--muted` na `--ink`, waga 600, kropka 8 px w `--accent` (`aria-hidden`) oraz ukryte `.sr-only` „— zmienione ustawienia". Podsumowanie bez `aria-live`.

Forma `<summary>`: płaski wiersz z `border-top: 1px solid var(--line)`, `min-height: var(--tap)`, `padding: 6px 0`, cały wiersz klikalny. Tytuł 11 px, waga 600, uppercase, `letter-spacing: .06em`, `--muted` (wzór `.control legend`); pod nim podsumowanie 12,5 px. Chevron 20 px po prawej, obrót o 90 stopni przy otwarciu, `transition: transform 120ms` objęte globalnym wyłącznikiem `prefers-reduced-motion`. Focus: `outline: 2px solid var(--accent); outline-offset: -2px` (offset ujemny, bo panel ma `overflow`).

Szacunek skrócenia (z reguł CSS, nie pomiar): panel mobilny ok. 1112 px treści plus 62 px nagłówka dziś; ok. 513 px treści plus 44 px przypiętej stopki po zmianie. Zysk ok. 550 px (ok. 47 procent). Przewijanie spada z ok. 780 do ok. 180 px.

Pułapki do wdrożenia:
- Elementy w zamkniętym `<details>` mają `offsetHeight` 0 i nie przyjmują focusu. Kod mierzący je albo ustawiający na nich focus (np. `#dayNote button`) musi najpierw otworzyć sekcję.
- Krok 3 wskazówki pierwszej wizyty (`index.html`, „Ustaw godzinę i typ dnia…") prowadziłby do ukrytej kontrolki. Tekst trzeba poprawić.
- Nie przenosić `#status`, `#diagBox` ani `#dataWarn` do zamkniętych sekcji.
- Nie wpisywać stanu sekcji do adresu URL. Nie robić animacji wysokości. Nie dublować nazw: wewnątrz sekcji żadnego drugiego `<h2>` obok `summary`; fieldsety zostają z `legend`.

</details>

- Scalone: Z-036 (zadanie wchłonięte; patrz sekcja „Odrzucone").
- Wdrożone 2026-11-17: trzy `<details class="sec">` w `#panelBody` (`secTime`, `secAccess`, `secDelay`), domyślnie zamknięte; sekcja „Dane i kontakt" (`secData`) jako ostatnie dziecko `.panel`, poza przewijanym `#panelBody`, razem z `footer.credits` i przyciskiem kawy. Nowy rząd `.action-row` z przyciskami „Kopiuj link" i „Pobierz strefy" po 50 procent; drugi ma pełny `aria-label`. Krok 3 wskazówki pierwszej wizyty wskazuje sekcję „Czas i kierunek". Stan sekcji w `localStorage` (klucz `panel-sections`, `try/catch`), poza adresem URL; auto-otwarcie „Czas i kierunek" przy niepustym `#dayNote` nie jest zapisywane jako wybór użytkownika. Czyste funkcje w `js/uilogic.js`; `.ad-box:has(ins[data-ad-status="unfilled"])` ukrywa boks reklamy bez wypełnienia; zero nowych tokenów i kolorów.
- Pomiar po wdrożeniu (Trójmiasto, 1024x768; potwierdzone też przy 800 px): `#panelBody` `scrollHeight` 550 przy `clientHeight` 550, czyli bez przewijania (przed: 1243 przy 663). Wiersz „Dane i kontakt" widoczny bez przewijania (górna krawędź 639 px przy oknie 768 px). Odstęp 26 px nad stopką to margines rzędu 10 px i dolny padding `#panelBody` 16 px. Przy 360x740 brak poziomego przewijania; przy 360 px treść otwartej „Dane i kontakt" ma 151 px przy limicie 207 px.
- Pliki: index.html, css/style.css, js/uilogic.js, js/app.js, tests/uilogic.test.mjs, tests/mobile-layout.test.mjs, tests/a11y-css.test.mjs, README.md, CURRENT_STATE.md.
- Niezweryfikowane: pusta przestrzeń nad stopką na produkcji z włączonym AdSense (lokalnie `#adBox` ukryty, zabezpieczenie `:has`, bez `min-height`); naturalny komunikat `#dayNote` nie wystąpił w żadnym z 18 miast (auto-otwarcie sprawdzono na zmienionym `meta.json` Torunia); czytnik ekranu i prawdziwe urządzenie dotykowe nie były używane.
- Jak sprawdzić: `npm run check`: 296 testów, 295 pass, 0 fail, 1 skipped, lint czysty (wynik podany w zleceniu); w przeglądarce: czysty profil, klawiatura (Tab, Enter, Spacja), podsumowania, przeładowanie, adres URL bez zmian, 360 px.

### Z-060 [P2] Pięć drobnych usterek: czytnik ekranu, Enter, schowek, lokalizacja, kolory
- Status: zrobione
- Zgłoszone: 2026-11-17 (analityk)
- Problem: pięć niezależnych usterek znalezionych przez analityka. Każda da się odhaczyć osobno.
- Dowód: obserwacje analityka 2026-11-17.
  - [x] 1. Komunikaty lokalizacji i eksportu nie docierają do czytnika ekranu: `#status` ma `aria-live="off"` (celowo, Z-045) i jest czytany tylko przez `announce()`, a pięć komunikatów omija tę funkcję: „Ustalam lokalizację…", błąd geolokalizacji, „Jesteś poza obszarem…", „Zapisano plik…", „Nie udało się przygotować pliku…".
  - [x] 2. Enter przy dwóch znakach nic nie robi: `typeSearch` dopuszcza 2 znaki i obiecuje „Enter szuka też adresów.", a obsługa Enter wychodzi po cichu przy mniej niż trzech znakach. Wygląda jak zawieszona wyszukiwarka.
  - [x] 3. Awaryjna ścieżka przycisku „Kopiuj link" gubi adres: przy odmowie schowka adres ląduje w etykiecie przycisku i znika po 2000 ms, zanim da się go zaznaczyć. Dotyczy HTTP, iframe i odmowy dostępu do schowka.
  - [x] 4. Wyłączony `#locateBtn` nie mówi dlaczego: powód jest tylko w `title`, którego nie ma na dotyku ani w czytniku ekranu, i brak stylu `:disabled`.
  - [x] 5. Kolory na sztywno w `css/style.css` wbrew zasadzie „nowy kolor = token w `:root`": tło `#f4f4f2`, kropki `.dot-a` `#2a81cb` i `.dot-b` `#e8722d`, cienie `rgba(28, 28, 40, …)` w czterech miejscach. Tokeny `--dot-a` i `--dot-b` są już założone w specyfikacji trybu ciemnego Z-044.
- Rozwiązanie (rozwiazywacz): nieznane — brak projektu rozwiązania.
- Wygląd i UX (esteta): nieznane — brak specyfikacji dla tego zadania.
- Wdrożone i wypchnięte w commicie 29b0d6b (data wdrożenia nieznana; zapis 2026-11-17). Wszystkie pięć punktów:
  1. Helper `say()` w `js/app.js` prowadzi pięć komunikatów przez `announce()`; `aria-live="off"` na `#status` bez zmian (Z-045).
  2. Enter przy jednym lub dwóch znakach pokazuje w `#searchStatus` „Wpisz co najmniej 3 znaki, aby szukać adresu." i zostawia przystanki na ekranie; próg trzech znaków dla Nominatim zostaje; Enter dogania odroczone `typeSearch` (150 ms).
  3. Awaryjna ścieżka „Kopiuj link" używa trwałego pola `#shareText` z zaznaczoną treścią (wzór `#diagText`, Z-025); pole znika przy udanym kopiowaniu i przy każdym przeliczeniu.
  4. Wyłączony `#locateBtn` ma `aria-disabled` zamiast `disabled` (zostaje w kolejności tabulatora) oraz `aria-describedby` wskazujące trwały `#locateHint`; `title` usunięty; nowa czysta funkcja `locateUnavailableReason(secure, hasGeo)` w `js/uilogic.js`.
  5. Nowe tokeny w `:root`: `--map-bg`, `--dot-a`, `--dot-b`, `--shadow-rgb`; wszystkie kolory na sztywno podmienione, wartości identyczne, zero różnicy wizualnej; cienie zachowują cztery różne przezroczystości; nowy test w `tests/a11y-css.test.mjs` pilnuje, że poza `:root` nie ma wartości koloru zapisanej na sztywno (lista wyjątków pusta).
- Pliki: js/app.js, js/uilogic.js, css/style.css, tests/a11y-css.test.mjs. Pozostałe pliki nieznane w zleceniu.
- Jak sprawdzić: `npm run check`: 278 testów, 277 pass, 0 fail, 1 skipped, lint czysty (wynik podany w zleceniu); weryfikacja ręczna każdego punktu: nieznane.

### Z-057 [P2] Współrzędne przystanku przez Float32Array i przebudowa indeksu przy zmianie dnia
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: współrzędne przystanku przechodzą przez `Float32Array`, więc punkt ustawiony z podpowiedzi ma dokładność rzędu metra (54.49620819 zamiast 54.49621). W adresie strony i tak są pięć miejsc po przecinku, więc skutek jest dziś niewidoczny. Przy okazji: przy zmianie typu dnia indeks przystanków jest budowany od nowa dla klucza miasto/dzień, mimo że dane dnia są w cache.
- Dowód: obserwacja przy wdrożeniu Z-056 (2026-11-16).
- Pliki: js/worker.js, js/app.js, js/engine.js.
- Wdrożone 2026-11-17: `buildStopIndex` zwraca `lat`/`lon` jako `Float64Array`; wartość z podpowiedzi trafia do stanu aplikacji i do historii ostatnich punktów bez zaokrąglania. Koszt policzony przed zmianą: 8 bajtów na wpis, ok. 28 kB więcej w komunikacie `stops` dla GZM (3544 wpisy); uznano za akceptowalne, bufory dalej idą transferem, `js/worker.js` bez zmian. Starsze wpisy w historii ostatnich punktów zachowują dawną wartość. Cache indeksu: zamiast jednego wpisu `stopIdx` mała mapa po kluczu miasto plus dzień, limit 3; nowa czysta funkcja `createAsyncCache(limit = 3)` w `js/uilogic.js` (najstarszy wpis wypada; błąd i wynik `null` nie zostają w cache). Zmienione pliki (zlecenie wdrożeniowca dla trzech zadań): js/uilogic.js, js/app.js, tests/uilogic.test.mjs, tests/stops.test.mjs (nowy), tests/a11y-css.test.mjs.
- Zweryfikowane w przeglądarce (Trójmiasto): wybór „Wrzeszcz PKP" ustawia punkt na 54.38125, 18.60442; `data/trojmiasto/workday.json` ma dla tego przystanku dokładnie te same wartości.
- Niezweryfikowane: podgląd na telefonie; ścieżka `engine=main` w przeglądarce (w testach odpowiada jej `Engine.stopIndex`, Z-061).

### Z-061 [P2] Brak testów ścieżki workera `stops`
- Status: zrobione
- Zgłoszone: 2026-11-17 (analityk)
- Problem: obsługa komunikatu `stops` w `js/worker.js` oraz `getStopIndex` w `js/app.js` (cache na miasto i dzień, odrzucenie wyniku po zmianie miasta) nie mają żadnego testu. Czyste funkcje mają pokrycie w `tests/uilogic.test.mjs`. Regresja w ścieżce błędu, na przykład zwrot `null` po zmianie miasta, nie zostanie złapana przez `npm run check`. Rozmiar: średni, bo część logiki siedzi w `app.js`.
- Dowód: obserwacja analityka 2026-11-17; zazębia się z Z-034 (zrobione) i Z-056 (wdrożone).
- Rozwiązanie (rozwiazywacz): nieznane — brak projektu rozwiązania.
- Pliki: js/worker.js, js/app.js, tests/stops.test.mjs (nowy).
- Wdrożone 2026-11-17: `tests/stops.test.mjs` (nowy, 8 testów) wzorem `tests/engine.test.mjs`: podmieniony `fetch`, bez prawdziwego workera. Pokryte: `Engine.stopIndex` zwraca indeks dla załadowanego miasta, `null` dla niezaładowanego oraz `null`, gdy miasto zmieni się w trakcie budowy (wstrzymany `fetch`); błąd pobrania odrzuca obietnicę, worker zamienia to na komunikat `error`, a w `app.js` kończy się wartością `null`. Cache: drugie wywołanie nie przelicza (licznik wywołań i tożsamość obiektu), błąd nie zostaje w cache i kolejna próba ponawia, wynik `null` nie jest zapamiętywany, limit wyrzuca najstarszy wpis.
- Znana luka: strażnik `state.city === city` w `getStopIndex` zostaje w `js/app.js`, który wymaga DOM; nie jest pokryty testami świadomie.
- Jak sprawdzić: `npm run check`: 305 testów, 304 pass, 0 fail, 1 skipped, lint czysty (wynik dosłowny w CHANGELOG.md, sekcja 2026-11-17).

### Z-062 [P2] Spójność reguł `summary` w inwentarzu dostępności
- Status: zrobione
- Zgłoszone: 2026-11-17 (wdrozeniowiec)
- Problem: inwentarz kontrolek 44 px w `tests/a11y-css.test.mjs` obejmuje także `.diag summary`. Po Z-059 ten sam wzorzec (`summary` jako pole dotykowe) występuje w czterech sekcjach panelu. Do sprawdzenia: czy inwentarz nie powiela reguł i czy wszystkie `summary` w projekcie mają spójny styl.
- Dowód: tests/a11y-css.test.mjs (inwentarz kontrolek 44 px; `.sec > summary` dopisane przy Z-059); zgłoszenie wdrożeniowca przy Z-059, 2026-11-17.
- Rozwiązanie (rozwiazywacz): nieznane — brak projektu rozwiązania.
- Wygląd i UX (esteta): nieznane — brak specyfikacji dla tego zadania.
- Pliki: tests/a11y-css.test.mjs, css/style.css.
- Wdrożone 2026-11-17: przegląd wypadł dobrze. Wszystkie pięć elementów `<summary>` w `index.html` jest pokrytych (`.sec > summary` cztery razy oraz `.diag summary`), reguły się nie powielają, każdy ma `min-height: var(--tap)`, a `.sec-pinned` nie nadpisuje wysokości. CSS nie wymagał zmian (`css/style.css` bez zmian), nie dopisano wyjątku. Luka była w samym teście: sprawdzał tylko istnienie odpowiedniej reguły, więc nie wyłapałby nowego `<details>` o innym stylu. Dopisany test wymaga, żeby każdy `<summary>` w `index.html` był pod `.sec` albo w `.diag`, i żeby żadna reguła `summary` w CSS nie ustawiała wysokości innej niż `var(--tap)`.
- Jak sprawdzić: `npm run check`: 305 testów, 304 pass, 0 fail, 1 skipped, lint czysty (wynik dosłowny w CHANGELOG.md, sekcja 2026-11-17).

### Z-008 [P2] Tryb czystego widoku i eksport
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak trybu bez panelu oraz eksportu wyniku do PNG lub GeoJSON.
- Dowód: nieznane.
- Wdrożone 2026-11-16 (część C, eksport GeoJSON): przycisk „Pobierz strefy (GeoJSON)" pod „Kopiuj link do tego widoku" zapisuje aktualne strefy jako `FeatureCollection` z sześcioma `MultiPolygon` (źródło: `contours` z `buildContours`, nie siatka czasów). Właściwości simplestyle plus metadane powielone w `properties`; współrzędne `[lon, lat]` zaokrąglone do 5 miejsc, nawijanie wg RFC 7946. Pobranie przez `Blob` i ukryty `<a download>`, bez zależności. Nazwa `izochrona-<miasto>-<yyyymmdd>-<HHMM>.geojson`. Zmierzone: Trójmiasto, plik 1,93 MB, generowanie ok. 26 ms. Odstępstwo: pominięto zdanie „Plik zawiera osiągnięte przystanki, nie obszary" (przy `walk=false` też powstają wielokąty).
- Eksport PNG wydzielono do nowego zadania Z-063 (2026-11-17).
- Rozstrzygnięcie (2026-11-17, esteta): osobny tryb czystego widoku odrzucony. Istniejące zwijanie panelu (`#collapseBtn`, `body.panel-collapsed`) już chowa całą treść i zostawia pasek nagłówka ok. 70 px, a `--panel-h` sam przesuwa zoom i atrybucję; osobny tryb dublowałby stan, przycisk i obsługę focusu. Odrzucono też wiązanie klawisza Escape z rozwijaniem panelu (Escape zamyka dziś listę wyszukiwania, dialog pomocy i dymek mapy), drugi przycisk na mapie oraz wpisywanie stanu zwinięcia do adresu URL. `buildQuery` i `parseUrlState` nietknięte. Zamiast tego jako rozszerzenie zwijania: legenda widoczna przy zwiniętym panelu, poprawka `aria-label` przycisku zwijania oraz komunikat dla czytnika ekranu.
- Znaleziony błąd (w ramach powyższego, bez osobnego numeru): po zwinięciu panelu `aria-label` przycisku nadal brzmi „Zwiń panel", mimo że przycisk rozwija. Zmienia się tylko widoczny znak i `aria-expanded`.
- Wdrożone 2026-11-17 (domknięcie, rozszerzenie zwijania panelu):
  - Legenda widoczna przy zwiniętym panelu: jedna legenda w DOM w `.panel-body` (`role="group"`, `aria-labelledby="legendTitle"`), stan zwinięty pokazuje tylko ją (reguła `.panel.collapsed .panel-body > :not(.legend)`); w stanie zwiniętym `.legend` ma `margin: 0; padding: 8px 18px 12px`, bez własnego tła i cienia. Zero nowych tokenów i kolorów, zero animacji.
  - `aria-label` przycisku `#collapseBtn` przełącza się „Zwiń panel" / „Rozwiń panel" razem z `aria-expanded`; widoczny znak („−" / „+") bez zmian.
  - Ogłaszanie stanu: „Panel zwinięty. Widać samą mapę i legendę." oraz „Panel rozwinięty." zapisywane bezpośrednio do `#zoneSummary` (`role="status"`, `aria-live="polite"`), nie przez `say()` ani `announce()`; region czyszczony i wypełniany po 50 ms. Nic nie jest ogłaszane przy starcie strony, focus zostaje na przycisku.
  - Źródło rozkładów na telefonie przy zwiniętym panelu: reguła `body:not(.panel-collapsed) .attr-extra { display: none }` zamiast dawnego ukrywania doklejki; atrybucja OpenStreetMap z Leaflet widoczna zawsze.
  - Zmierzone (przeglądarka, Trójmiasto): desktop 1024 px, panel rozwinięty 666 px, zwinięty 143 px. Przy 360 px: rozwinięty 459 px, zwinięty 143 px; `--panel-h` przelicza się (offset kontrolek mapy zmienił się z 466,8 na 150 px). Legenda: 50 px rozwinięta, 70 px zwinięta (z paddingiem), sześć komórek z nagłówkiem „Czas podróży [min]". Odstępstwo od specyfikacji estety: szacowano zwinięty panel na ok. 105 px, wyszło 143 px, bo sama legenda z nagłówkiem ma 50 px.
  - Potwierdzone niezależnie przez wątek główny: po zwinięciu w DOM jest jedna legenda, widoczna; `aria-label` to „Rozwiń panel"; `aria-expanded` to „false"; `#zoneSummary` zawiera „Panel zwinięty. Widać samą mapę i legendę.".
  - Znane ryzyko: ogłoszenie stref oczekujące w momencie kliknięcia może po swojej sekundzie nadpisać komunikat o panelu.
  - Testy: dwa nowe w `tests/mobile-layout.test.mjs` (legenda przy zwiniętym panelu; `aria-label` i oba teksty komunikatu) plus poprawiony test doklejki atrybucji; `TAP_USES_MIN` bez zmian (23). `npm run check`: wynik dosłowny w CHANGELOG.md, sekcja 2026-11-17.
- Pliki: js/walkgrid.js, js/worker.js, js/uilogic.js, js/app.js, index.html, css/style.css, tests/mobile-layout.test.mjs. Przy domknięciu: `css/style.css`, `js/app.js` (handler `#collapseBtn`), `tests/mobile-layout.test.mjs`; `index.html` bez zmian; `README.md` i `CURRENT_STATE.md` bez zmian (zwijanie panelu nie było w nich opisane).
- Niezweryfikowane: otwarcie pliku w QGIS, faktyczne pobranie pliku przez przeglądarkę, wygląd stanu `:disabled` (z 2026-11-16); odczyt prawdziwym czytnikiem ekranu (sprawdzono tylko treść regionu i atrybuty); wygląd legendy w stanie zwiniętym nie przeszedł przeglądu estety; obrót ekranu przy zwiniętym panelu.

### Z-064 [P1] Usunięcie bloku AdSense
- Status: zrobione
- Zgłoszone: 2026-11-17 (właściciel, „usunięcie bloku AdSense")
- Problem: pusta przestrzeń między treścią panelu a danymi kontaktowymi. Najmocniejsza hipoteza: niewypełniona jednostka AdSense rezerwuje miejsce. Usunięcie bloku rozwiązuje to u źródła.
- Dowód: stan kodu ustalony przez wątek główny 2026-11-17 (numery linii nieznane): `index.html` — `<div class="ad-box" id="adBox" hidden>` z `<ins class="adsbygoogle">` w `#panelBody` przed przypiętą sekcją „Dane i kontakt"; `js/app.js` — `loadAds()` odkrywa blok i woła `adsbygoogle.push` dopiero po zgodzie na pliki cookie; `css/style.css` — reguły `.ad-box`, ukryta etykieta „Reklama" oraz `.ad-box:has(ins[data-ad-status="unfilled"]) { display: none }` (Z-059); komentarz w CSS mówi o czekaniu na zatwierdzenie AdSense („Faza 2").
- Rozstrzygnięte 2026-11-17 przez właściciela:
  - Zakres: usunięte w całości, razem ze skryptem.
  - Treść banera zgody: „Skróć do samych statystyk". Nowa treść dosłownie: „Strona korzysta z Google Analytics (anonimowe statystyki) — pliki cookie zapisywane tylko po zgodzie."
  - Z-032, Z-001 i Z-038 nie są zamknięte; przy każdym dopisano zdanie o nowej sytuacji (sekcja „Nowe").
- Powiązanie: Z-065 (zwolnione miejsce w panelu), wdrożone razem.
- Wdrożone 2026-11-17: z `index.html` usunięto meta `google-adsense-account`, blok `<div class="ad-box" id="adBox">` z `<ins class="adsbygoogle">`, funkcję `window.loadAds` i jej dwa wywołania. Z `css/style.css` usunięto `.ad-box`, `.ad-box[hidden]`, `.ad-label` oraz regułę `.ad-box:has(ins[data-ad-status="unfilled"])` (Z-059). Zgoda na cookies zostaje: baner, `consentGet`/`consentSet` i warunkowe ładowanie GA działają bez zmian. Dialog pomocy mówi: „Google Analytics (statystyki) działa wyłącznie po wyrażeniu zgody". Wysokość panelu bez zmian: 548 px na desktopie.
- Testy: `tests/support-ui.test.mjs` (nowy, 5 testów; w tym brak śladów AdSense w HTML i CSS oraz dosłowna treść banera z kontrolą, że baner, `consentGet`/`consentSet` i `loadGA` zostają); `tests/uilogic.test.mjs` — usunięty test reguły `:has(unfilled)`, bo dotyczył usuniętej reguły.
- Pliki: index.html, css/style.css, tests/support-ui.test.mjs (nowy), tests/uilogic.test.mjs, README.md, CURRENT_STATE.md.
- Jak sprawdzić: `grep` po `index.html`, `css/style.css` i `js/*.js` bez trafień `adsbygoogle`, `googlesyndication`, `ad-box`, `adBox`, `loadAds`, `google-adsense` (wątek główny); w przeglądarce: baner z nową treścią, brak skryptu reklamowego, „Zgoda" zapisuje zgodę, chowa baner i ładuje GA bez błędu w konsoli (wątek główny). `npm run check`: wynik dosłowny w CHANGELOG.md, sekcja 2026-11-17 (wspólny z Z-065).
- Niezweryfikowane: nieznane.

### Z-065 [P2] Przycisk wsparcia widoczny zawsze
- Status: zrobione
- Zgłoszone: 2026-11-17 (właściciel, „przycisk do suppi widoczny zawsze")
- Problem: przycisk wsparcia (`a.coffee-btn`) trafił przy Z-059 do przypiętej sekcji „Dane i kontakt", która jest domyślnie zamknięta. Przycisk jest niewidoczny, dopóki użytkownik sam nie rozwinie tej sekcji. Przed Z-059 stał w głównej kolumnie panelu i był widoczny po przewinięciu.
- Oczekiwanie właściciela: przycisk ma być widoczny zawsze, bez rozwijania czegokolwiek.
- Dowód: układ po Z-059 (sekcja „Zrobione"); `a.coffee-btn` wewnątrz przypiętej, zwiniętej domyślnie sekcji „Dane i kontakt" w `index.html`; numer linii nieznany.
- Otwarte pytania (projekt: esteta), rozstrzygnięte:
  - Gdzie w panelu: w nagłówku, obok „?" i przycisku zwijania, bez odbudowy długości panelu. Wariant ikonowy zatwierdzony przez właściciela, znając jego cenę: w nagłówku widać samą ikonę, bez tekstu.
  - Stan zwinięty: ikona widoczna w tym samym miejscu.
  - Telefon: ikona widoczna także przy przewiniętym panelu, bo nagłówek leży poza przewijanym `#panelBody`.
- Powiązanie: Z-064 zwolniło miejsce; wdrożone razem.
- Wdrożone 2026-11-17: ikona ☕ w nagłówku panelu, obok „?" i przycisku zwijania. Forma: 32x32 px, `top: 12px`, `right: 100px`, `border-radius: 8px`, tło `--surface`, obramowanie `1px dashed var(--line)`; hover i focus z istniejących reguł `.coffee-btn`; bez animacji, bez nowych tokenów i kolorów. Przerywana linia jest jedynym sygnałem, że link prowadzi na zewnątrz (bez ikonki strzałki, świadomie). Glif `☕` ma `aria-hidden="true"`; link ma `aria-label` „Postaw kawę autorowi — wsparcie przez zewnętrzny serwis suppi.pl, otwiera się w nowej karcie", `target="_blank" rel="noopener"`, adres `https://suppi.pl/bcicharski`. Pełny link „Postaw kawę" zostaje w sekcji „Dane i kontakt" (0 px, sekcja domyślnie zamknięta) z innym `aria-label`: „Podoba się? Postaw kawę — otwiera zewnętrzny serwis suppi.pl w nowej karcie". Świadomie dwa linki do tego samego celu z różnymi nazwami dostępnymi, żeby czytnik nie czytał dwa razy tego samego.
- Pomiary (przeglądarka, panel 300 px): środki trzech przycisków nagłówka co 44 px (kawa x=200, „?" x=244, zwijanie x=288); nakładki pola dotykowego 44x44 px stykają się, nie nachodzą. Tytuł „Dokąd dojadę?" kończy się na x=164,3, ikona zaczyna na x=184: luz 19,7 px (specyfikacja estety szacowała ok. 13 px). Podtytuł wchodzi poziomo pod ikonę, ale jego linia zaczyna się na y=60, tam gdzie ikona się kończy; boksy stykają się, więc przesunięcie `top: 10px` nie było potrzebne. Przy 360 px brak poziomego przewijania, trzy przyciski w jednej linii. Panel zwinięty: ikona w tym samym miejscu.
- Testy: `tests/support-ui.test.mjs` (5 testów: dwa linki `.coffee-btn` o różnych `aria-label`, jeden w nagłówku przed `#helpBtn`, drugi w sekcji „Dane i kontakt"; pole dotykowe `var(--tap)` przez nakładkę `::before`; brak reguły ukrywającej ikonę przy zwiniętym panelu). `tests/a11y-css.test.mjs`: inwentarz nakładek `::before` ma cztery pozycje; test odstępów w nagłówku sprawdza też 44 px między ikoną kawy a „?". `TAP_USES_MIN` zostaje 23 (dopisano selektor do istniejącej reguły, nie przybyło deklaracji).
- Pliki: index.html, css/style.css, tests/support-ui.test.mjs (nowy), tests/a11y-css.test.mjs, README.md, CURRENT_STATE.md.
- Jak sprawdzić: `npm run check`: 311 testów, 310 pass, 0 fail, 1 skipped, lint czysty (wynik dosłowny w CHANGELOG.md, sekcja 2026-11-17). Wątek główny: w dokumencie dwa linki `.coffee-btn` o różnych `aria-label`; ikona na (184, 28, 216, 60); link prowadzi na `https://suppi.pl/bcicharski` z `target="_blank"` i `rel="noopener"`; brak skryptu reklamowego na stronie.
- Niezweryfikowane: kliknięcie w ikonę i faktyczne otwarcie suppi.pl; czytnik ekranu; prawdziwe urządzenie dotykowe. Podgląd przy 300 px to szerokość panelu na desktopie, nie osobny widok telefonu.

### Z-066 [P2] Wyciek współrzędnych do GoatCountera
- Status: zrobione
- Zgłoszone: 2026-11-17 (przegląd Z-032)
- Problem: serwis ma drugi licznik odwiedzin, GoatCounter (`gc.zgo.at/count.js`, cel `ztm-izochrony.goatcounter.com`). Domyślnie raportuje ścieżkę razem z zapytaniem, a adres strony niesie `p=szerokość,długość`, czyli lokalizację użytkownika. To ten sam wyciek, który Z-040 naprawiło dla Google Analytics, tylko innym kanałem.
- Dowód: domyślne zachowanie skryptu `count.js` (odczyt wątku głównego, 2026-11-17). Lokalnie niewidoczny, bo GoatCounter nie liczy `localhost` i żądanie nigdy nie wychodzi. Numer linii w `index.html` nieznany.
- Wdrożone 2026-11-17: w `index.html`, przed wczytaniem `count.js`, dodano `window.goatcounter = { path: () => location.pathname }`. Komentarz w kodzie wyjaśnia powód i wskazuje Z-040 jako ten sam wzorzec. Zweryfikowane w przeglądarce: przy `?city=trojmiasto&p=54.35540,18.64450&...` licznik raportuje `/`.
- Ustalenie: GoatCounter ładuje się przed decyzją o cookies, ale nie ustawia plików cookie i nie profiluje, a dialog pomocy wymienia go wprost. Uznano za zgodne z zasadami; zmiany nie wymaga.
- Pliki: index.html, tests/support-ui.test.mjs.
- Testy: `tests/support-ui.test.mjs` — nowy przypadek sprawdza, że nadpisanie `path` istnieje, stoi przed skryptem licznika i ma właściwą postać. `npm run check`: 312 testów, 311 pass, 0 fail, 1 skipped, lint czysty (dosłowny wynik w CHANGELOG.md, sekcja Wewnętrzne, 2026-11-17).
- Niezweryfikowane: nieznane.

### Z-067 [P1] Brak wycofania zgody z poziomu strony
- Status: zrobione
- Zgłoszone: 2026-11-17 (przegląd Z-001)
- Problem: po jakiejkolwiek decyzji w banerze baner nie pojawia się nigdy więcej, a w całym dokumencie nie ma przycisku ani linku zmieniającego `ga-consent`. Jedyna oferowana droga to zdanie w dialogu pomocy: „zgodę można cofnąć czyszcząc dane strony w przeglądarce". Ryzyko prawne.
- Dowód: `index.html`, `const decision = consentGet(); if (decision) return;` (numer linii nieznany); zdanie w dialogu pomocy o czyszczeniu danych strony.
- Dlaczego to za mało: RODO art. 7 ust. 3 wymaga, żeby wycofanie zgody było tak łatwe jak jej udzielenie. Zgoda jest udzielana jednym kliknięciem, wycofanie wymaga grzebania w ustawieniach przeglądarki. Tego samego żąda „EU user consent policy" Google: „provide end users with clear instructions for revocation of consent".
- Dodatkowy fakt techniczny: po udzieleniu zgody Google Analytics ustawia w domenie strony cookies `_ga` i `_ga_<id>`. Skasowanie klucza w `localStorage` ich nie usunie, więc wycofanie musi też wyłączyć Analytics w bieżącej sesji i w miarę możliwości usunąć te cookies.
- Zakres: trwała kontrolka przełączająca `ga-consent`, bez nowych zależności, w czystym JavaScripcie.
- Wygląd i UX (esteta): do dopisania, gdy wątek główny prześle projekt wyglądu.
- Pułapka dla wdrożenia: `tests/support-ui.test.mjs` sprawdza dosłowną treść banera zgody i twardo zabrania słowa „reklam" w całym `index.html`. Każdy nowy tekst musi to respektować, a zmiana treści banera wymaga aktualizacji tego testu.
- Wdrożone 2026-11-17: w sekcji „Dane i kontakt" na dole panelu wiersz `#consentRow` (domyślnie ukryty) jako pierwszy element treści, przed `.credits`; zawiera `#consentState` (`role="status"`, `aria-live="polite"`) i przycisk `.consent-toggle`. Trzy stany: zgoda udzielona („Statystyki Google Analytics: włączone." z przyciskiem „Wycofaj zgodę na statystyki"), odmowa („Statystyki Google Analytics: wyłączone." z przyciskiem „Wyraź zgodę na statystyki"), brak decyzji (wiersz ukryty, bo baner jest wtedy jedyną kontrolką). Funkcje `gaClearCookies`, `gaRevoke` i `gaGrant` w skrypcie w `<head>`; wycofanie wyłącza Analytics w bieżącej sesji (`window['ga-disable-G-9L3F11T91B'] = true` oraz `gtag('consent','update',{analytics_storage:'denied'})`) i kasuje `_ga`, `_ga_*`, `_gid` i `_gat*` na hoście i na domenach nadrzędnych; ponowna zgoda ustawia flagę z powrotem, wysyła `consent update granted` i woła `loadGA()`. Bez timerów i bez przeładowania strony; błąd zapisu do `localStorage` obsłużony. Teksty `#consentYes`, `#consentNo` i baner bez zmian. Styl w `css/style.css`: `.consent-row .hint` (margines dolny 6 px) i `.consent-row .consent-toggle` (`min-height: var(--tap)`, margines dolny 10 px, `color: var(--ink)`, bez `--accent`, żeby przycisk wycofania nie wyglądał jak główne wezwanie do działania). Dialog pomocy: zdanie o czyszczeniu danych przeglądarki zastąpione odsyłaczem do nowej kontrolki, z zastrzeżeniem o rozwinięciu zwiniętego panelu; zdanie używa typograficznego cudzysłowu zamykającego zgodnie z resztą pliku.
- Dowód wdrożenia (przeglądarka, wątek główny potwierdził niezależnie): przed decyzją baner widoczny, wiersz ukryty, `document.cookie` puste. Po „Zgoda" pojawiają się `_ga` i `_ga_9L3F11T91B`, wiersz pokazuje „włączone". Po „Wycofaj zgodę na statystyki" `document.cookie` puste i zostaje puste także po wymuszonym `gtag('event')` i `gtag('config')`; w `localStorage` zapisuje się `denied`. Po odświeżeniu przy `denied` skrypt Analytics nie jest ładowany. Wynik na mapie nie znika przy żadnej z tych operacji. „Kopiuj link": adres aktualizowany przez `history.replaceState`, wczytanie linku odtwarza punkt, godzinę, typ dnia i strefy; obietnica w komunikacie o wycofaniu jest prawdziwa.
- Testy: 6 nowych w `tests/support-ui.test.mjs` (dosłowne teksty trzech stanów i trzech komunikatów; położenie wiersza przed `.credits`; `role` i `aria-live`; `<button type="button">` z `min-height: var(--tap)` i bez `--accent`; kasowanie cookies i wyciszenie; brak przeładowania i brak przenoszenia fokusu; nowy tekst pomocy wraz ze zniknięciem starego; brak słowa „reklam"). `tests/mobile-layout.test.mjs`: `TAP_USES_MIN` 23 -> 24. `npm run check`: 318 testów, 317 pass, 0 fail, 1 skipped, lint czysty (dosłowny wynik w CHANGELOG.md, sekcja 2026-11-17).
- Pliki: index.html, css/style.css, tests/support-ui.test.mjs, tests/mobile-layout.test.mjs, CURRENT_STATE.md.
- Jak sprawdzić: `npm run check` (wynik wyżej); w przeglądarce scenariusz z sekcji „Dowód wdrożenia" powyżej (wątek główny).
- Niezweryfikowane: zachowanie fokusu po prawdziwym kliknięciu myszą (kod go nie przenosi, ale panel podglądu nie miał fokusu okna); kontrast `--muted` przy rozmiarze `.hint` nie zmierzony; ścieżka błędu zapisu w prywatnym oknie Safari sprawdzona tylko w kodzie i testach tekstowych; nie sprawdzono, czy Analytics po wycofaniu przestaje wysyłać żądania sieciowe (sprawdzono cookies i stan zapisu); ładowanie Analytics na produkcji nie było sprawdzane, tylko lokalnie.

### Z-068 [P2] Brak polityki prywatności
- Status: zrobione
- Zgłoszone: 2026-11-17 (przegląd Z-001)
- Problem: repozytorium ma tylko jeden plik HTML i nie ma strony ani sekcji nazwanej polityką prywatności. Rolę informacji pełni akapit w dialogu pomocy.
- Dowód: Google Analytics Terms of Service, sekcja 7 „Privacy" (aktualizacja 2023-05-15, https://marketingplatform.google.com/about/analytics/terms/us/): „You must post a Privacy Policy and that Privacy Policy must provide notice of Your use of cookies", „You must disclose the use of Google Analytics, and how it collects and processes data." Akapit w oknie pomocy, nienazwany polityką prywatności i bez linku do https://policies.google.com/technologies/partner-sites, tego wprost nie spełnia.
- Uwaga: zobowiązanie jest zaległe wobec Analytics i NIE powstało przez usunięcie reklam. Sprawdzono 2026-11-17: po Z-064 w `index.html` nie ma już żadnej nieprawdziwej wzmianki o reklamach.
- Zakres: krótka, nazwana sekcja polityki prywatności — dopuszczalna jako nowa sekcja w panelu albo rozwinięcie dialogu pomocy, bez nowego pliku HTML. Ma wymieniać: nazwy cookies Analytics; cel; odbiorcę; link https://policies.google.com/technologies/partner-sites; GoatCounter; dane trzymane w `localStorage` (historia ostatnich punktów, decyzja o zgodzie `ga-consent`, stan sekcji panelu); sposób wycofania zgody (Z-067).
- Powiązanie (2026-11-17): sposób wycofania zgody, który ten wpis ma wymieniać, już istnieje i jest opisany w Z-067 (zrobione).
- Pytania do prawnika (nierozstrzygalne bez prawnika; właściciel powinien o nich wiedzieć; zostają otwarte po wdrożeniu):
  1. Czy okno „Polityka prywatności" spełnia obowiązek informacyjny z art. 13 RODO i wymóg „post a Privacy Policy" z regulaminu Analytics, czy potrzebna jest osobno zatytułowana sekcja.
  2. Czy wymóg „retain records of consent" (rejestr zgód) jest wykonalny dla strony bez backendu, która zapisuje decyzję wyłącznie w przeglądarce użytkownika i nie przechowuje po swojej stronie żadnego dowodu. To jedyny punkt, w którym nienegocjowalna zasada „zero backendu" strukturalnie nie daje się pogodzić z literalnym brzmieniem polityki Google.
  3. Polityka nie wskazuje podstaw prawnych przetwarzania w rozumieniu art. 6 RODO ani okresu przechowywania danych po stronie Google. Świadomie: to wymaga oceny prawnika, nie modelu.
- Wdrożone 2026-11-17: nowy `<dialog id="privacyDialog" aria-labelledby="privacyTitle">` zbudowany na wzór `#helpDialog` (klasy `.help-head` i `.help-body`, ten sam przycisk zamknięcia, `showModal()`, fokus na przycisku zamknięcia, zamykanie przez × i klik w tło, Escape natywnie). Link „Polityka prywatności" to `<button type="button" class="link-btn" id="privacyOpen">` w `footer.credits`, po kontakcie mailowym. `#privacyDialog` dzieli reguły z `#helpDialog`; doszły `.credits .link-btn` (wygląd linku) i `.help-body code`; zero nowych tokenów. Akapit w oknie pomocy dostał na końcu zdanie „Pełne informacje o danych znajdziesz w polityce prywatności, pod stopką panelu."; zdanie o wycofaniu zgody z Z-067 bez zmian. Koszt wysokości panelu: zero (stopka już istniała, okno żyje poza układem).
- Treść: zatwierdzona przez właściciela 2026-11-17 przed wdrożeniem i przepisana dosłownie, bez redagowania. Właściciel potwierdził, że prowadzi serwis jako osoba prywatna; administrator: „Bartosz Cicharski (osoba prywatna)". Polityka zawiera: administratora i kontakt; stwierdzenie, że strona nie ma serwera aplikacji i obliczenia dzieją się w przeglądarce; hosting GitHub Pages i przetwarzanie danych technicznych połączenia przez dostawcę hostingu; Google Analytics 4 z identyfikatorem pomiaru G-9L3F11T91B, cookies `_ga` i `_ga_9L3F11T91B`, Google jako odbiorca, adres obcinany (współrzędne punktu nie trafiają do Analytics); link do informacji Google o witrynach partnerskich; sposób wycofania zgody; GoatCounter bez cookies, z samą ścieżką bez parametrów; cztery klucze `localStorage` (`ga-consent`, `recent-points`, `seen-intro`, `panel-sections`), które nie opuszczają urządzenia; OpenStreetMap (pobieranie kafelków ujawnia IP i oglądany fragment mapy); link do serwisu wsparcia; prawa osoby, której dane dotyczą, i skargę do Prezesa Urzędu Ochrony Danych Osobowych.
- Rozbieżności zgłoszone przez wdrożeniowca, rozstrzygnięte przez wątek główny (2026-11-17):
  1. Wycofanie zgody: polityka mówi, że wyłącza pomiar od razu, bez przeładowania, a komunikat mówił „Pełne wyłączenie nastąpi po odświeżeniu strony". Sprawdzone w przeglądarce: po wycofaniu wymuszone `gtag('event')` i `gtag('config')` nie wysyłają żadnego żądania, flaga `ga-disable` jest ustawiona, pliki cookie są puste, zapis to `denied`. Prawdziwa jest polityka; komunikat był nadmiernie ostrożny i w kontekście prawnym wprowadzał w błąd. Zmiana kodu: komunikat poprawiono na „Zgodę wycofano. Usunęliśmy pliki cookie Google Analytics i wyłączyliśmy pomiar — nic więcej nie jest wysyłane." (`index.html`, asercja w `tests/support-ui.test.mjs`).
  2. Cztery klucze pamięci: przeszukanie kodu pod kątem `localStorage`, `sessionStorage` i `indexedDB` potwierdziło dokładnie cztery klucze i żaden inny magazyn. Stwierdzenie w polityce prawdziwe; bez zmian.
- Testy: 3 nowe w `tests/support-ui.test.mjs` — struktura dialogu i przycisk w stopce; dosłowne fragmenty treści (administrator, identyfikator pomiaru, nazwy cookies, cztery klucze pamięci, adres informacji Google, GoatCounter, OpenStreetMap, Prezes Urzędu Ochrony Danych Osobowych); zdanie odsyłające w pomocy i brak słowa „reklam". Istniejący test dialogu pomocy zawężony do `#helpDialog`, bo wcześniej zabraniał frazy „czyszcząc dane strony" w całym pliku, a ta fraza występuje w zatwierdzonej treści polityki. `TAP_USES_MIN` bez zmian. `npm run check`: lint czysty, 321 testów, 320 pass, 0 fail, 1 skipped (dosłowny wynik w CHANGELOG.md, sekcja 2026-11-17).
- Wymiary okna (pomiar): desktop 480x566 px przy treści 1192 px, przewijanej, bez poziomego paska; przy szerokości 360 px: 322x576 px, bez poziomego paska, przewija się do końca.
- Pliki: index.html, css/style.css, tests/support-ui.test.mjs.
- Jak sprawdzić: `npm run check` (wynik w CHANGELOG.md, sekcja 2026-11-17); w przeglądarce: link w stopce otwiera okno, zamknięcie przez × i klik w tło, Escape; wymiary okna jak wyżej.
- Niezweryfikowane: zamykanie Escape sprawdzone tylko symulowanym zdarzeniem, nie przy dwóch oknach naraz; nie zrobiono zrzutu ekranu, tylko pomiary; działanie nakładki pola dotykowego przycisku zamknięcia nie było mierzone; zachowanie na produkcji nie było sprawdzane.

### Z-069 [P1] Polityka prywatności, zgoda i zwinięty panel: sześć poprawek z przeglądu fal 7 i 8
- Status: zrobione
- Zgłoszone: 2026-11-17 (analityk, przegląd kodu z fal 7 i 8)
- Problem: przegląd znalazł sześć rozbieżności: polityka pomijała wyszukiwarkę adresów (Nominatim) i lokalizację; akapit o liczniku odwiedzin twierdził, że leci wyłącznie ścieżka; zwinięty panel chował ostrzeżenie o nieaktualnym rozkładzie i błąd obliczeń; zgoda przy niedostępnej pamięci zostawiała Analytics bez możliwości wycofania; baner zgody nie prowadził do polityki; odsyłacz w oknie pomocy wskazywał złe miejsce.
- Dowód: przegląd analityka z 2026-11-17 (fale 7 i 8); szczegóły punktów w CHANGELOG.md, sekcja 2026-11-17.
- Wdrożone 2026-11-17: (1) w polityce akapity „Wyszukiwanie adresu" (Nominatim, co tam trafia, zastrzeżenie o podpowiedziach przystanków bez sieci) i „Twoja lokalizacja" (oba przyciski lokalizacji) po akapicie o mapie; (2) akapit o liczniku odwiedzin przepisany: zamiast „wyłącznie ścieżka" zdanie, że współrzędne punktu nie są wysyłane, i wymienienie standardowych danych przeglądarki przesyłanych przez licznik; (3) `.panel.collapsed` nie ukrywa `#dataWarn` i `#diagBox` (reguła `:not(#dataWarn):not(#diagBox)`), `#status` dalej się chowa, `#diagBox` ma `max-height: 40vh` z przewijaniem; zmierzone `?city=opole` 360 px: ostrzeżenie 70 px po zwinięciu, panel 459 -> 220 px; opis w CURRENT_STATE.md poprawiony; (4) zgoda: po zapisie odczyt zwrotny; przy nieudanym zapisie wiersz wycofania się pokazuje, decyzja trzyma się w zmiennej sesji, a linia stanu mówi, że decyzji nie udało się zapamiętać; (5) baner ma przycisk „Polityka prywatności" otwierający okno polityki, ze wspólnym handlerem z przyciskiem w stopce; zdanie banera i teksty „Zgoda"/„Odmowa" bez zmian; (6) odsyłacz w oknie pomocy: „link jest w sekcji „Dane i kontakt” na dole panelu".
- Pliki: index.html, css/style.css, tests/support-ui.test.mjs, tests/mobile-layout.test.mjs, README.md, CURRENT_STATE.md. `js/` nietknięte.
- Testy: 4 nowe w `tests/support-ui.test.mjs` (akapity polityki z kolejnością i wzmianką o Nominatim, kod woła `nominatim.openstreetmap.org`; akapit o liczniku bez starego zdania; dosłowna linia stanu przy nieudanym zapisie z odczytem zwrotnym; baner z przyciskiem polityki przy niezmienionym zdaniu i wspólnym handlerze) plus poprawione asercje; `tests/mobile-layout.test.mjs`: nowy test zwiniętego panelu, `TAP_USES_MIN` 24 -> 25.
- Jak sprawdzić: `npm run check`: pass 325, fail 0, skipped 1, lint czysty (dosłowny wynik w CHANGELOG.md, sekcja 2026-11-17, Wewnętrzne). W przeglądarce (wątek główny): `?city=opole` 360 px po zwinięciu; kliknięcia przy 360 px: link banera, okno, Escape, powrót fokusu na link, „Zgoda", zapis `granted`, baner znika; nieudany zapis zgody przez nadpisanie `localStorage`.
- Niezweryfikowane: prawdziwy tryb prywatny Safari (sprawdzono symulacją); wzrokowe przewinięcie nowych akapitów polityki do końca na ekranie (sprawdzono testem na tekst); czytnik ekranu.

### Z-054 [P1] Rozkład Opola: MZK publikuje TransXChange, nie GTFS
- Status: zrobione
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: rozkład Opola kończy się 2026-11-16 (Z-051). MZK Opole publikuje rozkład wyłącznie w formacie TransXChange (jeden plik XML, 87 MB po rozpakowaniu), a cały łańcuch prekompilacji czyta GTFS-CSV. Poprzednie źródło (`cdn.zbiorkom.live`) przestało odpowiadać.
- Dowód: `https://www.mzkopole.pl/otwarte-dane/lib/getlatestfile.php` zwraca poprawny ZIP (2,8 MB) z `TransXChange.xml`; archiwum per data `https://www.mzkopole.pl/otwarte-dane/data/RRRR.MM.DD.zip`, najnowszy `2026.11.06.zip`. Sprawdzone i puste: mzkopole.pl, dane.gov.pl, portal miasta, mkuran.pl, mobilitydatabase, transit.land.
- Wdrożone 2026-11-17: własny parser strumieniowy bez zależności (`tools/xmlstream.mjs`) i konwerter (`tools/transxchange-to-gtfs.mjs`) wpięte w `tools/fetch-feeds.mjs` przez rejestr formatów. Nowe pole feedu `format` (oraz `formatOptions`) w `data/cities.json`; nieznany format to twardy błąd. Kolejne miasto z tym samym formatem nie wymaga kodu. Parser działa w trybie strict (CDATA, nieznana encja, niedomknięty element, koniec pliku w tagu: przerwanie z offsetem bajtowym). Filtrowanie po ścieżce bezwzględnej, nie po nazwie elementu.
- Decyzje oparte na pomiarach prawdziwego pliku (trzy tury sondowania, każda obaliła założenie):
  1. Flaga „widoczny dla pasażerów" ma wartość `false` w 8267 z 8267 przypadków, nigdy `true`; filtr po niej odrzucony.
  2. Pole `Activity` występuje dokładnie raz po każdej stronie kursu (`pickUp` na pierwszym ogniwie, `setDown` na ostatnim, 6450 razy); na przystankach pośrednich brak. Przyjęte: brak flagi = wolno wsiąść i wysiąść.
  3. Flaga techniczna trasy oznacza 2676 z 6450 kursów (41,5%). Rozstrzygnął `VehicleJourneyKind`: zachowany jest wyłącznie kurs z rodzajem 0 (3774 kursy, średnio 28,6 przystanku); rodzaje 1–5 to kursy dokładnie dwuprzystankowe, czyli przejazdy służbowe.
- Sekwencja przystanków z `VehicleJourneyStopPoints` w kolejności dokumentu; pole `Sequence` odrzucone (0 z 6450 kursów zgodnych). Zgodność dowiedziona krzyżowo: dla 104 315 ogniw mapa ogniw daje te same przystanki po obu stronach, zero niezgodności.
- Koperta bezpieczeństwa: progi w `LIMITS`, a tam gdzie pomiar dał zero, asercje o wartości zero. Zapis wyłącznie do katalogu tymczasowego, przeniesienie po pełnej walidacji; awaria w połowie nie nadpisuje `data/opole/`.
- Zmierzone na prawdziwym pliku: 3774 kursy, 108 089 wierszy `stop_times`, 27 tras, 521 przystanków w GTFS, zero konfliktów, zero ogniw `pass` w zachowanych kursach, okres 20261106–20261130; konwersja 1,4 s, szczyt pamięci 269 MB.
- Przeliczenie danych Opola (pełny łańcuch): `fetch-feeds` pobrał 2,9 MB ZIP; `build-data` wybrał dni 20261117, 20261121, 20261122; 294 zespoły przystankowe; usunięty jeden przystanek bez kursów (zostaje 520). Porównanie ze starymi danymi: 520 przystanków, 225 wzorców, 1203 kursy w dniu roboczym, ten sam zbiór 27 linii; rozmiary plików dni o 1,5–2,7% mniejsze. `node tools/check-data.mjs`: „Wszystkie 18 miasta w porządku".
- Zmiana widoczna dla użytkownika (do obserwacji): nazwy przystanków tracą numer słupka. Stare źródło podawało „1 Maja - Dworzec Główny (1)" i „1 Maja - Dworzec Główny (2)" jako dwie osobne nazwy; nowe podaje samo „1 Maja - Dworzec Główny". Przystanków nadal 520, ale różnych nazw jest 291 zamiast 520. Zbiory nazw starych i nowych nie mają ani jednej wspólnej pozycji, bo zmieniła się cała konwencja nazewnicza, a nie pojedyncze nazwy. Grupowanie w zespoły nie ucierpiało: 294 przed zmianą, 294 po. Wyszukiwarka przystanków scala duplikaty po nazwie i odległości.
- Pliki: tools/xmlstream.mjs (nowy), tools/transxchange-to-gtfs.mjs (nowy), tools/fetch-feeds.mjs, data/cities.json, data/opole/*, README.md.
- Testy: `tests/xmlstream.test.mjs` (10), `tests/transxchange-to-gtfs.test.mjs` (31), `tests/fixtures/transxchange-min.xml`, `tests/fetch-feeds.test.mjs` (usunięty wyjątek `mzk-opole`, asercja formatu feedu). Łącznie 41 nowych testów, w tym regresja na błąd z punktu 2 (kurs bez żadnej flagi `Activity` jest w pełni używalny) i test zgodności od końca do końca przez funkcje z `tools/build-lib.mjs`.
- Jak sprawdzić: `npm run check` (dosłowny wynik w CHANGELOG.md, sekcja 2026-11-17); w przeglądarce `?city=opole`: izochrona, sześć pasm, brak ostrzeżenia, stopka: rozkład z 17.11.2026 ważny do 30.11.2026 (sprawdzone).
- Niezweryfikowane: zachowanie konwertera na grudniowej wersji pliku (struktura może się zmienić; od tego są asercje); `agency.txt` z pustym adresem agencji (`build-data` tego nie czyta); tryb porównania i tryb ostrożny na nowych danych Opola.

### Z-012 [P2] Wielokryterialność
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak limitu przesiadek i maksymalnej długości spaceru. Zakres tego zadania to WYŁĄCZNIE te dwie rzeczy. Wyłączanie pojedynczych linii świadomie odrzucone przez właściciela 2026-11-17 z jego uzasadnieniem: „wyłączanie pojedynczych linii chyba nie ma sensu". Nie wskrzeszać tej części jako „zapomnianej" pozycji.
- Dowód: nieznane.
- Pliki: js/router.js, js/walknet.js, js/engine.js, js/stats.js, js/uilogic.js, js/app.js, index.html, css/style.css, README.md, CURRENT_STATE.md.
- Wdrożone 2026-11-17: dwie nowe grupy w sekcji „Dojście, przesiadki i środki": „Przesiadki (maks.)" (0, 1, 2 albo bez limitu) i „Maks. odcinek pieszo" (5, 10, 15 min albo bez limitu), obie domyślnie bez limitu. Limit spaceru dotyczy każdego pojedynczego odcinka pieszego przy komunikacji, nie sumy marszu. Budżet łączny odrzucono świadomie (wymagałby wielokryterialnego RAPTOR, czyli przebudowy silnika). Tryb „Ogólnie" nie modeluje przesiadek: kontrolka wygaszona z podpowiedzią „Tryb ogólny nie modeluje przesiadek.", silnik nie dostaje limitu przesiadek, parametr `tr` zostaje w adresie; limit spaceru działa. Parametry adresu: `tr` (0, 1, 2) i `wmax` (1–89 min). Szczegóły i pomiary w CHANGELOG.md (sekcja 2026-11-17).
- Niezweryfikowane: widok mobilny i zawijanie wiersza podsumowania sekcji; okno pomocy po aktualizacji tekstu nie oglądane; ścieżka z limitem przy niewczytanym grafie ulic pokryta tylko przypadkowo.

### Z-004 [P1] Punkt spotkania
- Status: zrobione (wdrożone 2026-11-19; zatwierdzone do wdrożenia przez właściciela 2026-11-17: „Z-004 — zrób to, to dobra zmiana". Kolejność: przed Z-010.)
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak trybu szukania miejsca spotkania dwóch osób; naturalny następny krok po trybie porównania.
- Dowód: maxTimeGrid już liczy maksimum z dwóch fal.
- Pliki: js/stats.js, js/engine.js, js/uilogic.js, js/app.js, index.html, css/style.css, README.md, CURRENT_STATE.md.
- Wdrożone 2026-11-19: trzeci tryb „Spotkanie" (adres `meet=1`, opcjonalnie `mcrit=sum`). Po ustawieniu dwóch punktów karta z przystankami na spotkanie: nazwa, czas dojazdu każdej osoby i różnica; pozycja pierwsza wyróżniona, pozostałe cztery za przyciskiem z licznikiem; ponumerowane pinezki na mapie. Kandydaci to zespoły przystankowe z istniejącego grupowania, bez nowych danych i bez przeliczania miast. Okno dopuszczalności: najkrótszy czas spotkania plus min(10 min, połowa tego czasu); dopiero wśród miejsc w oknie szukana jest najmniejsza różnica. Kryterium domyślne „obie osoby jadą tyle samo", drugie „najmniejsza suma czasów" (bez okna). Zmiana kryterium nie przelicza niczego. Nota, gdy proponowane miejsce nie jest najszybsze. Teksty mówią „przystanki na spotkanie", nie „najlepsze miejsce".
- Odstępstwa od projektu: alternatywy rozwija przycisk z licznikiem zamiast zagnieżdżonego elementu zwijanego (tylko tak pozycja pierwsza i przełącznik mieszczą się w jednym wierszu); nagłówki skrócono do „Przystanki na spotkanie" i „Przystanki — dojazd do punktów", bo dłuższe zawijały się do pięciu linii.
- Budżet panelu niedotrzymany: w trybie spotkania panel przewija się wewnętrznie o 68 px przy oknie 1280x800 (714 px treści przy 646 px widocznych). Karta ma 102 px (budżet 120 px); przekroczenie bierze się głównie z trybu dwóch punktów (618 px przez drugie pole adresu). Karta jest na górze panelu i widoczna bez przewijania. Tryb domyślny nadal 548 px, bez przewijania. Dalsze skrócenie wymagałoby decyzji, co ustąpi.
- Niezweryfikowane: wygląd pinezek i dymka po ostatnich poprawkach stylów; czytnik ekranu przy zmianie kryterium; tryb „ogólnie" i kierunek „do miejsca" sprawdzone tylko testami, nie w przeglądarce.
- Etap drugi: przeniesiony do Z-071 (osobne zadanie, do zrobienia po Z-010).

### Z-010 [P2] Wizualizacja trasy z dymka na mapie
- Status: zrobione
- Zgłoszone: 2026-11-16 (analityk)
- Problem: nie ma rysowania tras na mapie.
- Dowód: brak shapes i polilinii w js/app.js i js/map.js.
- Pliki: js/router.js, js/engine.js, js/uilogic.js, js/map.js, js/app.js, css/style.css, README.md, CURRENT_STATE.md.
- Wdrożone 2026-11-19: prawy klik na mapie rysuje linię trasy z dymka; w trybie porównania obie trasy naraz; linia znika razem z dymkiem; w trybie „tylko pieszo" nic nie rysuje. Źródło geometrii: łamana po współrzędnych przystanków z danych już obecnych w przeglądarce (zero nowych plików, zero przeliczania, jednakowo w 18 miastach). Prawdziwa geometria z GTFS odłożona do Z-074 (wymaga decyzji właściciela). Cena jawna: kropki na przystankach, kreskowane odcinki piesze, w dymku zdanie o uproszczeniu linii. Wygląd: ciemna otoczka z jasnym rdzeniem; dwie osoby rozróżnione grubością, kropkami pełnymi lub pustymi, fazą kreskowania i dopiero na końcu kolorem; zero nowych tokenów. Zmierzony kontrast: rdzeń wobec otoczki 16,9:1; otoczka wobec podkładu w paśmie 45–60 min 2,7:1 przy 5. percentylu, czyli poniżej wymaganych 3:1 na najciemniejszych fragmentach mapy (zgłoszone jako Z-072). Zatwierdzone przez właściciela 2026-11-17 jako następne po Z-004.
- Niezweryfikowane: płynność przesuwania mapy na prawdziwym telefonie; prawy klik prawdziwą myszą (testowano zdarzeniem syntetycznym); fizyczne przeciągnięcie pinezki przy otwartym dymku; kontrast liczony, nie mierzony na pikselach zrzutu; dostępność z klawiatury (Z-073).

### Z-072 [P2] Kontrast otoczki trasy poniżej progu na ciemnych fragmentach mapy
- Status: zrobione
- Zgłoszone: 2026-11-19 (nieznane; pomiar przy wdrożeniu Z-010)
- Problem: otoczka trasy na paśmie 45–60 minut ma kontrast 2,7:1 wobec najciemniejszych kafli podkładu (około 5 procent pikseli, parki i woda), przy wymaganych 3:1 dla grafiki nietekstowej. Mediana 3,7:1, 25. percentyl 3,3:1. Do rozważenia: jaśniejszy wariant otoczki, cieńszy rdzeń albo delikatny cień.
- Dowód: pomiar przy wdrożeniu Z-010 (2026-11-19), kontrast liczony na kaflach, nie na pikselach zrzutu.
- Pliki: js/uilogic.js, js/app.js, js/map.js, css/style.css, index.html, README.md, CURRENT_STATE.md (lista wspólna z Z-073).
- Jak sprawdzić: ponowny pomiar na pikselach zrzutu w paśmie 45–60 minut; próg 3:1 dla 5. percentyla. Stan 2026-11-20: wdrożono podwójną otoczkę (jasny obrys 2 px pod ciemną otoczką; kolor rdzenia i sposób rozróżniania dwóch osób bez zmian). Zmierzono 18 kombinacji (sześć pasm × trzy poziomy jasności podkładu). Pojedyncza ciemna otoczka schodzi poniżej 3:1 w jednym przypadku (pasmo 45–60 przy 5. percentylu, 2,71:1), ale jasny obrys w tym samym miejscu daje 6,22:1. Dla każdej z 18 kombinacji LEPSZA z dwóch krawędzi ma co najmniej 3,0:1; najgorszy przypadek to 3,00 dla jasnej krawędzi na paśmie „ponad 60" przy medianie, gdzie dominuje ciemna krawędź z 5,61. Próg jest spełniony przez parę krawędzi, nie przez każdą z osobna. Obrys jest o 2 px szerszy z każdej strony niż dotąd. Przy 1. percentylu nie liczono. Niezweryfikowane: brak zrzutu linii nad ciemnym fragmentem mapy na paśmie 45–60 minut — kontrast policzony, nie obejrzany.

### Z-073 [P2] Dymka trasy nie da się otworzyć z klawiatury
- Status: zrobione
- Zgłoszone: 2026-11-19 (projektant przy Z-010; świadomie nienaprawione w Z-010)
- Problem: jedyne wejście do dymka trasy to prawy klik albo przytrzymanie palcem, więc cała funkcja opisu trasy jest niedostępna dla osoby korzystającej wyłącznie z klawiatury.
- Dowód: wdrożenie Z-010 (2026-11-19), prawy klik jako jedyne wejście do dymka.
- Pliki: js/uilogic.js, js/app.js, js/map.js, css/style.css, index.html, README.md, CURRENT_STATE.md; testy: tests/keyboard-journey.test.mjs (lista wspólna z Z-072).
- Jak sprawdzić: testy: tests/keyboard-journey.test.mjs (8 testów). Stan 2026-11-20: Tab na mapę, strzałki ustawiają widok, Enter otwiera opis trasy dla środka mapy; przy fokusie mapy ramka, krzyżyk środka i podpowiedź „Enter — trasa do tego miejsca" (tylko przy `:focus-visible`); skrót w `aria-label` mapy i w oknie pomocy; Enter i prawy klik prowadzą przez jedną funkcję; fokus po otwarciu idzie do dymka, Escape zamyka i oddaje fokus mapie. Sprawdzone w przeglądarce prawdziwymi klawiszami: fokus mapy pokazuje ramkę, krzyżyk i podpowiedź; strzałki przesuwają; Enter otwiera dymek i rysuje linię, fokus ląduje w dymku; Escape zamyka, linia znika, fokus wraca na mapę; prawy klik działa jak wcześniej, także dla trasy z przesiadką; konsola bez błędów. Niezweryfikowane: czytnik ekranu; widok mobilny (czy panel nie zasłania krzyżyka i podpowiedzi); tryb porównania z klawiatury; zachowanie przy ograniczonym ruchu.

### Z-070 [P2] Nieczyszczony bufor rozlania `grid.spread` w `walkgrid.js`
- Status: zrobione
- Zgłoszone: 2026-11-17 (nieznane)
- Problem: `computeTimeGrid(grid, null, maxSpreadM)` czyta `grid.spread` w komórkach zasianych wcześniej przez `paintNetwork` i nigdy ich nie zeruje, więc zostaje stan z poprzedniego przeliczenia. Dotąd wartości były małe (do 75 m) i skutek niewidoczny. Fallback rastrowy z limitem spaceru zapisuje do ok. 288 m, więc wynik zależy od kolejności wczytywania: w przeglądarce dla `wmax=5` dawało naprzemiennie 26 albo 35 procent obszaru, deterministycznie co drugie przeładowanie.
- Dowód: js/walkgrid.js:166 i js/walkgrid.js:248 (tworzenie bufora `grid.spread`); obserwacja w przeglądarce przy wdrożeniu Z-012. Obejście z Z-012: `grid.spread?.fill(0)` w js/engine.js:248, z testem regresji.
- Skutek uboczny obejścia: przy pierwszym przeliczeniu po wejściu na stronę wynik bez limitów jest taki sam jak dotąd; przy kolejnych przeliczeniach jest deterministyczny i może się nieznacznie różnić od dawnego, który zależał od stanu bufora.
- Pliki: js/walkgrid.js, js/engine.js, tests/walkgrid.test.mjs.
- Jak sprawdzić: stan 2026-11-20 — naprawa u źródła w `computeTimeGrid` (`js/walkgrid.js`): w gałęzi bez zasiewu pętla zbierająca zasiane piksele zeruje `grid.spread` w każdej odwiedzonej komórce. Zasiane piksele leżą na ulicy (zasięg zero), komórki dopisane w przebiegu dostają świeży zasięg przed odczytem, niezasiane nie są czytane przed zapisem. Koszt dodatkowy zero. Obejście `grid.spread?.fill(0)` w `js/engine.js` usunięte, bo druga linia obrony kosztowałaby O(W×H) przy każdym przeliczeniu. Test regresji z obejścia zostaje w `tests/walkgrid.test.mjs`: na tym samym obiekcie siatki pierwszy przebieg zasiewa rozlanie do kilku kilometrów, drugi z limitem 300 m musi dać wynik identyczny jak na czystej siatce. Dowód, że testy łapią błąd: po tymczasowym wycofaniu poprawki oba testy padają, po przywróceniu przechodzą. Zmierzone w przeglądarce (Trójmiasto, limit 5 minut, sześć przeładowań, za każdym razem identyczny wynik): 0,2 / 0,8 / 3,4 / 8,8 / 13 / 20 procent. Bez limitu dwa przeładowania: 0,2 / 0,9 / 4,2 / 15 / 23 / 37 procent. `npm run check`: lint czysty, wynik dosłowny w CHANGELOG.md. Niezweryfikowane: nie porównano liczbowo wyników z sprzed Z-012, więc nie wiadomo, która z dawnych wartości (26 czy 35 procent) była prawidłowa — istotne, że wynik jest teraz stabilny; nie badano innych miast z limitem.

### Z-002 [P1] Mobile i PWA
- Status: zrobione w zakresie etapów 1 i 2 (wdrożone 2026-11-16); etap 3 (service worker) ODRZUCONY decyzją właściciela 2026-11-27.
- Zgłoszone: 2026-11-16 (analityk)
- Problem: brak manifest.json i service workera; offline tylko przez cache przeglądarki. Dochodzi bottom sheet, przycisk „wyśrodkuj na mnie" i wibracja.
- Dowód: brak odwołań do manifestu i service workera w index.html (stan przed etapem 1).
- Wdrożone 2026-11-16:
  - Etap 1 (manifest i ikony): `manifest.json` (`start_url` i `scope` jako `./`, `start_url` bez parametrów), generator `tools/build-icons.mjs` (zero zależności, wynik deterministyczny), `assets/icon.svg`, `assets/icon-192.png`, `assets/icon-512.png`, `assets/icon-maskable-512.png`, `assets/apple-touch-icon.png`; w `index.html` cztery linie w `<head>`, stara ikona data-URI zostaje jako awaryjna. Testy: `tests/pwa-manifest.test.mjs` (5), `tests/build-icons.test.mjs` (2).
  - Etap 2 (lokalizacja i wibracja): kontrolka „Wyśrodkuj na mnie" (`addLocateControl` w `js/map.js`) z kółkiem dokładności i przyciskiem „Ustaw tu punkt startowy" w dymku; czyste funkcje w `js/uilogic.js`; rozróżnione komunikaty błędów lokalizacji, komunikat „Jesteś poza obszarem: <miasto>", jeden impuls wibracji 20 ms po przeliczeniu dłuższym niż 1,5 s, komunikat „Jesteś offline". Testy: `tests/uilogic.test.mjs`, `tests/mobile-layout.test.mjs` (`TAP_USES_MIN` 19 -> 21).
- Rozwiązanie etapu 3 (service worker; szkic z wejścia fali, bez przeglądu rozwiazywacza): service worker shell-only, który nigdy nie odpowiada na żądania zawierające `/data/` (nie pokaże nieaktualnego rozkładu); powłoka jako jedna atomowa paczka `shell-<hash>`; bez `skipWaiting()` w tle; komunikat „Dostępna nowa wersja — odśwież" z przyciskiem; wyjście awaryjne `?sw=off`; stempel wersji z `tools/stamp-sw.mjs` pilnowany testem. Wariant „sam manifest, bez service workera" odpadł: GitHub Pages narzuca `Cache-Control: max-age=600` i nie pozwala tego zmienić, a bez handlera `fetch` Chrome nie pokaże promptu instalacji. Etap 3 czeka na decyzję właściciela, bo trwale instaluje się w przeglądarkach użytkowników i zmienia zachowanie offline.
- Pliki: index.html, js/app.js, js/map.js, js/uilogic.js, css/style.css, manifest.json, tools/build-icons.mjs, assets/, tests/pwa-manifest.test.mjs, tests/build-icons.test.mjs. Etap 3 (nie wdrożony): sw.js, js/pwa.js, tools/stamp-sw.mjs, tests/sw.test.mjs.
- Niezweryfikowane: etap 1 — faktyczna instalowalność na telefonie i na iOS, ścieżki względne pod `github.io/ZTM/`. Etap 2 — prawdziwy prompt o zgodę, kod 3 (timeout), komunikat offline w przeglądarce, pozycjonowanie kontrolki na wąskim ekranie, wibracja na prawdziwym urządzeniu.
- Decyzja właściciela (2026-11-27): etap 3 (service worker) ODRZUCONY. Wcześniejsze etapy 1 i 2 zostają jako wykonane. Kontekst: źle napisany service worker potrafi trwale serwować starą wersję, a dane tej strony zmieniają się co tydzień. Odrzucenie etapu 3 zamyka część zadania, która została; zależne od niego Z-047 również odrzucone.

## Odrzucone

<!-- NOWE-ODRZUCONE -->

### Z-001 [P1] Certyfikowany CMP (Consent Mode v2)
- Status: odrzucone
- Zgłoszone: 2026-11-16 (analityk)
- Problem: własny baner zgody nie spełnia wymogu Google dla EOG — potrzebny certyfikowany CMP. Uwaga: ryzyko prawne.
- Dowód: index.html:321-359.
- Przegląd (2026-11-17): usunięcie AdSense (Z-064) może w całości lub w części odebrać rację bytu temu wpisowi; wymaga przeglądu, nie zamknięty.
- Z-064 (2026-11-17): reklamy usunięte; wymóg certyfikowanego CMP dotyczył reklam, a zgoda zostaje dla samych statystyk (Google Analytics). Wymaga ponownej oceny; nie zamknięty.
- Powód odrzucenia (2026-11-17, werdykt przeglądu): nieaktualne. Wymóg certyfikowanego CMP dotyczy wyłącznie produktów reklamowych wydawcy: AdSense, Ad Manager, AdMob, AdSense for Search, AdSense for Shopping i Programmable Search Engine, przy serwowaniu reklam użytkownikom w EOG i Wielkiej Brytanii; obowiązuje od 2024-01-16. Google Analytics nie jest w tym wykazie (https://support.google.com/adsense/answer/13866773). Dla Google Analytics 4 Google sam dopuszcza własny baner: „If you maintain your own consent banner, upgrade to consent mode v2." (https://support.google.com/analytics/answer/14275483). Wszystkie produkty reklamowe usunięto 2026-11-17 w commicie b6aa595 (Z-064). Źródła pierwotne Google sprawdzone 2026-11-17.
- Niejednoznaczność, nierozstrzygalna z dostępnych źródeł: Google nigdzie nie mówi wprost, czy „EU user consent policy" wiąże użytkownika GA4 BEZ Advertising Features, Google Signals i eksportu do Google Ads. Dokumentacja konsekwentnie wiąże ją z reklamą, ale brzmienie samej polityki („use a Google product that incorporates this policy") jest szersze. Nie zmienia werdyktu: nawet przy najszerszym czytaniu polityka nie żąda certyfikowanego CMP, żąda rejestru zgód i jasnej instrukcji wycofania. Te obowiązki są śledzone w Z-067 (wycofanie) i w pytaniu do prawnika w Z-068 (rejestr zgód).
- Pliki: index.html oraz ustawienie w panelu AdSense (poza kodem) — nieaktualne.

### Z-032 [P1] Wyciek współrzędnych do AdSense
- Status: odrzucone
- Zgłoszone: nieznane
- Problem: po zgodzie żądania reklamowe (`pagead2.googlesyndication.com/.../ads?...url=`) niosą pełny adres strony razem z parametrem `p=lat,lon`, czyli lokalizacją użytkownika. Naprawa `page_location` z Z-040 dotyczyła wyłącznie Analytics.
- Dowód: obserwacja listy żądań w przeglądarce podczas wdrożenia Z-025. Potwierdzone 2026-11-16 w przeglądarce: żądania `https://pagead2.googlesyndication.com/pagead/ads?...` niosą pełny adres ze współrzędnymi w parametrach `url=` i `ref=`, dwa razy na odsłonę (jednostka 0x0 i 249x600). Przyczyna: AdSense czyta adres wprost z `location`, więc nadpisanie `page_location` w gtag go nie obejmuje.
- Uwaga (z czasu zgłoszenia): przeniesienie współrzędnych z query do fragmentu adresu zatrzymałoby wyciek, ale zmieniłoby format linków — wymagałoby zgodności wstecznej i decyzji właściciela. Nieaktualne po usunięciu AdSense.
- Przegląd (2026-11-17): usunięcie AdSense (Z-064) odebrało temu wpisowi przedmiot.
- Z-064 (2026-11-17): reklam nie ma, żądania reklamowe nie występują.
- Powód odrzucenia (2026-11-17, werdykt przeglądu): żądania reklamowe niosące pełny adres z parametrem `p=szerokość,długość` nie powstają — AdSense usunięto w całości (Z-064, commit b6aa595).
- Wynik niezależnego sprawdzenia w przeglądarce (wątek główny, 2026-11-17): po wyrażeniu zgody Google Analytics wysyła żądanie `collect` z `dl=http://localhost:8123/`, czyli samym adresem bez parametrów. Poprawka `page_location` z Z-040 działa. Na stronie nie ma żadnego skryptu reklamowego.
- Pliki: index.html, js/app.js.

### Z-043 [P2] Szerokość korytarza mostu
- Status: odrzucone
- Zgłoszone: nieznane (dawny punkt #11 z CURRENT_STATE.md)
- Problem: szerokość korytarza mostu jako możliwe ograniczenie wyników.
- Dowód: brak potwierdzonego przypadku.
- Powód odrzucenia: analityk ocenił to jako ryzyko czysto teoretyczne bez potwierdzonego przypadku; graf ulic i przesiadki po grafie ograniczają skutki. Pozycja zniknęła przy aktualizacji CURRENT_STATE.md (Z-006) i zostaje świadomie odrzucona.

### Z-036 [P2] Panel mobilny, wariant B (decyzja właściciela)
- Status: odrzucone (scalone z Z-059)
- Zgłoszone: nieznane
- Problem: przypięty na dole panelu pasek wyniku z legendą i statusem oraz sekcja „Więcej opcji" chowająca rzadko zmieniane kontrolki (kierunek, dojście, środki transportu, opóźnienia, statystyki) z podsumowaniem zmienionych opcji w nagłówku. Skraca przewijanie panelu z ok. 1160 px do ok. 600 px. Zmienia układ interfejsu, dlatego wymaga zatwierdzenia. Wariant A (Z-030) wdrożony.
- Dowód: nieznane.
- Pliki: index.html, css/style.css, js/app.js.
- Powód odrzucenia (2026-11-17): zadanie wchłonięte przez Z-059 (zwijane sekcje). Sekcja „Więcej opcji" to podzbiór Z-059, który daje trzy sekcje zamiast jednej i działa też na desktopie. Zmiana układu została zatwierdzona przez właściciela 2026-11-17 (sam poprosił o zwijane sekcje), więc dopisek „decyzja właściciela" w tym wpisie jest nieaktualny. Drugi element, przypięty pasek wyniku, jest odłożony, a nie odrzucony: w nowym układzie legenda i status są tuż pod wyszukiwarką, w górnych ok. 290 px, więc zawsze w polu widzenia. Przypięta zostaje stopka, nie pasek wyniku (Z-059).
- Scalone z: Z-059.

### Z-063 [P2] Eksport widoku mapy do PNG
- Status: odrzucone
- Zgłoszone: 2026-11-17 (kronikarz)
- Problem: eksport wyniku do PNG nie został wdrożony. Z-008 obejmowało eksport do PNG albo GeoJSON; GeoJSON wdrożono 2026-11-17 (w Z-008), PNG nie.
- Dowód: linia z historii Z-008 z 2026-11-16 („Pozostaje: tryb czystego widoku bez panelu; eksport PNG (nie ruszane w tej fali)."), zastąpiona przy domknięciu Z-008 odesłaniem do tego zadania.
- Uwaga: po Z-008 zrzut ekranu zwiniętego panelu daje mapę z legendą bez osobnego trybu, więc wartość eksportu PNG jest mniejsza niż przed tą zmianą. Warto to rozważyć przed wdrożeniem.
- Pliki: nieznane — wymaga projektu.
- Powód odrzucenia (2026-11-17, decyzja właściciela: „eksport widoku do PNG nie ma sensu, skasuj to zadanie"): po Z-008 zwinięty panel pokazuje legendę, więc zwykły zrzut ekranu daje mapę z objaśnieniem kolorów bez osobnej funkcji.

### Z-078 Eksport GeoJSON pomija koła szacunkowe; wpis o SVG był błędny
- Status: odrzucone
- Decyzja: ODRZUCONE 2026-11-20 — wybrano wariant 1 (patrz „Decyzja właściciela (2026-11-20)" niżej). Warianty poniżej zostają jako historia.
- Zgłoszone: 2026-11-20 (nieznane)
- Problem: pierwotny opis („eksport SVG nie odróżnia zasięgu szacunkowego od policzonego") jest błędny w całości. Eksportu SVG w projekcie nie ma. Zadanie powstało z błędnego odczytu przy projektowaniu Z-077 i zostało wpisane do kolejki bez sprawdzenia w kodzie. Wykrył to wdrożeniowiec, który zatrzymał się przed napisaniem jednej linii i zgłosił rozbieżność zamiast zgadywać.
  - Prawdziwy stan: eksport stref to GeoJSON. `zonesToGeoJSON` w `js/uilogic.js` buduje `FeatureCollection` z jednym `MultiPolygon` na pasmo; `js/app.js` zapisuje wynik jako `application/geo+json` pod nazwą `izochrona-*.geojson`. Widniejące tam `'fill-opacity': 0.55` to właściwość stylu dla QGIS i geojson.io, a nie atrybut SVG — stąd nieporozumienie.
  - Koła szacunkowe (przystanki poza siatką pieszą) nie trafiają do eksportu w ogóle. Eksportowane są wyłącznie kontury pasm policzonych; koła rysuje tylko płótno mapy. Plik GeoJSON dla Trójmiasta nie zawiera więc kół wokół Tczewa ani Pruszcza Gdańskiego.
  - Plik niczego nieprawdziwego nie twierdzi, tylko pomija przybliżenia. Nie ma w nim czego odróżniać. GeoJSON nie ma legendy, więc nota „Kreskowane: zasięg szacunkowy, w linii prostej" nie ma gdzie trafić.
- Warianty rozstrzygane przez właściciela:
  1. Nic nie robić. Eksport zostaje czystą geometrią stref policzonych. Za: pomijanie zgadywanych kół w pliku z danymi jest zachowaniem poprawnym, a nie brakiem — kto wczytuje izochronę do QGIS, dostaje wyłącznie to, co zostało policzone.
  2. Dodać koła do GeoJSON jako osobne obiekty z właściwością mówiącą, że to zasięg szacunkowy, plus opis. Wymaga przekazania kół do funkcji eksportu z `js/app.js`. Zmienia zawartość pobieranego pliku, więc dotyka zgodności dla kogoś, kto już przetwarza te pliki skryptem.
  3. Osobny eksport SVG z kreskowaniem 45 stopni, odpowiadającym temu z mapy. To nowa funkcja; wymaga zmian w `js/app.js` i `index.html`, czyli wychodzi poza `js/uilogic.js`.
- Dowód: sprawdzone 2026-11-20. W `js/`, `tests/` i `index.html` nie ma składania SVG ani eksportu pliku `.svg`; jedyne trafienia na „svg" to renderer Leafleta i ikony strony. Eksport GeoJSON: `zonesToGeoJSON` w `js/uilogic.js`, zapis w `js/app.js`.
- Pliki: wariant 1 — bez zmian; wariant 2 — js/uilogic.js, js/app.js; wariant 3 — js/uilogic.js, js/app.js, index.html.
- Jak sprawdzić: nieznane (zależy od wybranego wariantu).
- Decyzja właściciela (2026-11-20): wariant 1 — eksport zostaje czystą geometrią stref policzonych; kół szacunkowych się do niego nie dodaje. Uzasadnienie: plik GeoJSON jest eksportem danych pomiarowych, a mieszanie do niego zgadywanych kół zaciemniłoby to rozróżnienie; kto wczytuje izochronę do QGIS, chce wyłącznie tego, co zostało policzone. Warianty 2 (koła jako osobne obiekty GeoJSON) i 3 (osobny eksport SVG z kreskowaniem) pozostają możliwe do wykonania w każdej chwili, gdyby pojawiła się realna potrzeba; wariant 2 jest tani.

### Z-018 [P2] Monitoring ruchu na kafelkach OSM
- Status: odrzucone
- Zgłoszone: 2026-11-16 (analityk)
- Problem: strona z reklamami używa publicznych kafelków tile.openstreetmap.org; przy wzroście ruchu trzeba przejść na własne źródło.
- Dowód: js/map.js:26.
- Pliki: js/map.js (decyzja poza kodem).
- 2026-11-20: przesłanka „strona z reklamami" przestała obowiązywać, bo blok AdSense został usunięty (Z-064). Ograniczenie pozostaje: polityka kafelków OSM ogranicza ruch niezależnie od reklam, więc zadanie zostaje otwarte z tym samym problemem, bez tego uzasadnienia.
- Decyzja właściciela (2026-11-24): nie będziemy przechodzić na własne kafelki map, zadanie nie ma racji bytu.

### Z-074 [P3] Prawdziwa geometria przejazdu z GTFS — wymaga decyzji właściciela
- Status: odrzucone
- Zgłoszone: 2026-11-19 (nieznane)
- Problem: linia trasy z Z-010 jest schematyczna (łamana po przystankach). Dołożenie `shapes.txt` do prekompilacji dałoby linię wzdłuż torów i ulic. Koszt: 15–20 MB nowych danych w repozytorium, 0,5–0,8 MB po kompresji na duże miasto przy każdej wizycie, przeliczenie 18 miast, nierówne pokrycie (Opole bez geometrii, bo konwerter TransXChange jej nie produkuje). Proponowany pierwszy etap, gdyby właściciel zatwierdził: geometria tylko dla kolei i metra. Decyzję warto podjąć po tym, jak będzie widać, czy schematyczna linia komukolwiek przeszkadza.
- Dowód: w katalogu `tools/` nie ma ani jednego wystąpienia słowa „shape" (sprawdzone 2026-11-19); prekompilacja nie czyta geometrii z GTFS, więc nic z niej nie trafia do `data/<miasto>/`.
- Pliki: tools/ (prekompilacja GTFS), data/<miasto>/ — dopiero po decyzji właściciela.
- Jak sprawdzić: nieznane.
- Decyzja właściciela (2026-11-24): zadanie nie ma sensu. Dotyczyło dołożenia prawdziwej geometrii przejazdu z `shapes.txt`, żeby linia trasy biegła torami i ulicami zamiast prosto między przystankami. Koszt był wyceniony na 15–20 MB nowych danych w repozytorium, 0,5–0,8 MB po kompresji na duże miasto przy każdej wizycie oraz przeliczenie 18 miast, przy nierównym pokryciu (Opole bez geometrii, bo konwerter TransXChange jej nie produkuje). Schematyczna linia z Z-010 zostaje.

### Z-011 [P2] Realny „teraz"
- Status: odrzucone
- Zgłoszone: 2026-11-16 (analityk)
- Problem: tryb ostrożny używa statystycznych profili opóźnień, nie bieżących danych GTFS-RT.
- Dowód: nieznane.
- Pliki: js/router.js, tools/collect-delays.mjs.
- Decyzja właściciela (2026-11-27): ODRZUCONE. Kontekst: wymagałoby odpytywania feedów przewoźników przy każdym przeliczeniu, czyli zależności od cudzego serwera na ścieżce krytycznej, przy udokumentowanej w tym projekcie zawodności takich źródeł (Gorzów, Opole, zbiorkom).

### Z-047 [P2] Zapis miasta do użytku offline — decyzja właściciela
- Status: odrzucone
- Zgłoszone: 2026-11-16 (nieznane)
- Problem: strona nie działa offline z danymi rozkładowymi, a użytkownik nie ma jawnego sposobu zapisania miasta na telefonie. Zależy od etapu 3 Z-002.
- Dowód: nieznane.
- Rozwiązanie (szkic z wejścia fali, bez przeglądu rozwiazywacza): przycisk „Zapisz to miasto offline"; zapis `data/<miasto>/*` do nazwanego cache razem z `meta.generated`; widoczna data pobrania; przycisk „Odśwież"; automatyczne unieważnienie po 7 dniach; przycisk „Usuń dane offline". Koszt: kilka MB na telefonie użytkownika.
- Pliki: nieznane.
- Decyzja właściciela (2026-11-27): ODRZUCONE. Zależało od etapu trzeciego Z-002 (service worker), który właściciel odrzucił tego samego dnia.

### Z-039 [P2] Zewnętrzna usługa zbierania błędów (decyzja właściciela)
- Status: odrzucone
- Zgłoszone: nieznane
- Problem: rozwiązanie z Z-025 daje lokalną diagnostykę plus zdarzenie w Analytics po zgodzie. Zewnętrzna usługa (np. Sentry) dałaby stosy i grupowanie, ale oznacza nową zależność runtime na froncie (złamanie nienegocjowalnego ograniczenia projektu), nowego procesora danych w polityce prywatności i możliwy koszt po przekroczeniu darmowego limitu. Kontrakt `setSink` w `js/diag.js` jest punktem wymiany, więc wdrożenie byłoby podmianą samego ujścia.
- Dowód: nieznane.
- Pliki: js/diag.js, js/app.js.
- Decyzja właściciela (2026-11-27): ODRZUCONE. Kontekst: łamie nienegocjowalny zakaz zależności runtime na froncie, dokłada nowego procesora danych do polityki prywatności i może kosztować po przekroczeniu darmowego progu.

## Historia wpisów skróconych w kolejce

<!-- NOWA-HISTORIA -->

### Z-023 — pełny wpis z 2026-11-27 (skrócony w kolejce; treść dosłowna sprzed skrócenia)
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
