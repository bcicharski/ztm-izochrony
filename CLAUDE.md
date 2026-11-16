# CLAUDE.md — zasady pracy w tym projekcie

Ten plik czyta każdy model i każdy agent wchodzący w to repozytorium.
Dzięki niemu ciągłość stylu pracy nie zależy od pamięci wątku.

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

---

## 2. Oszczędność tokenów (priorytet)

- **Nie opisuj w czacie, który agent co robi.** Żadnej narracji wywołań, żadnych
  komunikatów typu „teraz uruchamiam analityka".
- Właściciel dostaje **wyłącznie** podsumowanie od `sekretarza`. Reszta pracy
  agentów idzie do plików, nie do czatu.
- Zero pochwał, zero wypełniaczy, zero powtarzania, co już ustalone.
- Raporty agentów: krótkie, w zadanym formacie. Bez streszczania samego siebie.
- Szczegóły trafiają do `ZADANIA-DO-ZROBIENIA.md` i `CHANGELOG.md`, nie do
  odpowiedzi w czacie.
- Czytaj wycinki plików, nie całe pliki, gdy wystarczy wycinek.

---

## 3. Agenci

Definicje: `.claude/agents/*.md`.

| Agent | Model | Uprawnienia | Rola |
|---|---|---|---|
| `analityk` | sonnet | Read, Grep, Glob, Bash (tylko odczyt) | Znajduje obszary do poprawy — kod i możliwości strony. Nie projektuje. |
| `rozwiazywacz` | opus | Read, Grep, Glob, WebSearch, WebFetch | Projektuje architekturę rozwiązania. Nie pisze kodu. |
| `esteta` | sonnet | Read, Grep, Glob, WebSearch, WebFetch | Określa wygląd i UX, spójnie z obecnym designem. Nie pisze kodu. |
| `wdrozeniowiec` | sonnet | pełne | Wdraża rozwiązanie w kodzie + testy. |
| `kronikarz` | haiku | Read, Write, Edit, Glob, Grep | Utrzymuje `ZADANIA-DO-ZROBIENIA.md` i `CHANGELOG.md`. Nic więcej. |
| `sekretarz` | haiku | Read, Grep, Glob | Rozmawia z właścicielem. Decyduje, kiedy potrzebna jest jego decyzja. |

### Przepływ pracy

```
analityk          znajduje problemy
  -> kronikarz    zapisuje je jako Z-NNN w ZADANIA-DO-ZROBIENIA.md
rozwiazywacz      projektuje rozwiązanie dla wybranego Z-NNN
esteta            dokłada wygląd i UX, jeśli zmiana dotyka interfejsu
  -> kronikarz    dopisuje projekt i specyfikację do tego samego Z-NNN
                  oraz wpis w CHANGELOG.md -> sekcja „W toku"
wdrozeniowiec     wdraża, dopisuje testy, uruchamia npm run check
  -> kronikarz    przenosi wpis z „W toku" do sekcji z datą w CHANGELOG.md,
                  ustawia status Z-NNN na „zrobione"
sekretarz         jedno krótkie podsumowanie dla właściciela
```

### Autonomia
Agenci działają autonomicznie. Praca zatrzymuje się i wraca do właściciela
**tylko** wtedy, gdy `sekretarz` uzna, że to konieczne:

- złamanie kompatybilności (adresy URL, format plików w `data/`, wymuszone
  przeliczenie danych miejskich),
- usunięcie albo wyłączenie istniejącej funkcji,
- nowa zależność, nowy serwis zewnętrzny, cokolwiek, co może kosztować pieniądze
  albo wymagać serwera,
- zmiana kierunku produktu: nowa duża funkcja, nowy priorytet, rezygnacja
  z czegoś z backlogu,
- przebudowa dotykająca silnika izochron albo większości plików w `js/`,
- cokolwiek nieodwracalnego: nadpisanie danych, usuwanie plików, publikacja.

Wszystko poza tą listą idzie dalej bez pytania.

---

## 4. Kto zapisuje który plik

