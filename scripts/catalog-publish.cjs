'use strict';
// scripts/catalog-publish.cjs —— 生成可远程托管的静态插件目录
const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('../packages/catalog');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'catalog', 'plugins.json');
const OUT = path.join(ROOT, 'catalog', 'public');
if (!fs.existsSync(SRC)) {
  console.error('缺少 catalog/plugins.json，先运行 npm run catalog');
  process.exit(1);
}
const catalog = JSON.parse(fs.readFileSync(SRC, 'utf8'));
fs.mkdirSync(path.join(OUT, 'zips'), { recursive: true });
const plugins = [];
for (const p of catalog.plugins || []) {
  if (!p.zip || !fs.existsSync(p.zip)) continue;
  const name = `${p.id}-${p.version}.zip`;
  const target = path.join(OUT, 'zips', name);
  fs.copyFileSync(p.zip, target);
  plugins.push({
    id: p.id, version: p.version, tools: p.tools || [], installed: p.installed,
    zip: `zips/${name}`, sha256: sha256File(target), size: fs.statSync(target).size,
    requestId: p.requestId, at: p.at,
  });
}
const out = { generatedAt: new Date().toISOString(), count: plugins.length, plugins };
fs.writeFileSync(path.join(OUT, 'plugins.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ok: true, dir: OUT, count: plugins.length }, null, 2));
