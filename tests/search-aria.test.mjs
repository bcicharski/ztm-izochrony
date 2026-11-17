// Z-026 (escapowanie HTML) i Z-027 (ARIA combobox wyszukiwarek) — bez DOM.
// esc/optionId żyją w js/uilogic.js (Z-046) i są importowane; app.js czytamy
// jako tekst tylko tam, gdzie sprawdzamy powiązanie z DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { esc, optionId, mergeSearchResults } from '../js/uilogic.js';

const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('esc: wszystkie pięć znaków', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('esc: & jest podmieniany pierwszy (brak podwójnego escapowania własnych encji)', () => {
  assert.equal(esc('<b>'), '&lt;b&gt;');
  assert.equal(esc('"x"'), '&quot;x&quot;');
});

test('esc: standardowo podmienia & zawsze (&amp; -> &amp;amp;) — świadoma decyzja', () => {
  assert.equal(esc('&amp;'), '&amp;amp;');
});

test('esc: nie-stringi i zwykły tekst', () => {
  assert.equal(esc(12), '12');
  assert.equal(esc('Plac Wolności 5'), 'Plac Wolności 5');
});

test('esc: każdy znak specjalny osobno', () => {
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('>'), '&gt;');
  assert.equal(esc('"'), '&quot;');
  assert.equal(esc("'"), '&#39;');
});

test('esc: pusty string, null i undefined (String() -> tekst, bez wyjątku)', () => {
  assert.equal(esc(''), '');
  assert.equal(esc(null), 'null');
  assert.equal(esc(undefined), 'undefined');
});

test('esc: tekst bez znaków specjalnych wraca niezmieniony', () => {
  const s = 'Żółć 12/3 – ul. Długa, Gdańsk (przystanek)';
  assert.equal(esc(s), s);
});

test('esc: znaki w środku tekstu i powtórzone', () => {
  assert.equal(esc('a<b>&c'), 'a&lt;b&gt;&amp;c');
  assert.equal(esc('<<>>'), '&lt;&lt;&gt;&gt;');
});

test('esc: wejście w atrybut nie wyłamuje się z cudzysłowu', () => {
  assert.ok(!esc('" onmouseover="x').includes('"'));
});

test('optionId: unikalne i rozłączne między listami', () => {
  assert.equal(optionId('searchResults', 3), 'searchResults-opt-3');
  const ids = new Set();
  for (const l of ['searchResults', 'searchResults2']) for (let i = 0; i < 5; i++) ids.add(optionId(l, i));
  assert.equal(ids.size, 10);
});

for (const [inputId, listId, statusId] of [
  ['searchInput', 'searchResults', 'searchStatus'],
  ['searchInput2', 'searchResults2', 'searchStatus2'],
]) {
  test(`index.html: ${inputId} ma komplet ARIA combobox`, () => {
    const input = html.match(new RegExp(`<input id="${inputId}"[^>]*>`))?.[0];
    assert.ok(input, 'brak pola');
    assert.match(input, /role="combobox"/);
    assert.match(input, /aria-autocomplete="list"/);
    assert.match(input, /aria-expanded="false"/);
    assert.match(input, new RegExp(`aria-controls="${listId}"`));
    const ul = html.match(new RegExp(`<ul[^>]*id="${listId}"[^>]*>`))?.[0];
    assert.ok(ul, 'brak listy');
    assert.match(ul, /role="listbox"/);
    const st = html.match(new RegExp(`<p[^>]*id="${statusId}"[^>]*>`))?.[0];
    assert.ok(st && /role="status"/.test(st), 'brak komunikatu role=status');
  });
}

test('app.js: li.empty nie występuje w listboxie, a opcje mają id i aria-selected', () => {
  assert.ok(!/className = 'empty'/.test(appSrc));
  assert.match(appSrc, /li\.id = optionId\(listId, i\)/);
  assert.match(appSrc, /import \{[^}]*\boptionId\b[^}]*\} from '\.\/uilogic\.js'/);
  assert.match(appSrc, /aria-activedescendant/);
});

// Komunikaty statusu: element jest w drzewie od początku, zmienia się tylko tekst.
const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

test('style.css: brak martwych reguł li.empty', () => {
  assert.ok(!/li\.empty/.test(css));
});

test('style.css: .hint nie ustawia display (atrybut hidden działa), pusty .hint bez marginesu', () => {
  const hint = css.match(/\n\.hint \{[^}]*\}/)?.[0];
  assert.ok(hint && !/display\s*:/.test(hint));
  assert.match(css, /\.hint:empty\s*\{\s*margin:\s*0/);
});

