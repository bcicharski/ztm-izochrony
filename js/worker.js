/**
 * Web Worker: opakowanie `Engine` w komunikaty. Ciężkie obliczenia (RAPTOR,
 * fala po siatce, obrysy) schodzą z wątku głównego, więc mapa i panel
 * reagują także w trakcie liczenia (w GZM to ~2 s).
 *
 * Protokół (main → worker):
 *   {type:'city', id, city, cfg}          → {type:'city', id, ok}
 *   {type:'compute', id, params}          → {type:'result', id, phase, …}× → {type:'done', id}
 *                                            albo {type:'error', id, message}
 *   {type:'journey', id, latlng}          → {type:'journey', id, result}
 * worker → main bez pytania: {type:'walknet', city} gdy graf ulic się wczyta.
 *
 * Przeliczenia są kolejkowane „ostatni wygrywa": gdy w trakcie liczenia
 * przyjdą kolejne żądania, wykona się tylko najnowsze.
 */

import { Engine } from './engine.js';
import { installHandlers, setSink, report, locate } from './diag.js';

// diagnostyka (Z-025): rekordy workera lecą do wątku głównego, który je
// wrzuca do własnego bufora (i, po zgodzie, wysyła zanonimizowane do GA)
installHandlers(self);
setSink(record => postMessage({ type: 'diag', record }));

/** Rekord ze stosem do diagnostyki; użytkownik nadal dostaje sam `message`. */
function reportError(err, phase) {
  const m = String(err?.stack ?? '').match(/([^\s()/\\]+\.m?js):(\d+):(\d+)/);
  report({
    src: 'worker',
    msg: err?.message ?? String(err),
    at: m ? locate(m[1], Number(m[2]), Number(m[3])) : '',
    ctx: { phase },
  });
}

const engine = new Engine({
  createCanvas: (w, h) => new OffscreenCanvas(w, h),
  onWalkNet: city => postMessage({ type: 'walknet', city }),
});

let queued = null;
let running = false;

async function pump() {
  if (running) return;
  running = true;
  while (queued) {
    const job = queued;
    queued = null;
    try {
      await engine.compute(job.params, msg => {
        if (msg.phase === 'zones') {
          // raster jako ImageBitmap (przenoszony bez kopiowania); bufor
          // OffscreenCanvas po transferze jest pusty i gotowy na następne użycie
          const image = msg.image ? msg.image.transferToImageBitmap() : null;
          postMessage({ type: 'result', id: job.id, ...msg, image }, image ? [image] : []);
        } else {
          const buffers = [];
          for (const band of msg.contours) {
            for (const r of band.rings) buffers.push(r.buffer);
            for (const b of band.bbox) buffers.push(b.buffer);
          }
          postMessage({ type: 'result', id: job.id, ...msg }, buffers);
        }
      });
      postMessage({ type: 'done', id: job.id });
    } catch (err) {
      reportError(err, 'compute');
      postMessage({ type: 'error', id: job.id, message: String(err?.message ?? err) });
    }
  }
  running = false;
}

onmessage = async e => {
  const m = e.data;
  if (m.type === 'city') {
    try {
      const ok = await engine.setCity(m.city, m.cfg);
      postMessage({ type: 'city', id: m.id, ok });
    } catch (err) {
      reportError(err, 'city');
      postMessage({ type: 'city', id: m.id, ok: false, message: String(err?.message ?? err) });
    }
  } else if (m.type === 'compute') {
    queued = m;
    pump();
  } else if (m.type === 'journey') {
    postMessage({ type: 'journey', id: m.id, result: engine.journey(m.latlng) });
  }
};
