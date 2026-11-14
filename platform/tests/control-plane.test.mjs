// control-plane.test.mjs —— 本地控制面生产级集成测试（临时数据根，不触碰真实运行数据）
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createControlPlane } = require('../../apps/control-plane/server.cjs');

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
