// Z-064 (usunięcie AdSense) i Z-065 (przycisk wsparcia widoczny zawsze) — bramki tekstowe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('css/style.css');
const app = read('js/app.js');

test('Z-064: w index.html nie ma już śladu AdSense', () => {
  for (const s of ['adsbygoogle', 'ad-box', 'ad-label', 'loadAds', 'google-adsense-account', 'googlesyndication', 'adBox']) {
    assert.ok(!html.includes(s), `index.html wciąż zawiera ${s}`);
  }
});

test('Z-064: w style.css nie ma reguł .ad-box ani .ad-label', () => {
  assert.ok(!/\.ad-box|\.ad-label/.test(css));
});

test('Z-064: baner zgody mówi wyłącznie o statystykach, a mechanizm zgody zostaje', () => {
  assert.ok(html.replace(/\s+/g, ' ').includes(
    'Strona korzysta z Google Analytics (anonimowe statystyki) — pliki cookie zapisywane tylko po zgodzie.'));
  assert.ok(!/reklam/i.test(html), 'wzmianka o reklamach w index.html');
  for (const s of ['id="consentBar"', 'id="consentYes"', 'id="consentNo"', 'window.consentGet', 'window.consentSet', 'window.loadGA']) {
    assert.ok(html.includes(s), s);
  }
  assert.match(html, /if \(value === 'granted'\) \{ loadGA\(\); \}/);
  assert.match(html, /if \(consentGet\(\) === 'granted'\) loadGA\(\);/);
});

test('Z-065: dwa linki .coffee-btn — ikona w nagłówku przed #helpBtn i pełny w „Dane i kontakt", różne aria-label', () => {
  const links = [...html.matchAll(/<a class="coffee-btn[^"]*"[^>]*>/g)].map(m => ({ at: m.index, tag: m[0] }));
  assert.equal(links.length, 2);
  const [icon, full] = links;
  const header = html.slice(html.indexOf('<header class="panel-header">'), html.indexOf('</header>'));
  assert.ok(header.includes(icon.tag), 'ikona w .panel-header');
  assert.ok(icon.at < html.indexOf('id="helpBtn"') && html.indexOf('id="helpBtn"') < html.indexOf('id="collapseBtn"'));
  assert.ok(full.at > html.indexOf('id="secData"'), 'pełny link w sekcji Dane i kontakt');
  const label = t => t.match(/aria-label="([^"]+)"/)?.[1];
  assert.ok(label(icon.tag) && label(full.tag) && label(icon.tag) !== label(full.tag));
  for (const l of links) assert.match(l.tag, /target="_blank"/), assert.match(l.tag, /rel="noopener"/);
  assert.match(icon.tag, /href="https:\/\/suppi\.pl\/bcicharski"/);
  assert.ok(html.includes('<span aria-hidden="true">☕</span>'));
});

