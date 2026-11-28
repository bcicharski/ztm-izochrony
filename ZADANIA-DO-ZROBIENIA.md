# Zadania do zrobienia

Aktywna kolejka pracy agentów: `w toku`, `zaprojektowane`, `nowe`. Utrzymuje ją wyłącznie agent `kronikarz`.
Zamknięte zadania (`zrobione`, `odrzucone`) i pełne historie skróconych wpisów są w `ZADANIA-ARCHIWUM.md`
— **tego pliku nie czyta się w całości**, tylko `Grep` po identyfikatorze.
Identyfikatory `Z-NNN` są trwałe — numer nigdy nie jest używany ponownie.
Statusy: `nowe` -> `zaprojektowane` -> `w toku` -> `zrobione` -> `odrzucone`.

Stary backlog `zadania.md` to archiwum, tylko do czytania.

## Wskaźniki (aktualizuje kronikarz)

- Najwyższy użyty numer: Z-090 (następne zadanie dostaje Z-091).
- Ostatnia analiza: nieznane (pierwsza fala po migracji ustawi datę i hash commita; `analityk` skanuje przyrostowo od tego commita).

## Kolejność ustalona z właścicielem

Data ustalenia: 2026-11-27 (zastępuje kolejność z 2026-11-24, zachowaną niżej jako historia).
- Praca autonomiczna, w tej kolejności:
  - Z-019 — ZAMKNIĘTE 2026-11-28 (zrobione częściowo: Szczecin wdrożony 2026-11-27; GZM odrzucony jako niewykonalny po naszej stronie; wpis w „Zrobione").
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

### Z-090 [P1] Olsztyn i Opole kończą rozkład 2026-11-30
- Status: nowe
- Zgłoszone: 2026-11-28 (kronikarz; wydzielone z Z-051 przy jego zamknięciu)
- Trudność: nieznane        Decyzja właściciela: nie
- Problem: Olsztyn i Opole mają `feedEndDate` 20261130. Automat `refresh-data.yml` (cron `30 3 * * 1`, poniedziałki 03:30 UTC) rusza 2026-11-30, w ostatni dzień ważności obu rozkładów. Jeśli przewoźnicy opublikowali paczki grudniowe, przebieg je weźmie (Olsztyn: `resolve: "html-latest"`). Jeśli nie — od 2026-12-01 oba miasta pokażą ostrzeżenie o nieaktualnym rozkładzie. Bramka `tools/check-data.mjs` (Z-081) nie dopuści podmiany na starsze dane. Dla porównania: Łódź 20261231, Gorzów 20261230 (Gorzów: Z-055).
- Dowód: `data/olsztyn/meta.json`, `data/opole/meta.json` — `feedEndDate` 20261130 (pomiar 2026-11-28). Opole: wpis Z-051 podawał termin 2026-11-16; pomiar pokazuje nowszą paczkę (Z-054), stary termin jest nieaktualny.
- Rozwiązanie: nic do wdrożenia przed przeglądem. Przegląd 2026-11-30 po przebiegu automatu: jeśli `feedEndDate` nadal 20261130, sprawdzić, czy przewoźnicy wystawili paczki grudniowe. Decyzja o ewentualnym ręcznym wgraniu należy do właściciela (zmiana danych).
- Pliki: data/cities.json, tools/fetch-feeds.mjs, data/olsztyn/meta.json, data/opole/meta.json.
- Jak sprawdzić: po przebiegu 2026-11-30 odczytać `feedEndDate` w obu `meta.json`; po 2026-12-01 sprawdzić ostrzeżenie `#dataWarn` dla obu miast. Niezweryfikowane: przebieg automatu jeszcze nie nastąpił.
- Termin przeglądu: 2026-11-30, po przebiegu automatu.

### Z-089 [P3] Osadzanie strony w iframe
- Status: nowe
- Zgłoszone: 2026-11-28 (kronikarz; wydzielone z Z-015 przy jego zamknięciu; ustalenie `liczytokena`)
- Trudność: nieznane        Decyzja właściciela: tak (bez niej nie zaczynamy — zmienia kierunek produktu)
- Problem: stronę da się technicznie udostępnić do osadzenia w cudzej witrynie (iframe) bez backendu, ale to nowy sposób używania serwisu, a nie poprawka. Zmienia, gdzie strona się pokazuje. Do rozstrzygnięcia przez właściciela: wygląd w małej ramce, licznik odwiedzin, czy w ramce ma być widoczne źródło danych i przycisk wsparcia.
- Dowód: ustalenie z Z-015 (wykonalne statycznie, `liczytokena`).
- Rozwiązanie: nieznane (brak projektu; najpierw decyzja właściciela).
- Pliki: nieznane.
- Jak sprawdzić: nieznane (do ustalenia po decyzji).

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

