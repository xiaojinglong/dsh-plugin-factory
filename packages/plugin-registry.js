'use strict';
// packages/plugin-registry.js —— 本机插件生成/安装登记（data 下，gitignored）
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const FILE = path.join(config.FACTORY_DATA_ROOT, 'registry', 'plugins.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { plugins: [] }; }
}
function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, FILE);
}
function record(entry) {
  const data = load();
  const row = {
    id: entry.id, version: entry.version || '0.1.0', requestId: entry.requestId || null,
    zip: entry.zip || null, pluginDir: entry.pluginDir || null,
    tools: Array.isArray(entry.tools) ? entry.tools : [],
    installed: entry.installed === true, at: new Date().toISOString(),
  };
  const list = Array.isArray(data.plugins) ? data.plugins : [];
  list.push(row);
  data.plugins = list.slice(-500);
  save(data);
  return row;
}
function list() { return load().plugins || []; }
function latest(id) { return list().filter((p) => p.id === id).slice(-1)[0] || null; }
function history(id) { return list().filter((p) => p.id === id); }
function previous(id, version) {
  const rows = history(id).filter((p) => p.installed && p.zip && fs.existsSync(p.zip));
  const distinct = [];
  for (const row of rows) if (!distinct.some((x) => x.version === row.version)) distinct.push(row);
  if (version) return distinct.find((x) => x.version === version) || null;
  return distinct.length >= 2 ? distinct[distinct.length - 2] : null;
}

module.exports = { FILE, record, list, latest, history, previous };
