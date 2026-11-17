// complex-scenarios.test.mjs —— 复杂场景与执行可靠性回归测试
// 覆盖：鉴权 401/200、dry_run 幂等键与额度、写闸门与幂等优先、单 worker 串行、
//       取消、重启恢复、旧库 dry_run 列迁移、runner-api 分页/重试/空数据/持久失败。
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createService } = require('../runtime/index.js');
const { JobStore } = require('../runtime/store.js');
const { startMockUpstream } = require('../../fixtures/mock-upstream.js');
const { runApiTask } = require('../runtime/runner-api.js');

process.env.TEST_API_KEY = process.env.TEST_API_KEY || 'complex-test-key';

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function bootService(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cx-'));
  const port = await freePort();
  const svc = createService({
    id: 'complex-test', port, dataDir: dir, taskType: opts.taskType || 'complex_task',
    version: '0.0.1', write: !!opts.write, authToken: opts.authToken || '', dailyWriteQuota: opts.quota || 20,
    runJob: opts.runJob || (async (job, ctx) => {
      await ctx.saveFile({ fileName: 'out.json', content: JSON.stringify({ ok: true, params: job.params }), kind: 'main' });
    }),
  });
  await svc.start();
  return { svc, port, dir };
}

async function jget(port, p, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function jpost(port, p, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function waitFinal(port, jobId, headers = {}, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await jget(port, `/jobs/${jobId}`, headers);
    if (['done', 'failed', 'cancelled'].includes(s.body.status)) return s.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`等待任务超时：${jobId}`);
}

let mock = null;
test.before(async () => { mock = await startMockUpstream(); });
test.after(async () => { if (mock && mock.server) await new Promise((r) => mock.server.close(r)); });

test('鉴权：GET /jobs 无 token 401，有 token 200', async () => {
  const { svc, port } = await bootService({ authToken: 'tk' });
  try {
    assert.equal((await jget(port, '/jobs?limit=1')).status, 401);
    assert.equal((await jget(port, '/jobs?limit=1', { authorization: 'Bearer tk' })).status, 200);
  } finally { await svc.stop(); }
});

test('dry_run 可复用同一幂等键且不占写额度；幂等优先于额度', async () => {
  const { svc, port } = await bootService({ write: true, authToken: 'tk', quota: 3 });
  const H = { authorization: 'Bearer tk' };
  try {
    // dry_run 同一 idempotency_key 提交两次：都 202（不应 500）
    assert.equal((await jpost(port, '/jobs', { params: { dry_run: true, idempotency_key: 'same' } }, H)).status, 202);
    assert.equal((await jpost(port, '/jobs', { params: { dry_run: true, idempotency_key: 'same' } }, H)).status, 202);

    // 未 confirm_write → 403
    assert.equal((await jpost(port, '/jobs', { params: {} }, H)).status, 403);

    // 3 次真实写 → 202（dry_run 不计入额度）
    const jobs = [];
    for (let i = 1; i <= 3; i += 1) {
      const r = await jpost(port, '/jobs', { params: { confirm_write: true, idempotency_key: `r${i}` } }, H);
      assert.equal(r.status, 202, `第 ${i} 次真实写应 202`);
      jobs.push(r.body.jobId);
    }
    // 额度用尽：新的真实写 → 429
    assert.equal((await jpost(port, '/jobs', { params: { confirm_write: true, idempotency_key: 'r4' } }, H)).status, 429);
    // 额度用尽后，重复既有幂等键仍应命中缓存任务（200 deduplicated），而不是 429
    const dup = await jpost(port, '/jobs', { params: { confirm_write: true, idempotency_key: 'r1' } }, H);
    assert.equal(dup.status, 200);
    assert.equal(dup.body.deduplicated, true);
    assert.equal(dup.body.jobId, jobs[0]);

    for (const id of jobs) await waitFinal(port, id, H);
  } finally { await svc.stop(); }
});

test('单 worker 串行：并发提交 3 个任务，最大并发为 1 且全部完成', async () => {
  let active = 0; let maxActive = 0;
  const { svc, port } = await bootService({
    runJob: async (job, ctx) => {
      active += 1; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 150));
      ctx.setProgress('half');
      await ctx.saveFile({ fileName: 'out.json', content: JSON.stringify({ jobId: job.jobId }), kind: 'main' });
      active -= 1;
    },
  });
  try {
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await jpost(port, '/jobs', { params: { i } });
      assert.equal(r.status, 202);
      ids.push(r.body.jobId);
    }
    for (const id of ids) assert.equal((await waitFinal(port, id)).status, 'done');
    assert.equal(maxActive, 1, `期望串行执行，实际最大并发 ${maxActive}`);
  } finally { await svc.stop(); }
});

