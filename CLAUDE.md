# CLAUDE.md — zasady pracy w tym projekcie

Ten plik czyta każdy model i każdy agent wchodzący w to repozytorium.
Dzięki niemu ciągłość stylu pracy nie zależy od pamięci wątku.
Jest krótki celowo: każdy agent płaci za jego odczyt przy każdym wywołaniu.

---

## 1. Projekt w skrócie

„Dokąd dojadę?" — statyczna strona z izochronami komunikacji miejskiej
(18 miast i aglomeracji). Pokazuje, jak daleko można dotrzeć w 10/20/30/45/60+
minut, z przesiadkami i opcjonalnym dojściem pieszym.

- Vanilla JS, ES modules, **bez frameworka i bez build-stepu dla frontu**.
- **Bez backendu.** Hosting: GitHub Pages. Nic nie może wymagać serwera.
- Ciężkie obliczenia w **Web Workerze**; wątek główny zostaje responsywny.
  Fallback na wątek główny przy braku OffscreenCanvas lub `engine=main` w URL.
- `js/` — front i silnik: `app.js`, `map.js`, `engine.js`, `isochrone.js`,
  `router.js`, `walknet.js`, `walkgrid.js`, `worker.js`, `data.js`, `stats.js`.
- `tools/` — skrypty Node prekompilujące GTFS, granice, maski wody, opóźnienia.
- `data/cities.json` — definicje miast; `data/<miasto>/` — gotowe dane.
- `tests/` — `node --test`. Lint: ESLint (`eslint.config.js`).

Komendy:

```bash
npm run check
```

```bash
npm run serve
```

`npm run check` = lint + testy. Nic nie jest skończone, dopóki nie przechodzi.

### Nienegocjowalne ograniczenia
- Zero zależności runtime dodawanych do frontu.
- Nowe miasto albo nowy feed = zmiana w `data/cities.json`, **nie w logice**.
- Rozmiar pobieranych danych ma znaczenie — użytkownik wchodzi z telefonu.
- Istniejące parametry URL i istniejące pliki w `data/` muszą dalej działać.
- `data/<miasto>/` to wynik długiej prekompilacji — nie nadpisywać bez potrzeby.
- Zmiana formatu plików w `data/`: najpierw dekoder rozchodzi się osobnym commitem,
  dopiero potem dane (nowe dane przy starym kodzie w cache przeglądarki psują stronę).

---

## 2. Oszczędność tokenów (priorytet)

- **Nie opisuj w czacie, który agent co robi.** Żadnej narracji wywołań, żadnych
  komunikatów typu „teraz uruchamiam analityka".
- Właściciel dostaje **wyłącznie** podsumowanie od `kronikarza`. Reszta pracy
  agentów idzie do plików, nie do czatu.
- Zero pochwał, zero wypełniaczy, zero powtarzania, co już ustalone.
- Raporty agentów: krótkie, w zadanym formacie. Bez streszczania samego siebie.
- Szczegóły trafiają do `ZADANIA-DO-ZROBIENIA.md` i `CHANGELOG.md`, nie do
  odpowiedzi w czacie.
- **Czytaj wycinki, nie całe pliki**: `Grep` po symbolu, potem `Read` z `offset`/`limit`.
  Dużych plików (`js/app.js`, `css/style.css`, `tools/build-data.mjs`) nie wczytuj w całości.
- **Nigdy w całości:** `ZADANIA-ARCHIWUM.md`, `CHANGELOG.md`, `zadania.md`.
  Szukaj po identyfikatorze `Z-NNN` albo słowie kluczowym. Wyjątek: właściciel wprost każe.
  Jedyny plik pamięci, który wolno czytać w całości, to aktywna kolejka
  `ZADANIA-DO-ZROBIENIA.md`.
- Wynik testów przycinaj: `npm run check 2>&1 | tail -40`.
- Podgląd w przeglądarce: odczyt DOM i wyliczonych stylów zamiast zrzutów ekranu,
  o ile pytanie nie jest czysto wizualne.

---

## 3. Agenci

Definicje: `.claude/agents/*.md`.

| Agent | Model | Uprawnienia | Rola |
|---|---|---|---|
| `liczytokena` | haiku | Read, Grep, Glob, Bash (tylko odczyt) | Pilnuje budżetu tokenów. Szacuje koszt zadań i układa plan fali. Nie zmienia kodu. |
| `analityk` | sonnet | Read, Grep, Glob, Bash (tylko odczyt) | Znajduje obszary do poprawy, przypisuje trudność S/M/L. Nie projektuje. |
| `rozwiazywacz` | opus | Read, Grep, Glob, WebSearch, WebFetch | Projektuje architekturę dla zadań M i L. Nie pisze kodu. |
| `esteta` | sonnet | Read, Grep, Glob, WebSearch, WebFetch | Określa wygląd i UX, spójnie z obecnym designem. Nie pisze kodu. |
| `wdrozeniowiec` | sonnet | pełne | Wdraża zadanie w kodzie + testy. Nie commituje. |
| `kronikarz` | haiku | Read, Write, Edit, Glob, Grep | Utrzymuje trzy pliki pamięci i **jako jedyny mówi do właściciela** (podsumowanie fali). |

