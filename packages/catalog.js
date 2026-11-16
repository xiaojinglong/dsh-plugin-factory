'use strict';
// packages/catalog.js —— 插件目录条目、校验和与安装选择
const fs = require('node:fs');
const crypto = require('node:crypto');

function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function withChecksum(entry) {
  if (!entry.zip || !fs.existsSync(entry.zip)) return { ...entry, sha256: null, size: null };
  return { ...entry, sha256: sha256File(entry.zip), size: fs.statSync(entry.zip).size };
}

function findPlugin(catalog, id) {
  const list = Array.isArray(catalog) ? catalog : (catalog.plugins || []);
  return list.filter((p) => p.id === id).slice(-1)[0] || null;
}

function verifyPlugin(entry) {
  if (!entry) return { ok: false, error: '插件不在目录中' };
  if (!entry.zip || !fs.existsSync(entry.zip)) return { ok: false, error: `zip 不存在：${entry.zip || '(empty)'}`, entry };
  if (entry.sha256 && sha256File(entry.zip) !== entry.sha256) return { ok: false, error: 'SHA-256 校验失败', entry };
  return { ok: true, entry };
}

module.exports = { sha256File, withChecksum, findPlugin, verifyPlugin };
