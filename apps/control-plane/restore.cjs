#!/usr/bin/env node
'use strict';

/**
 * apps/control-plane/restore.cjs —— 控制面 SQLite 恢复（M6 演练）
 *
 * 用法：node restore.cjs --backup <backup.db> --data-root <dir> [--force]
 * 要求：控制面已停止（state.db 未被占用）；默认保留当前库为 .before-restore-<ts>。
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function restore({ backup, dataRoot, force = false }) {
  if (!backup) throw new Error('restore 需要 --backup');
  if (!dataRoot) throw new Error('restore 需要 --data-root');
  const src = path.resolve(backup);
  if (!fs.existsSync(src)) throw new Error(`备份不存在：${src}`);
  const db = new DatabaseSync(src, { readOnly: true });
  let tables;
  try { tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name); } finally { db.close(); }
  for (const t of ['requests', 'steps', 'audit']) {
    if (!tables.includes(t)) throw new Error(`备份缺少表：${t}`);
  }
  const dir = path.join(path.resolve(dataRoot), 'control-plane');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'state.db');
  let previous = '';
  if (fs.existsSync(target)) {
    previous = `${target}.before-restore-${stamp()}`;
    fs.copyFileSync(target, previous);
  }
  try {
    fs.rmSync(target, { force: true });
    fs.rmSync(`${target}-wal`, { force: true });
    fs.rmSync(`${target}-shm`, { force: true });
    fs.copyFileSync(src, target);
  } catch (err) {
    if (/EBUSY|EPERM|EACCES/i.test(String(err.message))) {
      throw new Error(`无法替换 ${target}：控制面可能仍在运行，请先停止（${err.message}）`);
    }
    throw err;
  }
  return { ok: true, restored: target, backup: src, previous, force: !!force };
}

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[a.slice(2)] = next; i += 1; } else args[a.slice(2)] = 'true';
  }
  try { console.log(JSON.stringify(restore({ backup: args.backup, dataRoot: args['data-root'], force: args.force === 'true' }), null, 2)); }
  catch (err) { console.error(`[control-plane-restore] ${err.message}`); process.exit(1); }
}

if (require.main === module) main();
module.exports = { restore };