### Przepływ fali

```
liczytokena       plan fali: ile zadań mieści się w limicie i w jakiej kolejności
                  (wątek główny podaje mu stan limitów — sam go nie widzi)
analityk          TYLKO gdy brak zadań „zaprojektowane", na zlecenie właściciela
                  albo ≥ 5 fal od ostatniej analizy; skan przyrostowy
per zadanie, trasa wg trudności:
  S               wdrozeniowiec
  M, L            rozwiazywacz -> (esteta, jeśli „Dotyka UI: tak") -> wdrozeniowiec
wdrozeniowiec     kod, testy, npm run check; karta wdrożenia z wynikiem
kronikarz         RAZ po fali albo po każdych 3 zadaniach (co pierwsze):
                  zapis pamięci + podsumowanie dla właściciela
wątek główny      commit i push (po zapisie pamięci)
```

Zadanie `zaprojektowane` idzie prosto do wdrożenia. Agent startuje tylko wtedy,
gdy istnieje jego wejście.

### Trudność zadania (przypisuje `analityk`, wątek główny respektuje)
- **S** — najwyżej 2 pliki, żaden z `engine.js`, `isochrone.js`, `router.js`,
  `walkgrid.js`, `worker.js`; bez zmiany formatu danych, URL-i ani kontraktu
  worker ↔ main; bez nowej zależności; istnieje wzorzec do rozszerzenia.
- **M** — wiele plików albo nowa czysta funkcja/moduł z testami, bez silnika,
  workera i formatu danych; trzeba wybrać podejście.
- **L** — silnik, worker, format danych, kontrakt worker ↔ main, > 5 plików,
  rozpoznanie w sieci albo przeliczenie danych miast.

Wątpliwość między dwiema kategoriami = wyższa. Gdy `wdrozeniowiec` zwróci
`ESKALACJA` przy zadaniu S, zadanie dostaje M/L i idzie przez `rozwiazywacza`.
Zadanie M/L nigdy nie schodzi do trasy S.

### Przekazywanie między agentami (wątek główny)
Następny agent dostaje **tylko pola, których potrzebuje**, nie pełne odpowiedzi
poprzednich:
- `rozwiazywacz`: karta zadania (Z-NNN, problem, dowód, pliki);
- `esteta`: karta + sekcje „Architektura" i „Dotyka UI" z projektu;
- `wdrozeniowiec`: karta + projekt (M/L) + specyfikacja estety;
- `kronikarz`: sekcje „Do pamięci projektu", karty wdrożeń, lista zadań wstrzymanych.

Liczby w zleceniu zawsze z podanym źródłem. Liczba bez źródła jest niezweryfikowana —
adresat ma ją zmierzyć, zanim zbuduje na niej cokolwiek.

### Autonomia
Agenci działają autonomicznie. Zadanie wraca do właściciela **tylko** gdy jego karta
ma `Decyzja właściciela: tak`, czyli gdy zmiana:

- łamie kompatybilność (adresy URL, format plików w `data/`, wymuszone
  przeliczenie danych miejskich),
- usuwa albo wyłącza istniejącą funkcję,
- dodaje zależność, serwis zewnętrzny, cokolwiek, co może kosztować pieniądze
  albo wymagać serwera,
- zmienia kierunek produktu: nowa duża funkcja, nowy priorytet, rezygnacja
  z czegoś z backlogu,
- przebudowuje silnik izochron albo większość plików w `js/`,
- jest nieodwracalna: nadpisanie danych, usuwanie plików, publikacja.

Pole wypełniają `analityk` i `rozwiazywacz`; wątek główny sprawdza je **przed
wdrożeniem**. Zadanie z „tak" nie jest wdrażane, trafia do `kronikarza` jako
„czeka na decyzję" (pytanie ląduje w podsumowaniu), a **fala jedzie dalej** z
następnym zadaniem. Wszystko poza listą idzie bez pytania.

### Limity
- `wdrozeniowiec`: dwa kolejne nieudane `npm run check` z tą samą przyczyną = stop.
  Zadanie wraca do kolejki jako `nowe` z notatką o blokadzie, fala jedzie dalej.
  Ponowna próba w tej samej fali tylko za zgodą właściciela.
- Fala kończy się, gdy pozostały limit spada poniżej 15% (rezerwa na `kronikarza`).
- Zadanie, które nie mieści się w budżecie w całości, czeka — połowa wdrożenia
  jest warta mniej niż zero.

---

## 4. Kto zapisuje który plik

Jeden plik ma jednego właściciela — żeby zapisy się nie nadpisywały.

