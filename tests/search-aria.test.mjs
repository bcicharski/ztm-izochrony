// Z-026 (escapowanie HTML) i Z-027 (ARIA combobox wyszukiwarek) — bez DOM.
// esc/optionId żyją w js/uilogic.js (Z-046) i są importowane; app.js czytamy
// jako tekst tylko tam, gdzie sprawdzamy powiązanie z DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { esc, optionId } from '../js/uilogic.js';

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
