import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pickLatestZip, FEED_FORMATS } from '../tools/fetch-feeds.mjs';

const BASE = 'https://example.pl/gtfs/';
const TODAY = new Date('2026-11-16T12:00:00Z');

test('pickLatestZip: data z tekstu linku wygrywa z datą w nazwie pliku', () => {
  const html = `
    <a href="/f/2026-01-01.zip">GTFS 2026-11-10</a>
    <a href="/f/2026-12-01.zip">GTFS 2026-03-01</a>`;
  assert.equal(pickLatestZip(html, BASE, TODAY), 'https://example.pl/f/2026-01-01.zip');
});

test('pickLatestZip: gdy tekst bez daty, bierze datę z href', () => {
  const html = '<a href="a_2026-02-01.zip">pobierz</a><a href="b_2026-05-01.zip">pobierz</a>';
  assert.equal(pickLatestZip(html, BASE, TODAY), 'https://example.pl/gtfs/b_2026-05-01.zip');
});

test('pickLatestZip: pomija daty z przyszłości, a gdy wszystkie są — bierze największą', () => {
  const html = '<a href="x.zip">2026-11-01</a><a href="y.zip">2027-01-01</a>';
  assert.equal(pickLatestZip(html, BASE, TODAY), 'https://example.pl/gtfs/x.zip');
  const future = '<a href="x.zip">2027-01-01</a><a href="y.zip">2027-03-01</a>';
  assert.equal(pickLatestZip(future, BASE, TODAY), 'https://example.pl/gtfs/y.zip');
});

test('pickLatestZip: skleja względny href z bazą i zostawia bezwzględny', () => {
  assert.equal(pickLatestZip('<a href="../up/g.zip">2026-01-01</a>', BASE, TODAY), 'https://example.pl/up/g.zip');
  assert.equal(pickLatestZip('<a href="https://cdn.x.pl/g.zip">2026-01-01</a>', BASE, TODAY), 'https://cdn.x.pl/g.zip');
});

test('pickLatestZip: rozdzielacze _, - i . w dacie', () => {
  for (const d of ['2026_05_01', '2026-05-01', '2026.05.01']) {
    const html = `<a href="old.zip">2026-01-01</a><a href="new.zip">${d}</a>`;
    assert.equal(pickLatestZip(html, BASE, TODAY), 'https://example.pl/gtfs/new.zip', d);
  }
});

test('pickLatestZip: brak linków .zip = wyjątek z nazwą feedu', () => {
  assert.throws(() => pickLatestZip('<a href="a.pdf">x</a>', BASE, TODAY, 'zdzit-olsztyn'), /zdzit-olsztyn/);
});

test('data/cities.json: kontrakt feedów', () => {
  const cities = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'cities.json'), 'utf8'));
  const allowed = new Set(['ckan-latest', 'wroclaw-od2', 'html-latest']);
  // Wyjątki: wpisy czekające na właściwe źródło (adres jest martwy, więc miasto
  // jest świadomie pomijane przy odświeżaniu i zostaje przy ostatnich dobrych danych).
  // mzk-gorzow: jedyne żywe źródło (BIP MZK) wystawia rozkład na 7 dni, a dane
  //   z poprzedniego builda są ważne do 2026-12-30 — podmiana pogorszyłaby wynik.
  const knownDead = new Set(['mzk-gorzow']);
  for (const [key, city] of Object.entries(cities)) {
    for (const feed of city.feeds) {
      assert.ok(feed.url, `${key}/${feed.name}: brak url`);
      if (!knownDead.has(feed.name)) {
        assert.ok(!feed.url.includes('zbiorkom.live'), `${key}/${feed.name}: martwe źródło zbiorkom.live`);
      }
      assert.ok(FEED_FORMATS.has(feed.format ?? 'gtfs'), `${key}/${feed.name}: nieznany format ${feed.format}`);
      if (feed.resolve) assert.ok(allowed.has(feed.resolve), `${key}/${feed.name}: nieznane resolve ${feed.resolve}`);
    }
  }
});
