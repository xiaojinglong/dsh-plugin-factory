'use strict';
// scripts/catalog-serve.cjs —— 本地静态目录服务器（远程市场验证用）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(path.resolve(__dirname, '..'), 'catalog', 'public');
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex >= 0 ? args[portIndex + 1] : 8788) || 8788;
const types = { '.json': 'application/json', '.zip': 'application/zip', '.md': 'text/markdown' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.resolve(ROOT, `.${urlPath}`);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ ok: true, url: `http://127.0.0.1:${port}/plugins.json`, root: ROOT }));
});
