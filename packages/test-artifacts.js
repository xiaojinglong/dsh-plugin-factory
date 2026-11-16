'use strict';
// packages/test-artifacts.js —— 标记工厂开发/测试插件，默认不进 DSH patch
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'platform', 'manifests', '.test-artifacts', 'index.json');
let cache;
function data() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = { ids: [] }; }
  return cache;
}
function isTestArtifact(id) { return (data().ids || []).includes(id); }
function ids() { return [...(data().ids || [])]; }

module.exports = { isTestArtifact, ids, FILE };
