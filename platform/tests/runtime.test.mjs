// runtime.test.mjs —— 共享 runtime 集成测试：鉴权 / 任务 / 结果 / 取消 / 写操作闸门
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createService } = require('../runtime/index.js');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function bootService(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rt-'));
  const port = await freePort();
  const svc = createService({
    id: 'test-plugin', port, dataDir: dir, taskType: 'test_task',
    version: '3.0.0', authToken: opts.authToken || '', write: !!opts.write,
    dailyWriteQuota: 5,
    runJob: async (job, ctx) => {
      if (opts.slow) { for (let i = 0; i < 20; i += 1) { if (ctx.isAborted()) throw new Error('任务已被终止'); await new Promise((r) => setTimeout(r, 100)); } }
      ctx.setProgress('half');
      await ctx.saveFile({ fileName: 'out.json', content: JSON.stringify({ ok: true, params: job.params }), kind: 'main' });
    },
  });
  await svc.start();
  return { svc, port, dir };
}

async function jget(port, p, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function jpost(port, p, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('无鉴权：提交→执行→取结果', async () => {
  const { svc, port } = await bootService();
  try {
    const submit = await jpost(port, '/jobs', { params: { a: 1 } });
    assert.equal(submit.status, 202);
    const id = submit.body.jobId;
    for (let i = 0; i < 50; i += 1) {
      const s = await jget(port, `/jobs/${id}`);
      if (s.body.status === 'done') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const r = await jget(port, `/jobs/${id}/result`);
    assert.equal(r.status, 200);
    assert.equal(r.body.main.fileName, 'out.json');
    const meta = JSON.parse(fs.readFileSync(r.body.main.path, 'utf8'));
    assert.deepEqual(meta.params, { a: 1 });
  } finally { await svc.stop(); }
});

test('鉴权：无 token 401，有 token 202', async () => {
  const { svc, port } = await bootService({ authToken: 'tk' });
  try {
    assert.equal((await jpost(port, '/jobs', {})).status, 401);
    const okRes = await jpost(port, '/jobs', {}, { authorization: 'Bearer tk' });
    assert.equal(okRes.status, 202);
  } finally { await svc.stop(); }
});

test('写操作闸门：缺 confirm_write 403，带 confirm 202 且审计计数', async () => {
  const { svc, port } = await bootService({ write: true, authToken: 'tk' });
  try {
    const denied = await jpost(port, '/jobs', { params: {} }, { authorization: 'Bearer tk' });
    assert.equal(denied.status, 403);
    const okRes = await jpost(port, '/jobs', { params: { confirm_write: true } }, { authorization: 'Bearer tk' });
    assert.equal(okRes.status, 202);
  } finally { await svc.stop(); }
});

test('取消：运行中任务可取消', async () => {
  const { svc, port } = await bootService({ slow: true });
  try {
    const submit = await jpost(port, '/jobs', { params: {} });
    const id = submit.body.jobId;
    await new Promise((r) => setTimeout(r, 300));
    const c = await jpost(port, `/jobs/${id}/cancel`, {});
    assert.equal(c.status, 200);
    let final = '';
    for (let i = 0; i < 50; i += 1) {
      const s = await jget(port, `/jobs/${id}`);
      final = s.body.status;
      if (['done', 'failed', 'cancelled'].includes(final)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(['cancelled', 'failed'].includes(final), `期望取消，实际 ${final}`);
  } finally { await svc.stop(); }
});

test('指标接口包含任务统计', async () => {
  const { svc, port } = await bootService();
  try {
    await jpost(port, '/jobs', { params: {} });
    await new Promise((r) => setTimeout(r, 500));
    const m = await jget(port, '/metrics');
    assert.equal(m.status, 200);
    assert.ok(m.body.jobsByStatus, '缺 jobsByStatus');
  } finally { await svc.stop(); }
});
