#!/usr/bin/env node
'use strict';
/**
 * scripts/factory-health.cjs
 * 工厂健康检查：控制面 / 失败任务 / 安装数 / 数据量。
 * 用法：node scripts/factory-health.cjs [--json]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const config = require(path.join(ROOT, 'packages', 'config'));
const registry = require(path.join(ROOT, 'packages', 'plugin-registry.js'));

const BASE = String(process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:8780').replace(/\/+$/, '');
const tokenFile = path.join(config.FACTORY_DATA_ROOT, 'control-plane', 'token');
const token = process.env.CONTROL_PLANE_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
const json = process.argv.includes('--json');

async function get(pathname, auth = true) {
  const headers = auth && token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}${pathname}`, { headers });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${pathname} HTTP ${res.status}: ${body.error || text.slice(0, 200)}`);
  return body;
}

(async () => {
  const alerts = [];
  let health = null;
  let metrics = null;
  let requests = [];
  try {
    health = await get('/health', false);
  } catch (e) {
    alerts.push(`控制面不可用：${e.message}`);
  }
  if (health && !token) alerts.push('控制面 token 未配置，无法读取指标');
  if (health && token) {
    try {
      metrics = await get('/metrics');
      const got = await get('/requests?limit=100');
      requests = got.requests || [];
    } catch (e) {
      alerts.push(`指标读取失败：${e.message}`);
    }
  }
  const failed = requests.filter((r) => r.state === 'failed');
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentFailed = failed.filter((r) => {
    const t = Date.parse(r.updatedAt || r.createdAt || 0);
    return Number.isFinite(t) && t >= cutoff;
  });
  const staging = requests.filter((r) => r.state === 'staging');
  const installed = registry.list().filter((p) => p.installed);
  const dataDir = config.FACTORY_DATA_ROOT;
  let dataMb = 0;
  try {
    const bytes = fs.readdirSync(dataDir).reduce((sum, name) => {
      const p = path.join(dataDir, name);
      if (!fs.statSync(p).isDirectory()) return sum;
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isFile() ? fs.statSync(path.join(d, e.name)).size : walk(path.join(d, e.name))), 0);
      return sum + walk(p);
    }, 0);
    dataMb = Math.round(bytes / 1024 / 1024 * 10) / 10;
  } catch { /* ignore */ }
  if (recentFailed.length) alerts.push(`最近 24 小时失败任务 ${recentFailed.length} 个`);
  if (dataMb > 1024) alerts.push(`数据目录已超过 1GB：${dataMb}MB`);
  const result = {
    ok: !!health && alerts.length === 0,
    controlPlane: health ? 'up' : 'down',
    version: health?.version || null,
    uptimeSec: health?.uptimeSec || 0,
    tokenConfigured: !!token,
    requests: { total: metrics?.requests?.total || 0, byState: metrics?.requests?.byState || {} },
    recent: { failed: recentFailed.length, staging: staging.length },
    installedPlugins: installed.length,
    dataMb,
    alerts,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('工厂健康');
    console.log(`  控制面：${result.controlPlane} ${result.version || ''}`);
    console.log(`  请求：${result.requests.total}，失败 ${result.recent.failed}，staging ${result.recent.staging}`);
    console.log(`  已安装插件：${result.installedPlugins}`);
    console.log(`  数据量：${result.dataMb}MB`);
    if (alerts.length) { console.log('  告警：'); for (const a of alerts) console.log(`  - ${a}`); }
    else console.log('  告警：无');
  }
  process.exitCode = health ? (alerts.length ? 2 : 0) : 1;
})().catch((e) => { console.error(`[factory-health] ${e.message}`); process.exitCode = 1; });