test('取消：运行中任务可取消并落为 cancelled', async () => {
  const { svc, port } = await bootService({
    runJob: async (job, ctx) => {
      for (let i = 0; i < 40; i += 1) {
        if (ctx.isAborted()) throw new Error('任务已被终止');
        ctx.setProgress(`step ${i}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      await ctx.saveFile({ fileName: 'out.json', content: '{}', kind: 'main' });
    },
  });
  try {
    const sub = await jpost(port, '/jobs', { params: {} });
    await new Promise((r) => setTimeout(r, 300));
    const c = await jpost(port, `/jobs/${sub.body.jobId}/cancel`, {});
    assert.equal(c.status, 200);
    const final = await waitFinal(port, sub.body.jobId);
    assert.equal(final.status, 'cancelled');
  } finally { await svc.stop(); }
});

test('重启恢复：running → failed(服务重启) 且错误可读', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cx-store-'));
  const db = path.join(dir, 'jobs.db');
  let store = new JobStore(db);
  store.create({ jobId: 'j1', task: 't', params: {} });
  store.update('j1', { status: 'running' });
  store.close();
  store = new JobStore(db);
  assert.equal(store.recoverInterrupted(), 1);
  const j = store.get('j1');
  assert.equal(j.status, 'failed');
  assert.match(String(j.error), /服务重启/);
  store.close();
});

test('旧库迁移：缺少 dry_run 列的 jobs 表可自动补列', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cx-mig-'));
  const db = path.join(dir, 'jobs.db');
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(db);
  raw.exec(`CREATE TABLE jobs (job_id TEXT PRIMARY KEY, task TEXT, params TEXT, status TEXT, progress TEXT,
    error TEXT, created_at TEXT, started_at TEXT, finished_at TEXT, duration_ms INTEGER DEFAULT 0,
    cancel_requested INTEGER DEFAULT 0, idempotency_key TEXT);`);
  raw.prepare("INSERT INTO jobs (job_id, task, params, status, created_at) VALUES ('old1','t','{}','done','2026-01-01T00:00:00.000Z')").run();
  raw.close();
  const store = new JobStore(db);
  const cols = store.db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  assert.ok(cols.includes('dry_run'), 'dry_run 列未补上');
  assert.equal(store.get('old1').dryRun, false);
  store.close();
});

function apiRunJob() {
  const TASK = {
    task: 't_api', baseUrl: mock.url, path: '/mock/orders', authEnv: 'TEST_API_KEY',
    pageSize: 10, maxPages: 5,
    buildBody: (p, page, pageSize) => ({
      page, pageSize,
      total_rows: Number(p.total_rows) || 25,
      delay_ms: Number(p.delay_ms) || 5,
      fail_first_n: Number(p.fail_first_n) || 0,
      empty: p.empty === true,
    }),
  };
  return async (job, ctx) => runApiTask(job, ctx, TASK);
}
async function datasetOf(port, jobId) {
  const r = await jget(port, `/jobs/${jobId}/result`);
  assert.equal(r.status, 200);
  return JSON.parse(fs.readFileSync(r.body.main.path, 'utf8'));
}

test('runner-api：分页 + 首轮 500 自动重试后成功', async () => {
  mock.reset();
  const { svc, port } = await bootService({ runJob: apiRunJob() });
  try {
    const sub = await jpost(port, '/jobs', { params: { pages: 2, total_rows: 25, fail_first_n: 1 } });
    const final = await waitFinal(port, sub.body.jobId);
    assert.equal(final.status, 'done');
    const ds = await datasetOf(port, sub.body.jobId);
    const rows = ds.pages.flatMap((p) => p.rows || []);
    assert.equal(rows.length, 20);
    assert.equal(Number(ds.total), 25);
    assert.ok(mock.stats().injectedFailures >= 1, '模拟上游应至少注入 1 次 500');
  } finally { await svc.stop(); }
});

test('runner-api：空数据任务 done、dataset pages 为空', async () => {
  mock.reset();
  const { svc, port } = await bootService({ runJob: apiRunJob() });
  try {
    const sub = await jpost(port, '/jobs', { params: { pages: 2, total_rows: 25, empty: true } });
    const final = await waitFinal(port, sub.body.jobId);
    assert.equal(final.status, 'done');
    const ds = await datasetOf(port, sub.body.jobId);
    assert.equal(ds.pages.length, 0);
    assert.equal(Number(ds.total), 25);
  } finally { await svc.stop(); }
});

test('runner-api：上游持续 500 → 任务 failed 且错误可读', async () => {
  mock.reset();
  const { svc, port } = await bootService({ runJob: apiRunJob() });
  try {
    const sub = await jpost(port, '/jobs', { params: { pages: 1, total_rows: 25, fail_first_n: 10 } });
    const final = await waitFinal(port, sub.body.jobId);
    assert.equal(final.status, 'failed');
    assert.match(String(final.error), /500|模拟上游/);
  } finally { await svc.stop(); }
});
