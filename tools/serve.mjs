// Minimalny serwer statyczny do pracy lokalnej: node tools/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const port = +(process.argv[2] ?? 8123);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // debug: POST /__save z data-URL PNG w body zapisuje zrzut do katalogu tymczasowego
  if (req.method === 'POST' && urlPath === '/__save') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const out = path.join(os.tmpdir(), 'ztm-capture.png');
      fs.writeFileSync(out, Buffer.from(body.split(',')[1], 'base64'));
      res.writeHead(200).end(out);
    });
    return;
  }
  let file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log(`http://localhost:${port}`));
