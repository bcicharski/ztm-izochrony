/**
 * Minimalny, strumieniowy parser XML bez zależności (na potrzeby TransXChange).
 * Gramatyka jest celowo wąska: elementy, atrybuty, tekst, komentarze, instrukcje
 * przetwarzania, DOCTYPE bez podzbioru wewnętrznego i encje predefiniowane.
 * TRYB STRICT: CDATA, nieznana encja, niedomknięty element, niezgodny tag
 * zamykający i EOF w środku tagu PRZERYWAJĄ parsowanie błędem z offsetem
 * bajtowym — parser nigdy nie zgaduje.
 *
 * API:
 *   xmlEvents(stream)                       — generator zdarzeń {t:'open'|'close'|'text'}
 *   forEachElement(stream, paths, cb, opt)  — buduje tylko poddrzewa wskazanych
 *                                             ścieżek bezwzględnych
 *   kid / kids / txt / has                  — pomocniki dla węzłów
 * Prefiksy przestrzeni nazw są obcinane ("apd:Street" -> "Street").
 * Element samozamykający daje zdarzenie open{self:true} i zaraz po nim close.
 */

import { StringDecoder } from 'node:string_decoder';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s, offset) {
  if (!s.includes('&')) return s;
  return s.replace(/&([^;&\s]*)(;?)/g, (m, name, semi) => {
    if (!semi) throw new Error(`xmlstream: niedomknięta encja "${m}" (bajt ${offset})`);
    if (name in ENTITIES) return ENTITIES[name];
    let cp = NaN;
    if (/^#x[0-9a-fA-F]+$/.test(name)) cp = parseInt(name.slice(2), 16);
    else if (/^#[0-9]+$/.test(name)) cp = parseInt(name.slice(1), 10);
    if (!Number.isFinite(cp) || cp > 0x10FFFF || cp === 0) {
      throw new Error(`xmlstream: nieznana encja "&${name};" (bajt ${offset})`);
    }
    return String.fromCodePoint(cp);
  });
}

const stripPrefix = (name) => {
  const i = name.indexOf(':');
  return i < 0 ? name : name.slice(i + 1);
};

/** Parser synchroniczny karmiony tekstem; zdarzenia trafiają do `onEvent`. */
class XmlParser {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.buf = '';
    this.base = 0;       // bajty już odrzuconego prefiksu bufora
    this.stack = [];
    this.first = true;
  }

  fail(msg, pos) {
    const off = this.base + Buffer.byteLength(this.buf.slice(0, pos));
    throw new Error(`xmlstream: ${msg} (bajt ${off})`);
  }

  write(str) {
    if (this.first && str.length) {
      this.first = false;
      if (str.charCodeAt(0) === 0xFEFF) { str = str.slice(1); this.base = 3; }
    }
    const b = this.buf = this.buf + str;
    const n = b.length;
    let pos = 0;
    while (pos < n) {
      const lt = b.indexOf('<', pos);
      if (lt < 0) break; // tekst bez końca — czekamy na kolejną porcję
      if (lt > pos) this.text(b.slice(pos, lt), pos);
      pos = lt;
      const c1 = b[lt + 1];
      if (c1 === undefined) break;
      if (c1 === '/') {
        const end = b.indexOf('>', lt);
        if (end < 0) break;
        this.close(stripPrefix(b.slice(lt + 2, end).trim()), lt);
        pos = end + 1;
      } else if (c1 === '?') {
        const end = b.indexOf('?>', lt + 2);
        if (end < 0) break;
        pos = end + 2;
      } else if (c1 === '!') {
        if (b.startsWith('<!--', lt)) {
          const end = b.indexOf('-->', lt + 4);
          if (end < 0) break;
          pos = end + 3;
        } else if (b.startsWith('<![CDATA[', lt)) {
          this.fail('sekcje CDATA nie są obsługiwane', lt);
        } else if (b.startsWith('<!DOCTYPE', lt)) {
          const end = b.indexOf('>', lt);
          if (end < 0) break;
          if (b.slice(lt, end).includes('[')) this.fail('DOCTYPE z podzbiorem wewnętrznym nie jest obsługiwany', lt);
          pos = end + 1;
        } else if (n - lt < 9) break;
        else this.fail('nieobsługiwana deklaracja <!', lt);
      } else {
        let q = 0, end = -1;
        for (let i = lt + 1; i < n; i++) {
          const ch = b.charCodeAt(i);
          if (q) { if (ch === q) q = 0; } else if (ch === 34 || ch === 39) q = ch;
          else if (ch === 62) { end = i; break; }
        }
        if (end < 0) break;
        this.open(b.slice(lt + 1, end), lt);
        pos = end + 1;
      }
    }
    this.base += Buffer.byteLength(b.slice(0, pos));
    this.buf = b.slice(pos);
  }

  open(tag, at) {
    const self = tag.endsWith('/');
    if (self) tag = tag.slice(0, -1);
    const m = /^[^\s/]+/.exec(tag);
    if (!m) this.fail('pusta nazwa tagu', at);
    const name = stripPrefix(m[0]);
    const attrs = {};
    const rest = tag.slice(m[0].length);
    if (rest.trim()) {
      const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a, last = 0;
      while ((a = re.exec(rest))) {
        if (rest.slice(last, a.index).trim()) this.fail(`błędny atrybut w <${name}>`, at);
        attrs[stripPrefix(a[1])] = decodeEntities(a[2] ?? a[3], this.base + at);
        last = re.lastIndex;
      }
      if (rest.slice(last).trim()) this.fail(`błędny atrybut w <${name}>`, at);
    }
    this.onEvent({ t: 'open', name, attrs, self });
    if (self) this.onEvent({ t: 'close', name });
    else this.stack.push(name);
  }

  close(name, at) {
    const top = this.stack.pop();
    if (top !== name) this.fail(`tag zamykający </${name}> nie pasuje do <${top ?? '(brak)'}>`, at);
    this.onEvent({ t: 'close', name });
  }

  text(raw, at) {
    if (!this.stack.length || !/\S/.test(raw)) return;
    this.onEvent({ t: 'text', text: decodeEntities(raw, this.base + at) });
  }

  end() {
    if (this.buf.includes('<')) this.fail('koniec pliku w środku tagu', this.buf.indexOf('<'));
    if (this.stack.length) this.fail(`niedomknięty element <${this.stack.at(-1)}>`, this.buf.length);
  }
}

/** Przepuszcza strumień (Buffer/string) przez parser; `onEvent` jest synchroniczne. */
async function pump(stream, onEvent) {
  const parser = new XmlParser(onEvent);
  const dec = new StringDecoder('utf8');
  for await (const chunk of stream) {
    parser.write(typeof chunk === 'string' ? chunk : dec.write(chunk));
  }
  parser.write(dec.end());
  parser.end();
}

/** Asynchroniczny generator zdarzeń {t:'open',name,attrs,self} | {t:'close',name} | {t:'text',text}. */
export async function* xmlEvents(stream) {
  const queue = [];
  const parser = new XmlParser(e => queue.push(e));
  const dec = new StringDecoder('utf8');
  for await (const chunk of stream) {
    parser.write(typeof chunk === 'string' ? chunk : dec.write(chunk));
    yield* queue.splice(0);
  }
  parser.write(dec.end());
  parser.end();
  yield* queue.splice(0);
}

/**
 * Buduje węzły {name, attrs, text, kids, self} tylko dla elementów o podanych
 * ścieżkach bezwzględnych ('TransXChange/Services/Service'); resztę drzewa
 * pomija bez alokacji. `opts.skip` — nazwy elementów pomijanych także wewnątrz
 * budowanych poddrzew (np. kosztowna geometria). `onElement(node, path)` jest
 * synchroniczne.
 */
export async function forEachElement(stream, paths, onElement, opts = {}) {
  const root = { kids: new Map(), target: null };
  for (const p of paths) {
    let cur = root;
    for (const seg of p.split('/')) {
      if (!cur.kids.has(seg)) cur.kids.set(seg, { kids: new Map(), target: null });
      cur = cur.kids.get(seg);
    }
    cur.target = p;
  }
  const skip = opts.skip ?? new Set();
  const trie = [root];  // stos węzłów trie; null = poza interesującymi ścieżkami
  const build = [];     // stos budowanych węzłów; niepusty = trwa przechwytywanie
  let skipDepth = 0;
  let path = null;

  await pump(stream, (e) => {
    if (e.t === 'open') {
      if (build.length) {
        if (skipDepth || skip.has(e.name)) { skipDepth++; return; }
        const node = { name: e.name, attrs: e.attrs, text: '', kids: [], self: e.self };
        build.at(-1).kids.push(node);
        build.push(node);
        return;
      }
      const next = trie.at(-1)?.kids.get(e.name) ?? null;
      trie.push(next);
      if (next?.target) {
        path = next.target;
        build.push({ name: e.name, attrs: e.attrs, text: '', kids: [], self: e.self });
      }
    } else if (e.t === 'close') {
      if (build.length) {
        if (skipDepth) { skipDepth--; return; }
        const node = build.pop();
        node.text = node.text.trim();
        if (!build.length) {
          trie.pop();
          onElement(node, path);
        }
        return;
      }
      trie.pop();
    } else if (build.length && !skipDepth) {
      build.at(-1).text += e.text;
    }
  });
}

/** Pierwsze dziecko o danej nazwie (albo undefined). */
export function kid(node, name) {
  return node?.kids.find(k => k.name === name);
}

/** Wszystkie dzieci o danej nazwie. */
export function kids(node, name) {
  return node ? node.kids.filter(k => k.name === name) : [];
}

function walk(node, path) {
  let cur = node;
  for (const seg of path.split('/')) {
    cur = kid(cur, seg);
    if (!cur) return undefined;
  }
  return cur;
}

/** Tekst elementu pod ścieżką względną 'A/B/C' (pierwsze dopasowania) albo `dflt`. */
export function txt(node, path, dflt = '') {
  const n = walk(node, path);
  return n ? n.text : dflt;
}

/** Czy pod ścieżką względną 'A/B' istnieje element. */
export function has(node, path) {
  return walk(node, path) !== undefined;
}