test('Z-065: ikonowy .coffee-btn ma pole dotykowe var(--tap) przez ::before i nie znika przy zwiniętym panelu', () => {
  assert.match(css, /\.coffee-icon::before,/);
  assert.match(css, /\.coffee-icon::before,[^{]*\{[^}]*min-width: var\(--tap\);[^}]*min-height: var\(--tap\)/);
  assert.match(css, /\.coffee-btn\.coffee-icon \{[^}]*position: absolute;[^}]*right: 100px/);
  assert.ok(!/\.panel\.collapsed[^{]*coffee/.test(css));
  assert.ok(!/\.collapsed[^{]*\.panel-header/.test(css));
});

test('GoatCounter nie dostaje współrzędnych w ścieżce (Z-066)', () => {
  // Domyślnie GoatCounter raportuje pathname razem z query, a nasz adres niesie
  // `p=szerokość,długość`. Nadpisanie `path` musi stać PRZED wczytaniem count.js.
  const i = html.indexOf('window.goatcounter');
  const j = html.indexOf('gc.zgo.at/count.js');
  assert.ok(i > -1, 'brak nadpisania window.goatcounter');
  assert.ok(j > -1, 'brak skryptu GoatCountera');
  assert.ok(i < j, 'nadpisanie path musi poprzedzać wczytanie count.js');
  assert.match(html.slice(i, j), /path:\s*\(\)\s*=>\s*location\.pathname/);
});

// Wycofanie zgody na statystyki (RODO art. 7 ust. 3) — kontrolka w „Dane i kontakt".
const flat = s => s.replace(/\s+/g, ' ');
const consentScript = html.slice(html.indexOf('const GRANT ='), html.indexOf('const choose'));
const clickScript = html.slice(html.indexOf("toggle.addEventListener('click'"), html.indexOf('if (consentGet()) { render()'));

test('wycofanie zgody: wiersz stoi w „Dane i kontakt" przed .credits, a linia stanu to role=status aria-live=polite', () => {
  const row = html.indexOf('id="consentRow"');
  assert.ok(row > html.indexOf('id="secData"'));
  assert.ok(row < html.indexOf('<footer class="credits">'));
  assert.match(html, /<div class="consent-row" id="consentRow" hidden>/);
  assert.match(html, /<p class="hint" id="consentState" role="status" aria-live="polite">/);
});

test('wycofanie zgody: przycisk to <button type="button"> z .share-btn, min-height var(--tap), bez --accent', () => {
  assert.match(html, /<button type="button" class="share-btn consent-toggle" id="consentToggle">/);
  const rule = css.match(/\.consent-row \.consent-toggle \{[^}]*\}/)[0];
  assert.match(rule, /min-height: var\(--tap\)/);
  assert.ok(!rule.includes('--accent'));
  const hint = css.match(/\.consent-row \.hint \{[^}]*\}/)[0];
  assert.match(hint, /margin-bottom: 6px/);
});

test('wycofanie zgody: teksty trzech stanów i trzech komunikatów są dosłowne', () => {
  const src = flat(html);
  for (const t of [
    "'Statystyki Google Analytics: ' + (granted ? 'włączone.' : 'wyłączone.')",
    "const GRANT = 'Wyraź zgodę na statystyki'",
    "const REVOKE = 'Wycofaj zgodę na statystyki'",
    'Zgodę wycofano. Usunęliśmy pliki cookie Google Analytics i wyłączyliśmy pomiar — nic więcej nie jest wysyłane.',
    'Dziękujemy. Statystyki Google Analytics są włączone.',
    'Nie udało się zapisać wyboru w tej przeglądarce. Statystyki Google pozostają wyłączone.',
  ]) assert.ok(src.includes(t), t);
  assert.match(consentScript, /row\.hidden = !decision && !msg/);
});

