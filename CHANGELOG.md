# Changelog

Historia wdrożonych zmian i prac w toku. Najnowsze na górze.
Utrzymuje ten plik wyłącznie agent `kronikarz`. Historia nie jest kasowana.

## W toku

_(pusto)_

## 2026-11-16

### Dodane
- Z-021 Bramka jakości danych: dane z podejrzanym spadkiem (mniej kursów, wzorców, przystanków, linii albo mniejsze pliki niż w poprzednim buildzie) nie trafiają już automatycznie na stronę — takie miasto jest cofane do poprzedniej wersji, pozostałe publikują się normalnie, a workflow zgłasza raport z instrukcją ręcznego przepuszczenia. (pliki: tools/build-data.mjs, tools/check-data.mjs, .github/workflows/refresh-data.yml, README.md, CURRENT_STATE.md; testy: tests/check-data.test.mjs; npm run check: lint czysty, 43/43 testy OK; bramka zadziała od drugiego odświeżenia, bo pierwsze nie ma punktu odniesienia; nie sprawdzone na prawdziwym przebiegu workflow)

### Zmienione
- Z-020 Dostępność: wszystkie kontrolki panelu mają obszar dotyku co najmniej 44x44 px (ikonki nagłówka zostają wizualnie małe), poprawiony kontrast nieaktywnych etykiet i obramowań pól, widoczny obrys fokusu na wszystkich kontrolkach, a przy systemowym ustawieniu „ogranicz ruch" strona i mapa nie animują niczego. Na telefonie pola mają 16 px, żeby iOS Safari nie przybliżał strony. (pliki: css/style.css, js/map.js, js/app.js; testy: tests/a11y-css.test.mjs; npm run check: lint czysty, 43/43 testy OK; nie sprawdzone w przeglądarce: prawdziwa emulacja prefers-reduced-motion, dymek trasy, zachowanie zoomu z klawiatury)

### Wewnętrzne
- Wprowadzono stały zespół agentów (`analityk`, `rozwiazywacz`, `esteta`,
  `wdrozeniowiec`, `kronikarz`, `sekretarz`) w `.claude/agents/`.
- Dodano `CLAUDE.md` z zasadami pracy w projekcie oraz pliki pamięci projektu
  `ZADANIA-DO-ZROBIENIA.md` i `CHANGELOG.md`. (bez zmian w kodzie strony)
- Zlikwidowano stary backlog `zadania.md`. Analityk zweryfikował jego zawartość wobec kodu: większość punktów była już zrobiona albo straciła sens, a 18 żywych zadań przeniesiono do `ZADANIA-DO-ZROBIENIA.md` jako Z-001..Z-018. Plik usunięty z repozytorium (zostaje w historii gita). (bez zmian w kodzie strony)
- Z audytu analityka doszło 8 nowych ustaleń jako Z-019..Z-026, a z wdrożeń 5 kolejnych jako Z-027..Z-031.