test('statusy wyszukiwarek: bez atrybutu hidden, a app.js czyści tekst zamiast ukrywać', () => {
  for (const id of ['searchStatus', 'searchStatus2']) {
    const st = html.match(new RegExp(`<p[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(st && !/\shidden/.test(st), `${id} nie może mieć hidden`);
  }
  assert.ok(!/status\.hidden|searchStatus2'\)\.hidden/.test(appSrc));
  assert.match(appSrc, /status\.textContent = ''/);
});

// Z-056: wiersz wyniku = ikona + nazwa + rodzaj; numeracja id po scalonej liście.
test('app.js: wiersz wyniku niesie rodzaj (chip + aria-label), id po scalonej liście', () => {
  assert.match(appSrc, /className = 'res-kind'/);
  assert.ok(appSrc.includes("setAttribute('aria-label', `${item.label}, ${kind}`)"));
  assert.ok(appSrc.includes('mergeSearchResults(stops, places)'));
  // etykieta pola z rows[i].label, nie z textContent wiersza (chip wpadłby do pola)
  assert.match(appSrc, /input.value = r.label/);
  assert.ok(!/input.value = r.li.textContent/.test(appSrc));
});

test('numeracja optionId scalonej listy jest ciągła', () => {
  const merged = mergeSearchResults([{ name: 'A', lat: 0, lon: 0 }], [{ label: 'B', lat: 0, lng: 0 }, { label: 'C', lat: 0, lng: 0 }]);
  const ids = merged.map((_, i) => optionId('searchResults', i));
  assert.deepEqual(ids, ['searchResults-opt-0', 'searchResults-opt-1', 'searchResults-opt-2']);
});

test('style.css: chip .res-kind i nazwa z wielokropkiem', () => {
  assert.match(css, /.res-kind {[^}]*flex: none/);
  assert.match(css, /.res-name {[^}]*text-overflow: ellipsis/);
});

// --- komunikaty dla czytnika, Enter przy krótkim zapytaniu, link awaryjny, lokalizacja ---
import { locateUnavailableReason, ADDRESS_QUERY_MIN, ADDRESS_QUERY_HINT } from '../js/uilogic.js';

test('locateUnavailableReason: HTTP, brak geolokalizacji, działa', () => {
  assert.match(locateUnavailableReason(false, true), /HTTPS/);
  assert.match(locateUnavailableReason(true, false), /nie udostępnia/);
  assert.equal(locateUnavailableReason(true, true), null);
});

test('Enter przy krótkim zapytaniu: komunikat do #searchStatus, próg 3 zachowany', () => {
  assert.equal(ADDRESS_QUERY_MIN, 3);
  assert.equal(ADDRESS_QUERY_HINT, 'Wpisz co najmniej 3 znaki, aby szukać adresu.');
  assert.ok(appSrc.includes('query.length < ADDRESS_QUERY_MIN'));
  assert.ok(/if \(query\.length < ADDRESS_QUERY_MIN\) \{[^}]*status\.textContent = ADDRESS_QUERY_HINT/.test(appSrc));
});

test('komunikaty lokalizacji i eksportu idą przez say() -> announce()', () => {
  assert.ok(/function say\(text\) \{[^}]*announce\(text\)/.test(appSrc));
  for (const t of ['Ustalam lokalizację…', 'Jesteś poza obszarem', 'Zapisano plik', 'Nie udało się przygotować pliku', 'geoErrorMessage(err?.code)']) {
    const i = appSrc.indexOf(t);
    assert.ok(i > 0, t);
    assert.ok(/say\(/.test(appSrc.slice(Math.max(0, i - 40), i)), `${t}: bez say()`);
  }
});

test('Kopiuj link: awaryjne pole #shareText zamiast etykiety przycisku', () => {
  assert.ok(/id="shareText"[^>]*readonly[^>]*hidden/.test(html));
  assert.ok(!appSrc.includes('btn.textContent = location.href'));
  assert.ok(appSrc.includes("ta.value = location.href"));
  assert.ok(appSrc.includes("$('shareText').hidden = true"));
});

test('#locateBtn niedostępny: aria-disabled + aria-describedby na #locateHint', () => {
  assert.ok(/id="locateHint"[^>]*hidden/.test(html));
  assert.ok(appSrc.includes("btn.setAttribute('aria-disabled', 'true')"));
  assert.ok(appSrc.includes("'aria-describedby', 'locateHint'"));
  assert.ok(!appSrc.includes("$('locateBtn').disabled"));
});
