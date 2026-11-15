#!/usr/bin/env node
'use strict';

/**
 * scripts/ops-backup.cjs —— 控制面备份 CLI（给计划任务用）
 * 用法：node scripts/ops-backup.cjs [--url ...] [--token-file ...] [--file-name ...]
 */

const fs = require('node:fs');
const path = require('node:path');

function readToken(opts) {
  if (opts.token) return String(opts.token);
  if (process.env.CONTROL_PLANE_TOKEN) return process.env.CONTROL_PLANE_TOKEN;
  const file = opts.tokenFile || path.join(process.env.FACTORY_DATA_ROOT || path.join(__dirname, '..', 'data'), 'control-plane', 'token');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

async function backup(opts = {}) {
  const url = String(opts.url || 'http://127.0.0.1:8780').replace(/\/+$/, '');
  const token = readToken(opts);
  if (!token) throw new Error('缺少控制面 token');
  const r = await fetch(`${url}/admin/backup`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: opts.fileName || undefined }), signal: AbortSignal.timeout(30000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`备份失败：${r.status} ${JSON.stringify(body.error || body)}`);
  return { ok: true, ...body };
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[a.slice(2)] = next; i += 1; } else args[a.slice(2)] = 'true';
  }
  try { console.log(JSON.stringify(await backup({ url: args.url, token: args.token, tokenFile: args['token-file'], fileName: args['file-name'] }), null, 2)); }
  catch (err) { console.error(`[ops-backup] ${err.message}`); process.exit(1); }
}

if (require.main === module) main();
module.exports = { backup, readToken };
