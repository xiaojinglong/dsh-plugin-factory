// control-plane.test.mjs —— 本地控制面生产级集成测试（临时数据根，不触碰真实运行数据）
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createControlPlane } = require('../../apps/control-plane/server.cjs');
const { restore } = require('../../apps/control-plane/restore.cjs');

const TOKEN = 'test-token';
const H = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-cp-')); }
async function withApp(fn) {
  const dataRoot = tmp();
  const cp = createControlPlane({ dataRoot, token: TOKEN });
  const { port } = await cp.start({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  try { await fn({ cp, base, dataRoot }); } finally { await cp.stop(); }
}
async function get(base, p, headers = H) {
  const r = await fetch(`${base}${p}`, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function post(base, p, body, headers = H) {
  const r = await fetch(`${base}${p}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

test('health 无需鉴权', async () => {
  await withApp(async ({ base }) => {
    const r = await get(base, '/health', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.service, 'control-plane');
  });
});

test('鉴权：缺失/错误 token 401，正确 token 200', async () => {
  await withApp(async ({ base }) => {
    assert.equal((await get(base, '/requests', {})).status, 401);
    assert.equal((await get(base, '/requests', { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await get(base, '/requests')).status, 200);
  });
});

test('创建需求单 → 审计 → 查询', async () => {
  await withApp(async ({ base }) => {
    const r = await post(base, '/requests', { brief: '做一个缺货预警插件', params: { pages: 2 } }, { ...H, 'x-actor': 'alice' });
    assert.equal(r.status, 201);
    assert.equal(r.body.request.state, 'submitted');
    const id = r.body.request.id;
    assert.match(id, /^req_/);

    const one = await get(base, `/requests/${id}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.request.brief, '做一个缺货预警插件');

    const audit = await get(base, `/requests/${id}/audit`);
    assert.equal(audit.status, 200);
    assert.ok(audit.body.audit.some((a) => a.action === 'request.create' && a.actor === 'alice'));
  });
});

test('输入校验：brief/params/idempotency', async () => {
  await withApp(async ({ base }) => {
    assert.equal((await post(base, '/requests', {})).status, 400);
    assert.equal((await post(base, '/requests', { brief: 'x'.repeat(5001) })).status, 400);
    assert.equal((await post(base, '/requests', { brief: 'ok', params: [] })).status, 400);
    const r = await post(base, '/requests', { brief: 'ok' }, { ...H, 'idempotency-key': 'x'.repeat(121) });
    assert.equal(r.status, 400);
  });
});

test('状态机：probe 必须按序、running→succeeded、禁止跳步', async () => {
  await withApp(async ({ base }) => {
    const id = (await post(base, '/requests', { brief: '状态机' })).body.request.id;

    // 跳步
    assert.equal((await post(base, `/requests/${id}/steps`, { step: 'generate', status: 'running' })).status, 409);
    // 未 running 直接 succeeded
    assert.equal((await post(base, `/requests/${id}/steps`, { step: 'probe', status: 'succeeded' })).status, 409);
    // running probe
    const run = await post(base, `/requests/${id}/steps`, { step: 'probe', status: 'running' });
    assert.equal(run.status, 200);
    assert.equal(run.body.request.currentStep, 'probe');
    // 并发 running
    assert.equal((await post(base, `/requests/${id}/steps`, { step: 'probe', status: 'running' })).status, 409);
    // succeeded
    const ok = await post(base, `/requests/${id}/steps`, { step: 'probe', status: 'succeeded', evidence: 'probe.json' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.request.state, 'probe');
    assert.equal(ok.body.request.currentStep, null);
    assert.ok(ok.body.request.steps.some((s) => s.step === 'probe' && s.status === 'succeeded'));
  });
});

test('失败语义：failed 必须给 error 且进入终态', async () => {
  await withApp(async ({ base }) => {
    const id = (await post(base, '/requests', { brief: '失败' })).body.request.id;
    assert.equal((await post(base, `/requests/${id}/steps`, { step: 'probe', status: 'failed' })).status, 400);
    await post(base, `/requests/${id}/steps`, { step: 'probe', status: 'running' });
    const fail = await post(base, `/requests/${id}/steps`, { step: 'probe', status: 'failed', error: '接口 500' });
    assert.equal(fail.status, 200);
    assert.equal(fail.body.request.state, 'failed');
    assert.equal(fail.body.request.error, '接口 500');
    assert.equal((await post(base, `/requests/${id}/steps`, { step: 'generate', status: 'running' })).status, 409);
  });
});

test('note 步骤不改变状态，且可用于记录证据', async () => {
  await withApp(async ({ base }) => {
    const id = (await post(base, '/requests', { brief: 'note' })).body.request.id;
    const n = await post(base, `/requests/${id}/steps`, { step: 'note', status: 'succeeded', evidence: '业务确认口径' });
    assert.equal(n.status, 200);
    assert.equal(n.body.request.state, 'submitted');
    assert.ok(n.body.request.steps.some((s) => s.step === 'note'));
  });
});

test('idempotency-key：重放返回同一需求单且只创建一次', async () => {
  await withApp(async ({ base }) => {
    const headers = { ...H, 'idempotency-key': 'biz-001' };
    const a = await post(base, '/requests', { brief: '幂等' }, headers);
    const b = await post(base, '/requests', { brief: '幂等' }, headers);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.deduplicated, true);
    assert.equal(b.body.request.id, a.body.request.id);
    const list = await get(base, '/requests');
    assert.equal(list.body.requests.length, 1);
  });
});

test('列表/详情/404 统一错误', async () => {
  await withApp(async ({ base }) => {
    const id = (await post(base, '/requests', { brief: '列表' })).body.request.id;
    assert.equal((await get(base, `/requests/${id}`)).status, 200);
    const missing = await get(base, '/requests/req_nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'REQUEST_NOT_FOUND');
    const nf = await get(base, '/nope');
    assert.equal(nf.status, 404);
    assert.equal(nf.body.error.code, 'NOT_FOUND');
    assert.equal((await get(base, '/requests?state=weird')).status, 400);
    assert.equal((await get(base, '/requests?limit=1')).status, 200);
  });
});

test('plugins：返回 12 个插件且不泄漏 token', async () => {
  await withApp(async ({ base }) => {
    const r = await get(base, '/plugins');
    assert.equal(r.status, 200);
    assert.ok(r.body.plugins.length >= 12);
    assert.ok(r.body.plugins.some((p) => p.id === 'bulk-sync'));
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes('serviceToken'));
    assert.ok(!text.includes('MCP_SERVICE_TOKEN'));
  });
});

test('metrics：统计与鉴权', async () => {
  await withApp(async ({ base }) => {
    await post(base, '/requests', { brief: '指标' });
    assert.equal((await get(base, '/metrics', {})).status, 401);
    const r = await get(base, '/metrics');
    assert.equal(r.status, 200);
    assert.ok(r.body.requests.total >= 1);
    assert.ok(r.body.auditCount >= 1);
  });
});

test('备份：生成可打开的 SQLite 文件', async () => {
  await withApp(async ({ base, dataRoot }) => {
    const r = await post(base, '/admin/backup', { fileName: 'snap.db' });
    assert.equal(r.status, 201);
    assert.ok(fs.existsSync(r.body.path));
    assert.ok(fs.statSync(r.body.path).size > 0);
    assert.ok(r.body.path.startsWith(path.join(dataRoot, 'control-plane', 'backups')));
    assert.equal((await post(base, '/admin/backup', { fileName: '../evil.db' })).status, 400);
  });
});

test('持久化：重启后需求单与审计仍在', async () => {
  const dataRoot = tmp();
  const a = createControlPlane({ dataRoot, token: TOKEN });
  const { port } = await a.start({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  const created = await post(base, '/requests', { brief: '持久化' });
  const id = created.body.request.id;
  await a.stop();

  const b = createControlPlane({ dataRoot, token: TOKEN });
  const second = await b.start({ port: 0 });
  const base2 = `http://127.0.0.1:${second.port}`;
  try {
    const r = await get(base2, `/requests/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.request.brief, '持久化');
    const audit = await get(base2, `/requests/${id}/audit`);
    assert.ok(audit.body.audit.length >= 1);
  } finally { await b.stop(); }
});

test('无效步骤/状态/证据长度被拒绝', async () => {
  await withApp(async ({ base }) => {
    const id = (await post(base, '/requests', { brief: '校验' })).body.request.id;
    assert.equal((await post(base, `/requests/${id}/steps`, { step: 'hack', status: 'running' })).status, 400);
    assert.equal((await post(base, `/requests/${id}/steps`, { step: 'probe', status: 'done' })).status, 400);
    assert.equal((await post(base, `/requests/${id}/steps`, { step: 'probe', status: 'running', evidence: 'x'.repeat(5000) })).status, 200);
  });
});

test('write_runner：静态校验、落盘、更新 params.runnerFile；状态/越权拒绝', async () => {
  await withApp(async ({ base }) => {
    const id = (await post(base, '/requests', { brief: 'runner 注入' })).body.request.id;
    const source = "'use strict';\nasync function runJob(job, ctx) { await ctx.saveFile({ kind: 'main', fileName: 'x.json', content: '{}' }); }\nmodule.exports = { runJob };\n";
    const ok = await post(base, `/requests/${id}/runner`, { source });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(fs.existsSync(ok.body.runnerFile));
    assert.match(ok.body.sha256, /^[a-f0-9]{64}$/);
    const got = await get(base, `/requests/${id}`);
    assert.equal(got.body.request.params.runnerFile, ok.body.runnerFile);

    // 静态禁止项
    const bad = await post(base, `/requests/${id}/runner`, { source: "require('child_process'); async function runJob(){}; module.exports={runJob};" });
    assert.equal(bad.status, 400);

    // 状态不允许
    const id2 = (await post(base, '/requests', { brief: 'runner 状态' })).body.request.id;
    await post(base, `/requests/${id2}/steps`, { step: 'probe', status: 'running' });
    await post(base, `/requests/${id2}/steps`, { step: 'probe', status: 'succeeded' });
    const late = await post(base, `/requests/${id2}/runner`, { source });
    assert.equal(late.status, 409);

    // 不存在
    assert.equal((await post(base, '/requests/req_missing/runner', { source })).status, 404);
    // 空/过大
    assert.equal((await post(base, `/requests/${id}/runner`, {})).status, 400);
    assert.equal((await post(base, `/requests/${id}/runner`, { source: 'x'.repeat(200 * 1024 + 1) })).status, 400);
  });
});

test('accept 门禁：仅 staging 可验收，必须 acceptedBy，验收后进 accepted', async () => {
  await withApp(async ({ base }) => {
    const id = (await post(base, '/requests', { brief: '验收门禁' })).body.request.id;
    for (const step of ['probe', 'generate', 'validate', 'staging']) {
      assert.equal((await post(base, `/requests/${id}/steps`, { step, status: 'running' })).status, 200);
      assert.equal((await post(base, `/requests/${id}/steps`, { step, status: 'succeeded', evidence: `${step}.json` })).status, 200);
    }
    assert.equal((await get(base, `/requests/${id}`)).body.request.state, 'staging');
    assert.equal((await post(base, `/requests/${id}/accept`, { note: '缺验收人' })).status, 400);
    const ok = await post(base, `/requests/${id}/accept`, { acceptedBy: '业务-张三', note: '报告口径确认' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.request.state, 'accept');
    const acceptSteps = ok.body.request.steps.filter((s) => s.step === 'accept');
    const acceptStep = acceptSteps.find((s) => s.status === 'succeeded');
    assert.ok(acceptStep, 'accept 应有 succeeded 记录');
    assert.match(acceptStep.evidence, /业务-张三/);
    assert.equal((await post(base, `/requests/${id}/accept`, { acceptedBy: '业务-李四' })).status, 409);
  });
});

test('硬化工装：POST 限流 429，GET health 不受影响且带 db 检查', async () => {
  const dataRoot = tmp();
  const cp = createControlPlane({ dataRoot, token: TOKEN, rateLimit: 2 });
  const { port } = await cp.start({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await post(base, '/requests', { brief: '限流1' })).status, 201);
    assert.equal((await post(base, '/requests', { brief: '限流2' })).status, 201);
    const limited = await post(base, '/requests', { brief: '限流3' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
    const health = await get(base, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.checks.db, true);
    assert.equal((await get(base, '/plugins', {})).status, 401, 'GET 无 token 仍 401，不受限流影响');
  } finally {
    await cp.stop();
  }
});

test('prune：默认 dry-run，确认后删除旧审计并记一条 prune 审计', async () => {
  await withApp(async ({ base }) => {
    for (let i = 0; i < 3; i += 1) await post(base, '/requests', { brief: `审计${i}` });
    const dry = await post(base, '/admin/prune', { olderThanDays: 0, dryRun: true });
    assert.equal(dry.status, 200);
    assert.ok(dry.body.candidates >= 3);
    assert.equal(dry.body.deleted, 0);
    const real = await post(base, '/admin/prune', { olderThanDays: 0, dryRun: false });
    assert.equal(real.status, 200);
    assert.ok(real.body.deleted >= 3);
    const audit = await get(base, '/audit?limit=10');
    assert.ok(audit.body.audit.some((a) => a.action === 'audit.prune'));
    assert.equal((await post(base, '/admin/prune', { olderThanDays: 99999 })).status, 400);
  });
});

test('restore：备份恢复到新数据根，需求单可读；非法备份拒绝', async () => {
  const dataRootA = tmp();
  const cpA = createControlPlane({ dataRoot: dataRootA, token: TOKEN });
  const { port } = await cpA.start({ port: 0 });
  const baseA = `http://127.0.0.1:${port}`;
  let id;
  try {
    id = (await post(baseA, '/requests', { brief: '恢复演练' })).body.request.id;
    const backup = path.join(dataRootA, 'backup.db');
    cpA.store.backup(backup);
    await cpA.stop();
    const dataRootB = tmp();
    const r = restore({ backup, dataRoot: dataRootB });
    assert.equal(r.ok, true);
    const cpB = createControlPlane({ dataRoot: dataRootB, token: TOKEN });
    const { port: portB } = await cpB.start({ port: 0 });
    try {
      const got = await get(`http://127.0.0.1:${portB}`, `/requests/${id}`);
      assert.equal(got.status, 200);
      assert.equal(got.body.request.brief, '恢复演练');
    } finally { await cpB.stop(); }
    const bad = path.join(dataRootB, 'bad.db');
    fs.writeFileSync(bad, 'not-a-sqlite', 'utf8');
    assert.throws(() => restore({ backup: bad, dataRoot: tmp() }), /数据库|SQLite|file is not a database|缺少表/i);
  } finally {
    try { await cpA.stop(); } catch { /* already stopped */ }
  }
});