| Plik | Zapisuje |
|---|---|
| `js/`, `css/`, `tools/`, `tests/`, `index.html` | `wdrozeniowiec` |
| `data/`, `data/cities.json` | `wdrozeniowiec` (z ostrożnością) |
| `ZADANIA-DO-ZROBIENIA.md` | **tylko** `kronikarz` |
| `ZADANIA-ARCHIWUM.md` | **tylko** `kronikarz` |
| `CHANGELOG.md` | **tylko** `kronikarz` |
| `README.md`, `CURRENT_STATE.md` | `wdrozeniowiec`, gdy zmieniło się zachowanie strony |
| `zadania.md` | nikt — archiwum, tylko do czytania |
| `CLAUDE.md`, `.claude/agents/*` | tylko na wyraźną prośbę właściciela |

Dwóch agentów nigdy nie pisze równolegle do tych samych plików.

### `zadania.md` a kolejka
`zadania.md` to stary, duży backlog — **archiwum historyczne, tylko do odczytu**.
Nowa kolejka pracy to `ZADANIA-DO-ZROBIENIA.md`. Przed dopisaniem zadania
sprawdź (`Grep`) `zadania.md` i `ZADANIA-ARCHIWUM.md`, żeby nie zgłaszać rzeczy
już zrobionej albo świadomie odrzuconej.

---

## 5. Pamięć projektu: trzy pliki

### `ZADANIA-DO-ZROBIENIA.md` — aktywna kolejka (mały, wolno czytać w całości)
Sekcje: `W toku`, `Zaprojektowane`, `Nowe`. Zadania z trwałymi identyfikatorami
`Z-NNN` (numer nigdy nie jest używany ponownie). Nagłówek zawiera wskaźniki:
najwyższy użyty numer i „Ostatnia analiza" (data + commit). Wpis ma **najwyżej 15 linii**:
problem, dowód, trudność, decyzja właściciela, rozwiązanie i UX w 2–4 zdaniach,
pliki, sposób weryfikacji. Szczegóły wdrożenia idą do `CHANGELOG.md`.

### `ZADANIA-ARCHIWUM.md` — zamknięte (duży, tylko `Grep` po `Z-NNN`)
Sekcje: `Zrobione`, `Odrzucone`, `Historia wpisów skróconych w kolejce`.
Zadanie zamknięte **przenosi się** dosłownie z kolejki do archiwum, nie wycina.
Skrócenie wpisu w kolejce najpierw kopiuje jego pełny tekst do sekcji historii.

### `CHANGELOG.md` — duży, tylko `Grep`/`Read` z limitem
Co wdrożono i nad czym trwa praca. Najnowsze na górze. Sekcja `## W toku` plus
sekcje z datami ISO i podziałem: `Dodane`, `Zmienione`, `Naprawione`, `Usunięte`,
`Wewnętrzne`. Każdy wpis wdrożenia podaje `Z-NNN`, efekt dla użytkownika,
zmienione pliki, testy i dosłowny wynik `npm run check`.

Historia nie jest kasowana. Dokładne szablony: `.claude/agents/kronikarz.md`.

---

## 6. Konwencje kodu i języka

- Czat, komentarze w kodzie, komunikaty UI, treść plików pamięci — **po polsku**.
- Nazwy identyfikatorów, funkcji, plików — po angielsku, jak w obecnym kodzie.
- Daty — ISO (`2026-11-16`), nigdy „wczoraj", „w zeszłym tygodniu".
- Rozszerzaj istniejące moduły i wzorce, nie twórz równoległych.
- Najmniejsza zmiana realizująca projekt w całości. Zauważony, niepowiązany
  problem **zgłasza się** jako nowe `Z-NNN`, nie naprawia po drodze.
- Nowa logika = nowe testy w `tests/`.
- Nowy kolor w CSS = nowy token w `:root`, nigdy wartość na sztywno. Aktualną
  listę tokenów daje `Grep "^\s*--[a-z-]+:" css/style.css` (są też warianty trybu
  ciemnego, `--tap`, `--map-bg`, `--dot-a/b`, `--shadow-rgb`, `--on-accent`).
  Breakpoint mobilny: `max-width: 560px`.
- Dostępność: kontrast minimum 4.5:1, widoczny focus, obsługa klawiatury,
  pola dotykowe minimum 44x44 px (`var(--tap)`), `prefers-reduced-motion`.
- Końcówki linii: LF (`.gitattributes`).

---

## 7. Git

- **Commit i push po wdrożeniu są autonomiczne** — bez pytania właściciela
  (decyzja właściciela z 2026-11-16). Wykonuje je wątek główny, nie `wdrozeniowiec`.
  Warunki: `npm run check` przechodzi, a `kronikarz` zapisał `CHANGELOG.md`
  i `ZADANIA-DO-ZROBIENIA.md` (po fali albo po 3 zadaniach).
- Autonomia nie obejmuje rzeczy nieodwracalnych poza kodem: nadpisania
  `data/<miasto>/`, usuwania plików danych, `git push --force`, zmian historii.
  To nadal wymaga zgody właściciela.
- Praca na `main`, chyba że właściciel powie inaczej.
- Commit message: zwięźle, po polsku, w trybie orzekającym („Dodano…",
  „Poprawiono…"), z identyfikatorem `Z-NNN`, jeśli dotyczy.
