'use strict';
// scripts/plugin-catalog.cjs —— 从本地注册表生成插件目录
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../packages/plugin-registry');
const { withChecksum } = require('../packages/catalog');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'catalog');
const OUT = path.join(DIR, 'plugins.json');

function latestById(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.id, row);
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function build() {
  const rows = latestById(registry.list());
  const catalog = {
    generatedAt: new Date().toISOString(),
    count: rows.length,
    plugins: rows.map((r) => withChecksum({
      id: r.id, version: r.version, tools: r.tools, installed: r.installed,
      zip: r.zip, requestId: r.requestId, at: r.at,
    })),
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  return catalog;
}

const action = process.argv[2] || 'build';
if (action === 'build') {
  const c = build();
  console.log(JSON.stringify({ ok: true, file: OUT, count: c.count }, null, 2));
} else if (action === 'search') {
  const q = String(process.argv[3] || '').toLowerCase();
  const c = build();
  const rows = c.plugins.filter((p) => !q || `${p.id} ${p.tools.join(' ')}`.toLowerCase().includes(q));
  console.log(JSON.stringify({ ok: true, query: q, count: rows.length, plugins: rows }, null, 2));
} else {
  console.error('用法：node scripts/plugin-catalog.cjs [build|search <q>]');
  process.exit(2);
}
