#!/usr/bin/env node
'use strict';

/**
 * scripts/pilot-drill.cjs —— M6 试点演练：需求单→staging→accept→备份→恢复→巡检
 *
 * 用法：node scripts/pilot-drill.cjs [--root <临时目录>]
 * 说明：全部使用临时数据根；不触碰真实控制面/DSH profile。输出 JSON + pilot-drill.json。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createControlPlane } = require('../apps/control-plane/server.cjs');
const { restore } = require('../apps/control-plane/restore.cjs');
const { checkHealth } = require('./health-check.cjs');

const TOKEN = 'pilot-drill-token';

async function req(url, method, body, token = TOKEN) {
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function runPilotDrill(opts = {}) {
  const root = path.resolve(opts.root || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-drill-')));
  const dataRootA = path.join(root, 'control-plane-a');
  const dataRootB = path.join(root, 'control-plane-b');
  const checks = [];
  const add = (name, ok, detail = '') => { checks.push({ name, ok, detail }); };
  const cpA = createControlPlane({ dataRoot: dataRootA, token: TOKEN });
  const { port } = await cpA.start({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  let requestId = '';
  try {
    const created = await req(`${base}/requests`, 'POST', { brief: '试点演练：库存预警', params: { pluginId: 'drill-demo', name: '演练插件' } });
    add('create', created.status === 201, `status=${created.status}`);
    requestId = created.body.request?.id || '';
    for (const step of ['probe', 'generate', 'validate', 'staging']) {
      const running = await req(`${base}/requests/${requestId}/steps`, 'POST', { step, status: 'running' });
      const done = await req(`${base}/requests/${requestId}/steps`, 'POST', { step, status: 'succeeded', evidence: `${step}.json` });
      add(`step:${step}`, running.status === 200 && done.status === 200, `${running.status}/${done.status}`);
    }
    const accepted = await req(`${base}/requests/${requestId}/accept`, 'POST', { acceptedBy: '演练验收人', note: '演练' });
    add('accept', accepted.status === 200 && accepted.body.request.state === 'accept', `status=${accepted.status} state=${accepted.body.request?.state}`);
    const backup = path.join(root, 'backup.db');
    cpA.store.backup(backup);
    add('backup', fs.existsSync(backup) && fs.statSync(backup).size > 0, backup);
    const prune = await req(`${base}/admin/prune-requests`, 'POST', { olderThanDays: 0, dryRun: true });
    add('prune-dry-run', prune.status === 200 && prune.body.dryRun === true, `candidates=${prune.body.candidates}`);
    await cpA.stop();

    const restored = restore({ backup, dataRoot: dataRootB });
    add('restore', restored.ok === true, restored.restored);
    const cpB = createControlPlane({ dataRoot: dataRootB, token: TOKEN });
    const { port: portB } = await cpB.start({ port: 0 });
    try {
      const got = await req(`http://127.0.0.1:${portB}/requests/${requestId}`, 'GET');
      add('restored-request', got.status === 200 && got.body.request.state === 'accept', `status=${got.status}`);
      const hc = await checkHealth({ url: `http://127.0.0.1:${portB}`, token: TOKEN, thresholds: { maxAudit: 10000, maxDbBytes: 100 * 1024 * 1024, maxFailed: 100 } });
      add('health-check', hc.ok === true, JSON.stringify(hc.checks.filter((c) => !c.ok)));
    } finally {
      await cpB.stop();
    }
    const report = { ok: checks.every((c) => c.ok), root, requestId, checks, at: new Date().toISOString() };
    fs.writeFileSync(path.join(root, 'pilot-drill.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    return report;
  } finally {
    try { await cpA.stop(); } catch { /* already stopped */ }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--root');
  try {
    const r = await runPilotDrill({ root: i >= 0 ? args[i + 1] : undefined });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  } catch (err) {
    console.error(`[pilot-drill] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { runPilotDrill };