Jeden plik ma jednego właściciela — żeby zapisy się nie nadpisywały.

| Plik | Zapisuje |
|---|---|
| `js/`, `css/`, `tools/`, `tests/`, `index.html` | `wdrozeniowiec` |
| `data/`, `data/cities.json` | `wdrozeniowiec` (z ostrożnością) |
| `ZADANIA-DO-ZROBIENIA.md` | **tylko** `kronikarz` |
| `CHANGELOG.md` | **tylko** `kronikarz` |
| `README.md`, `CURRENT_STATE.md` | `wdrozeniowiec`, gdy zmieniło się zachowanie strony |
| `zadania.md` | nikt — archiwum, tylko do czytania |
| `CLAUDE.md`, `.claude/agents/*` | tylko na wyraźną prośbę właściciela |

Dwóch agentów nigdy nie pisze równolegle do tych samych plików.

### `zadania.md` a `ZADANIA-DO-ZROBIENIA.md`
`zadania.md` to stary, duży backlog — **archiwum historyczne, tylko do odczytu**.
Nowa kolejka pracy to `ZADANIA-DO-ZROBIENIA.md`. Przed dopisaniem zadania
sprawdź `zadania.md`, żeby nie zgłaszać rzeczy już zrobionej albo świadomie
odrzuconej.

---

## 5. Dwa pliki pamięci projektu

### `ZADANIA-DO-ZROBIENIA.md`
Kolejka pracy. Zadania z trwałymi identyfikatorami `Z-NNN` (numer nigdy nie jest
używany ponownie). Sekcje: `W toku`, `Zaprojektowane`, `Nowe`, `Zrobione`,
`Odrzucone`. Każde zadanie nosi problem, dowód, projekt rozwiązania,
specyfikację wyglądu, listę plików i sposób weryfikacji.

### `CHANGELOG.md`
Co wdrożono i nad czym trwa praca. Najnowsze na górze. Sekcja `## W toku` plus
sekcje z datami ISO i podziałem: `Dodane`, `Zmienione`, `Naprawione`, `Usunięte`,
`Wewnętrzne`. Każdy wpis wdrożenia podaje `Z-NNN`, efekt dla użytkownika,
zmienione pliki, testy i dosłowny wynik `npm run check`.

Historia nie jest kasowana. Zadanie zrobione **przenosi się**, nie wycina.

Dokładne szablony obu plików: `.claude/agents/kronikarz.md`.

---

## 6. Konwencje kodu i języka

- Czat, komentarze w kodzie, komunikaty UI, treść `ZADANIA-DO-ZROBIENIA.md`
  i `CHANGELOG.md` — **po polsku**.
- Nazwy identyfikatorów, funkcji, plików — po angielsku, jak w obecnym kodzie.
- Daty — ISO (`2026-11-16`), nigdy „wczoraj", „w zeszłym tygodniu".
- Rozszerzaj istniejące moduły i wzorce, nie twórz równoległych.
- Najmniejsza zmiana realizująca projekt w całości. Zauważony, niepowiązany
  problem **zgłasza się** jako nowe `Z-NNN`, nie naprawia po drodze.
- Nowa logika = nowe testy w `tests/`.
- Nowy kolor w CSS = nowy token w `:root`, nigdy wartość na sztywno.
  Obecne tokeny: `--surface`, `--ink`, `--muted`, `--line`, `--accent`,
  `--radius`, `--shadow`. Breakpoint mobilny: `max-width: 560px`.
- Dostępność: kontrast minimum 4.5:1, widoczny focus, obsługa klawiatury,
  pola dotykowe minimum 44x44 px, `prefers-reduced-motion`.

---

## 7. Git

- **Nie commitować i nie pushować, dopóki właściciel o to nie poprosi.**
- Praca na `main`, chyba że właściciel powie inaczej.
- Commit message: zwięźle, po polsku, w trybie orzekającym („Dodano…",
  „Poprawiono…"), z identyfikatorem `Z-NNN`, jeśli dotyczy.
