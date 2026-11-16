/**
 * Diagnostyka błędów (Z-025): mały bufor kołowy zanonimizowanych rekordów.
 * Bez zależności i bez DOM na poziomie modułu — działa w oknie, w workerze
 * i w Node (importuje go data.js, a data.js importują skrypty z tools/).
 *
 * Prywatność: adres strony niesie w query współrzędne klikniętego punktu, więc
 * rekord zawiera WYŁĄCZNIE jawnie wymienione pola (lista dozwolonych, nie
 * „wszystko oprócz"), a każdy string przechodzi przez redakcję.
 */

const MAX_RECORDS = 20;
const MAX_MSG = 200;
const SOURCES = new Set(['window', 'promise', 'worker', 'data', 'app']);
const CTX_KEYS = ['city', 'day', 'mode', 'engine', 'phase'];
const CTX_VALUE = /^[a-z0-9_-]{1,32}$/i;
const COORD_RE = /\d{2}\.\d{4,}/;

const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
let buffer = [];
let sink = null;
let busy = false;

/** Skraca ścieżkę/URL do samej nazwy pliku (bez query, hasha, hosta). */
function baseName(s) {
  const clean = String(s).replace(/[?#].*$/, '');
  return clean.slice(clean.search(/[^\\/]*$/));
}

/** Redakcja tekstu: URL-e → nazwa pliku, query/hash wycięte, współrzędne → [xx]. */
export function redact(input) {
  let s = String(input ?? '');
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'")\]]+/gi, u => baseName(u));
  s = s.replace(/[?#]\S*/g, '');
  s = s.replace(/(?:[a-z]:)?(?:[\w.-]*[\\/])+([\w.-]+)/gi, '$1');
  return s.replace(/\d{2}\.\d{4,}/g, '[xx]');
}

/** „plik.js:linia:kol" z URL-a/ścieżki i opcjonalnych numerów — sama nazwa pliku. */
export function locate(file, line, col) {
  const name = redact(baseName(file ?? ''));
  if (!name) return '';
  const pos = [line, col].filter(n => Number.isFinite(n)).join(':');
  return pos ? `${name}:${pos}` : name;
}

/** Lista dozwolonych kluczy kontekstu; wartości tylko krótkie identyfikatory. */
function cleanCtx(rec) {
  const src = rec.ctx ?? {};
  const ctx = {};
  for (const k of CTX_KEYS) {
    const v = src[k] ?? rec[k]; // `phase` wolno podać też na wierzchu rekordu
    if (typeof v === 'string' && CTX_VALUE.test(v) && !COORD_RE.test(v)) ctx[k] = v;
  }
  return ctx;
}

function sanitize(rec) {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    t: Math.round((now - startedAt) / 100) * 100,
    src: SOURCES.has(rec.src) ? rec.src : 'app',
    msg: redact(rec.msg).slice(0, MAX_MSG),
    at: redact(rec.at ?? '').slice(0, 80),
    ctx: cleanCtx(rec),
    n: 1,
  };
}

/** Dodaje rekord do bufora (dedup po src|msg|at). Nigdy nie rzuca, nie rekuruje. */
export function report(rec) {
  if (busy) return;
  busy = true;
  try {
    const clean = sanitize(rec && typeof rec === 'object' ? rec : { msg: rec });
    const key = `${clean.src}|${clean.msg}|${clean.at}`;
    const same = buffer.find(r => `${r.src}|${r.msg}|${r.at}` === key);
    if (same) {
      same.n++;
    } else {
      buffer.push(clean);
      if (buffer.length > MAX_RECORDS) buffer.shift();
    }
    if (sink) {
      try { sink({ ...(same ?? clean), ctx: { ...(same ?? clean).ctx } }); } catch { /* ujście nie może psuć strony */ }
    }
  } catch { /* diagnostyka nie może zepsuć niczego */ } finally {
    busy = false;
  }
}

/** Kopia bufora (max 20 rekordów, najstarszy pierwszy). */
export function records() {
  return buffer.map(r => ({ ...r, ctx: { ...r.ctx } }));
}

/** Czyści bufor (testy, nowa sesja). */
export function clear() {
  buffer = [];
}

/** Ujście wywoływane po każdym rekordzie (okno: GA, worker: postMessage). `null` = brak. */
export function setSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

/**
 * Tekst do schowka / zgłoszenia. `meta`: { city, day, mode, engine, version } —
 * przechodzi przez tę samą listę dozwolonych pól i redakcję co rekordy.
 */
export function formatReport(meta = {}) {
  const ctx = cleanCtx({ ctx: meta });
  const lines = [
    'Dokąd dojadę? — raport diagnostyczny',
    `miasto: ${ctx.city ?? '?'}`,
    `dzień: ${ctx.day ?? '?'}`,
    `tryb: ${ctx.mode ?? '?'}`,
    `silnik: ${ctx.engine ?? '?'}`,
  ];
  if (typeof meta.version === 'string' && CTX_VALUE.test(meta.version)) lines.push(`wersja: ${meta.version}`);
  lines.push(`rekordów: ${buffer.length}`);
  for (const r of buffer) {
    const c = Object.entries(r.ctx).map(([k, v]) => `${k}=${v}`).join(' ');
    lines.push(`[${r.t} ms] ${r.src} x${r.n} ${r.at} — ${r.msg}${c ? ` (${c})` : ''}`);
  }
  return redact(lines.join('\n'));
}

/** Podpina globalne handlery błędów w `self` (okno albo worker). Idempotentne. */
export function installHandlers(scope) {
  try {
    if (!scope || typeof scope.addEventListener !== 'function' || scope.__diagInstalled) return;
    scope.__diagInstalled = true;
    const isWorker = typeof scope.document === 'undefined';
    scope.addEventListener('error', e => {
      report({
        src: isWorker ? 'worker' : 'window',
        msg: e?.message ?? e?.error?.message ?? 'error',
        at: locate(e?.filename, e?.lineno, e?.colno),
      });
    });
    scope.addEventListener('unhandledrejection', e => {
      const r = e?.reason;
      const stack = String(r?.stack ?? '').match(/([^\s()/\\]+\.m?js):(\d+):(\d+)/);
      report({
        src: isWorker ? 'worker' : 'promise',
        msg: r?.message ?? String(r ?? 'rejection'),
        at: stack ? locate(stack[1], Number(stack[2]), Number(stack[3])) : '',
      });
    });
  } catch { /* brak handlerów to nie błąd */ }
}
