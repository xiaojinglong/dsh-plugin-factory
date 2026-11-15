#!/usr/bin/env node
'use strict';

/**
 * scripts/ops-backup-prune.cjs —— 控制面备份保留策略（M6）
 * 用法：node scripts/ops-backup-prune.cjs [--data-root <dir>] [--keep 7] [--apply]
 * 默认 dry-run；--apply 才删除超出 keep 的旧备份（按 mtime 倒序保留最新）。
 */

const fs = require('node:fs');
const path = require('node:path');

function pruneBackups(opts = {}) {
  const dataRoot = path.resolve(opts.dataRoot || process.env.FACTORY_DATA_ROOT || path.join(__dirname, '..', 'data'));
  const dir = path.join(dataRoot, 'control-plane', 'backups');
  const keep = Math.max(0, Math.min(365, Number(opts.keep ?? 7) || 0));
  const dryRun = opts.dryRun !== false;
  if (!fs.existsSync(dir)) return { ok: true, dir, keep, dryRun, kept: [], deleted: [], note: '备份目录不存在' };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).map((f) => {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    return { name: f, path: p, mtimeMs: st.mtimeMs, bytes: st.size };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const kept = files.slice(0, keep);
  const remove = files.slice(keep);
  if (!dryRun) for (const f of remove) fs.unlinkSync(f.path);
  return {
    ok: true, dir, keep, dryRun,
    kept: kept.map((f) => ({ name: f.name, mtime: new Date(f.mtimeMs).toISOString() })),
    deleted: remove.map((f) => ({ name: f.name, mtime: new Date(f.mtimeMs).toISOString() })),
  };
}

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[a.slice(2)] = next; i += 1; } else args[a.slice(2)] = 'true';
  }
  try {
    const r = pruneBackups({ dataRoot: args['data-root'], keep: args.keep, dryRun: args.apply !== 'true' });
    console.log(JSON.stringify(r, null, 2));
  } catch (err) { console.error(`[ops-backup-prune] ${err.message}`); process.exit(1); }
}

if (require.main === module) main();
module.exports = { pruneBackups };