test('wycofanie zgody: kasuje cookies _ga* i wycisza Analytics w bieżącej sesji, bez przeładowania', () => {
  assert.match(html, /window\.gaClearCookies/);
  assert.match(html, /\^\(_ga\|_ga_\.\+\|_gid\|_gat\.\*\)\$/);
  assert.match(html, /window\['ga-disable-G-9L3F11T91B'\] = true/);
  assert.match(html, /gtag\('consent', 'update', \{ analytics_storage: 'denied' \}\)/);
  assert.match(clickScript, /gaRevoke\(\)/);
  assert.match(clickScript, /gaGrant\(\)/);
  assert.ok(!/location\.reload|\.focus\(/.test(consentScript + clickScript));
});

test('wycofanie zgody: dialog pomocy ma nowe zdanie, a stare o czyszczeniu danych zniknęło', () => {
  const src = flat(html.match(/<dialog id="helpDialog"[\s\S]*?<\/dialog>/)[0]); // polityka prywatności ma własne zdanie o czyszczeniu
  assert.ok(src.includes('Google Analytics (statystyki) działa wyłącznie po wyrażeniu zgody; możesz ją w każdej chwili wycofać albo udzielić ponownie w sekcji „Dane i kontakt” na dole panelu (przy zwiniętym panelu najpierw go rozwiń).'));
  assert.ok(!src.includes('czyszcząc dane strony'));
});

test('wycofanie zgody: nowe teksty nie zawierają słowa „reklam"', () => {
  assert.ok(!/reklam/i.test(html + css));
});

test('Z-068: #privacyDialog — struktura jak #helpDialog, otwierany przyciskiem ze stopki', () => {
  const m = html.match(/<dialog id="privacyDialog" aria-labelledby="privacyTitle">[\s\S]*?<\/dialog>/);
  assert.ok(m, 'brak #privacyDialog z aria-labelledby');
  assert.ok(m[0].includes('id="privacyTitle"') && m[0].includes('>Polityka prywatności</h2>'));
  assert.match(m[0], /<button class="collapse-btn" id="privacyClose" aria-label="[^"]+">/);
  const footer = html.match(/<footer class="credits">[\s\S]*?<\/footer>/)[0];
  assert.match(footer, /<button type="button" class="link-btn" id="privacyOpen">Polityka prywatności<\/button>/);
  assert.ok(footer.indexOf('mailto:') < footer.indexOf('privacyOpen'), 'przycisk po kontakcie mailowym');
  assert.ok(html.includes("getElementById('privacyDialog')") && html.includes('dialog.showModal()'));
});

test('Z-068: treść polityki zawiera zatwierdzone, dosłowne fragmenty', () => {
  const text = html.match(/<dialog id="privacyDialog"[\s\S]*?<\/dialog>/)[0].replace(/\s+/g, ' ');
  for (const s of [
    'Administratorem jest Bartosz Cicharski (osoba prywatna), kontakt: Bartosz@excelninja.pro.',
    'G-9L3F11T91B', '<code>_ga</code>', '<code>_ga_9L3F11T91B</code>',
    '<code>ga-consent</code>', '<code>recent-points</code>', '<code>seen-intro</code>', '<code>panel-sections</code>',
    'href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">informacja Google o danych z witryn partnerskich</a>',
    'GoatCounter', 'OpenStreetMap', 'GitHub Pages (GitHub, Inc.)', 'suppi.pl',
    'Prezesa Urzędu Ochrony Danych Osobowych',
  ]) assert.ok(text.includes(s), s);
});

test('Z-068: okno pomocy odsyła do polityki, a zdanie o wycofaniu zgody zostaje', () => {
  const t = html.replace(/\s+/g, ' ');
  assert.ok(t.includes('Pełne informacje o danych znajdziesz w polityce prywatności — link jest w sekcji „Dane i kontakt” na dole panelu.</p>'));
  assert.ok(!t.includes('pod stopką panelu'));
  assert.ok(t.includes('możesz ją w każdej chwili wycofać albo udzielić ponownie w sekcji „Dane i kontakt” na dole panelu (przy zwiniętym panelu najpierw go rozwiń).'));
  assert.ok(!/reklam/i.test(html));
});

const policy = () => html.match(/<dialog id="privacyDialog"[\s\S]*?<\/dialog>/)[0].replace(/\s+/g, ' ');

test('polityka: akapity o wyszukiwaniu adresu i lokalizacji, dosłownie, po akapicie o mapie', () => {
  const t = policy();
  const addr = '<p><strong>Wyszukiwanie adresu.</strong> Gdy wpiszesz adres i naciśniesz Enter, Twoja przeglądarka pyta o niego serwis Nominatim prowadzony przez OpenStreetMap. Trafia tam wpisany przez Ciebie tekst oraz obszar miasta, w którym szukamy; serwis widzi przy tym Twój adres IP. Nic tam nie wysyłamy, dopóki sam nie poprosisz o wyszukanie — podpowiedzi nazw przystanków działają bez sieci, na danych już wczytanych do przeglądarki.</p>';
  const loc = '<p><strong>Twoja lokalizacja.</strong> Dwa przyciski pytają przeglądarkę o Twoje położenie: „Użyj mojej lokalizacji” przy polu adresu i „Wyśrodkuj na mnie” na mapie. Używamy go wyłącznie na Twoim urządzeniu — do ustawienia punktu startowego i wyśrodkowania mapy. Nie wysyłamy go nigdzie.</p>';
  assert.ok(t.includes(addr));
  assert.ok(t.includes(loc));
  assert.ok(t.indexOf('<strong>Mapa.</strong>') < t.indexOf(addr) && t.indexOf(addr) < t.indexOf(loc));
  assert.ok(/Nominatim/.test(t));
  // polityka wymienia usługę, której adres faktycznie woła app.js
  assert.ok(app.includes('nominatim.openstreetmap.org'));
});

test('polityka: akapit o liczniku nie twierdzi „wyłącznie ścieżkę", dosłowna nowa treść', () => {
  const t = policy();
  assert.ok(!t.includes('wyłącznie ścieżkę adresu'));
  assert.ok(t.includes('<p><strong>Licznik odwiedzin bez zgody.</strong> Niezależnie od powyższego liczymy odwiedziny narzędziem GoatCounter. Nie ustawia ono plików cookie, nie profiluje i nie śledzi Cię między stronami. Przekazujemy mu ścieżkę adresu bez parametrów, więc współrzędne Twojego punktu nie są do niego wysyłane. Sam skrypt licznika przesyła przy tym standardowe dane przeglądarki: adres strony, z której do nas trafiłeś, rozmiar ekranu i identyfikator przeglądarki.</p>'));
});

test('zgoda przy niedostępnej pamięci: decyzja z sesji, kontrolka wycofania i dosłowna linia stanu', () => {
  const choose = html.slice(html.indexOf('const choose'), html.indexOf('toggle.addEventListener'));
  assert.ok(html.includes("'Statystyki Google Analytics: włączone. Tej decyzji nie udało się zapamiętać — przy następnej wizycie zapytamy ponownie.'"));
  assert.match(choose, /if \(consentGet\(\) === value\) \{ render\(\); return; \}/); // odczyt zwrotny po zapisie
  assert.match(choose, /row\.hidden = false;/);
  assert.match(choose, /toggle\.textContent = REVOKE;/);
  assert.match(html, /consentGet\(\) === 'granted' \|\| sessionDecision === 'granted'/);
  assert.ok(html.includes('Nie udało się zapisać wyboru w tej przeglądarce. Statystyki Google pozostają wyłączone.'));
  assert.match(html, /const REVOKE = 'Wycofaj zgodę na statystyki';/);
});

test('baner zgody: przycisk polityki po zdaniu, zdanie i przyciski bez zmian, to samo okno', () => {
  const bar = html.match(/<div class="consent"[\s\S]*?<\/div>\s*<\/div>/)[0];
  const sentence = '<p>Strona korzysta z Google Analytics (anonimowe statystyki) — pliki cookie zapisywane tylko po zgodzie.</p>';
  assert.ok(bar.includes(sentence));
  assert.match(bar, /<button type="button" class="link-btn" id="consentPolicy">Polityka prywatności<\/button>/);
  assert.ok(bar.indexOf(sentence) < bar.indexOf('id="consentPolicy"'));
  assert.ok(bar.includes('<button id="consentYes">Zgoda</button>'));
  assert.ok(bar.includes('<button id="consentNo" class="secondary">Nie, dziękuję</button>'));
  assert.ok(html.includes("getElementById('consentPolicy').addEventListener('click', open)"));
  assert.ok(html.includes("getElementById('privacyOpen').addEventListener('click', open)"));
  assert.match(css, /\.consent \.link-btn:focus-visible/);
  assert.ok(!/reklam/i.test(html));
});
