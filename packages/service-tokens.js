'use strict';
// packages/service-tokens.js —— 本机 service token overlay（gitignored）
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'platform', 'secrets', 'service-tokens.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function save(map) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, FILE);
}
function apply(manifest) {
  if (!manifest || !manifest.id) return manifest;
  const token = load()[manifest.id];
  if (!token) return manifest;
  return { ...manifest, runtime: { ...(manifest.runtime || {}), serviceToken: token } };
}
function get(id) { return load()[id] || ''; }
function set(id, token) { const map = load(); map[id] = token; save(map); return token; }
function setMany(map) { const current = load(); Object.assign(current, map); save(current); return current; }
function all() { return load(); }

module.exports = { FILE, load, save, apply, get, set, setMany, all };
