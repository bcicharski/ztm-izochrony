#!/usr/bin/env node
/**
 * Generator ikon PWA (Z-002, etap 1). Czysty Node, zero zależności.
 * Logo = trzy współśrodkowe koła (jak data-URI w index.html); raster liczony
 * arytmetyką z antyaliasingiem przez supersampling 4x4, PNG składany ręcznie.
 * Wynik jest deterministyczny. Uruchamiany ręcznie: node tools/build-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Od zewnątrz: promień względem zewnętrznego koła, kolor RGB.
const RINGS = [
  { r: 1, rgb: [0x0d, 0x08, 0x87] },
  { r: 9 / 14, rgb: [0xb8, 0x32, 0x89] },
  { r: 4 / 14, rgb: [0xfe, 0xbd, 0x2a] },
];
const SS = 4;

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * @param {{size:number, pad?:number, bleed?:boolean}} o
 *   pad   — margines z każdej strony jako ułamek rozmiaru (logo = size*(1-2*pad)),
 *   bleed — tło pod logo wypełnione kolorem zewnętrznego koła (maskable, iOS).
 * @returns {Buffer} PNG RGBA 8-bit
 */
export function buildIcon({ size, pad = 2 / 32, bleed = false }) {
  const R = (size * (1 - 2 * pad)) / 2;
  const c = size / 2;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filtr None
    for (let x = 0; x < size; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const dx = x + (i + 0.5) / SS - c;
          const dy = y + (j + 0.5) / SS - c;
          const d2 = dx * dx + dy * dy;
          let rgb = bleed ? RINGS[0].rgb : null;
          for (const ring of RINGS) if (d2 < (ring.r * R) ** 2) rgb = ring.rgb;
          if (rgb) { sr += rgb[0]; sg += rgb[1]; sb += rgb[2]; sa++; }
        }
      }
      const o = row + 1 + x * 4;
      if (sa) {
        raw[o] = Math.round(sr / sa);
        raw[o + 1] = Math.round(sg / sa);
        raw[o + 2] = Math.round(sb / sa);
        raw[o + 3] = Math.round((sa * 255) / (SS * SS));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="14" fill="#0d0887"/>
  <circle cx="16" cy="16" r="9" fill="#b83289"/>
  <circle cx="16" cy="16" r="4" fill="#febd2a"/>
</svg>
`;

/** Zapisuje komplet ikon do outDir. */
export function writeIcons(outDir) {
  mkdirSync(outDir, { recursive: true });
  const put = (name, data) => writeFileSync(`${outDir}/${name}`, data);
  put('icon.svg', SVG);
  put('icon-192.png', buildIcon({ size: 192 }));
  put('icon-512.png', buildIcon({ size: 512 }));
  // Maskable: logo w 60% szerokości (strefa bezpieczna), tło pełne.
  put('icon-maskable-512.png', buildIcon({ size: 512, pad: 0.2, bleed: true }));
  put('apple-touch-icon.png', buildIcon({ size: 180, pad: 0.12, bleed: true }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeIcons(fileURLToPath(new URL('../assets', import.meta.url)));
}
