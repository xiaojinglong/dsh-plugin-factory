#!/usr/bin/env node
'use strict';

/**
 * scripts/health-check.cjs —— 控制面健康/容量巡检（M6，可供计划任务/CI 调用）
 *
 * 用法：
 *   node scripts/health-check.cjs [--url http://127.0.0.1:8780] [--token-file <path>]
 *     [--max-audit 5000] [--max-db-bytes 52428800] [--max-failed 50]
 * 退出码：0 健康；1 失败/超阈值。输出 JSON 便于日志采集。
 */

const fs = require('node:fs');
const path = require('node:path');

function readToken(opts) {
  if (opts.token) return String(opts.token);
  if (process.env.CONTROL_PLANE_TOKEN) return process.env.CONTROL_PLANE_TOKEN;
  const file = opts.tokenFile || path.join(process.env.FACTORY_DATA_ROOT || path.join(__dirname, '..', 'data'), 'control-plane', 'token');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

async function checkHealth(opts = {}) {
  const url = String(opts.url || 'http://127.0.0.1:8780').replace(/\/+$/, '');
  const token = readToken(opts);
  const thresholds = { maxAudit: 5000, maxDbBytes: 50 * 1024 * 1024, maxFailed: 50, ...(opts.thresholds || {}) };
  const checks = [];
  let health = null;
  let metrics = null;
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    health = await r.json();
    checks.push({ name: 'health', ok: r.ok && health.ok === true, detail: `status=${r.status}` });
  } catch (err) {
    checks.push({ name: 'health', ok: false, detail: String(err.message).slice(0, 200) });
  }
  if (token) {
    try {
      const r = await fetch(`${url}/metrics`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (r.ok) metrics = await r.json();
      checks.push({ name: 'metrics', ok: r.ok, detail: `status=${r.status}` });
    } catch (err) {
      checks.push({ name: 'metrics', ok: false, detail: String(err.message).slice(0, 200) });
    }
  } else {
    checks.push({ name: 'metrics', ok: false, detail: '缺少 token，跳过容量检查' });
  }
  if (metrics) {
    checks.push({ name: 'audit-count', ok: Number(metrics.auditCount) <= thresholds.maxAudit, detail: `${metrics.auditCount} <= ${thresholds.maxAudit}` });
    checks.push({ name: 'db-size', ok: Number(metrics.dbSizeBytes) <= thresholds.maxDbBytes, detail: `${metrics.dbSizeBytes} <= ${thresholds.maxDbBytes}` });
    const failed = Number(metrics.requests?.byState?.failed || 0);
    checks.push({ name: 'failed-requests', ok: failed <= thresholds.maxFailed, detail: `${failed} <= ${thresholds.maxFailed}` });
  }
  return { ok: checks.every((c) => c.ok), url, thresholds, checks, health, metrics };
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[a.slice(2)] = next; i += 1; } else args[a.slice(2)] = 'true';
  }
  const thresholds = {};
  if (args['max-audit'] !== undefined) thresholds.maxAudit = Number(args['max-audit']);
  if (args['max-db-bytes'] !== undefined) thresholds.maxDbBytes = Number(args['max-db-bytes']);
  if (args['max-failed'] !== undefined) thresholds.maxFailed = Number(args['max-failed']);
  try {
    const r = await checkHealth({ url: args.url, token: args.token, tokenFile: args['token-file'], thresholds });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  } catch (err) {
    console.error(`[health-check] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { checkHealth };
