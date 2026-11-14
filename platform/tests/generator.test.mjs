// generator.test.mjs —— M3 SDK + 生成/校验垂直切片
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { validatePluginSpec } = require('../../packages/sdk');
const { generate, validateDir } = require('../../apps/generator/generator.cjs');
const { probeFixture, probeHttp, isHostAllowed, isPrivateIp, assertUrlAllowed } = require('../../apps/generator/probe.cjs');
const sandbox = require('../../apps/generator/sandbox.cjs');
const { runPipeline } = require('../../apps/generator/pipeline.cjs');
const { createControlPlane } = require('../../apps/control-plane/server.cjs');

function baseSpec(over = {}) {
  return {
    id: 'demo-fixture', version: '0.1.0', name: '演示插件', type: 'api',
    runtimeRange: '^3.2', owner: 'local', taskType: 'demo_fixture',
    paramsSchema: {}, outputSchema: {}, permissions: { write: false, network: [], browser: false },
    service: { entry: 'server.js', runner: 'runner.js' },
    mcp: { serverName: 'demo-fixture' }, skill: { name: 'demo-fixture' }, report: { generator: 'gen-report.mjs' },
    ...over,
  };
}

test('SDK：合法 plugin.json 通过；非法 id/taskType/type 被拒绝', () => {
  assert.equal(validatePluginSpec(baseSpec()).ok, true);
  assert.equal(validatePluginSpec(baseSpec({ id: 'Bad_ID' })).ok, false);
  assert.equal(validatePluginSpec(baseSpec({ taskType: 'Bad-Task' })).ok, false);
  assert.equal(validatePluginSpec(baseSpec({ type: 'unknown' })).ok, false);
  assert.equal(validatePluginSpec(baseSpec({ extra: 1 })).ok, false);
});

test('生成器：生成 fixture 插件 → 结构/语法校验 → 起服务预演', async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-gen-'));
  const out = path.join(t, 'demo-fixture');
  const gen = await generate({ id: 'demo-fixture', name: '演示插件', type: 'api', out, port: 0 });
  assert.equal(gen.spec.id, 'demo-fixture');
  assert.ok(fs.existsSync(path.join(out, 'plugin.json')));
  assert.ok(fs.existsSync(path.join(out, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(out, 'mcp', 'index.js')));
  assert.ok(fs.existsSync(path.join(out, 'report', 'gen-report.mjs')) === false, 'report 生成器应在插件根目录');
  assert.ok(fs.existsSync(path.join(out, 'gen-report.mjs')));
  assert.ok(fs.existsSync(path.join(out, 'evidence', 'generation.json')));

  const v = await validateDir(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.rows, 2);
  assert.ok(fs.existsSync(path.join(out, 'evidence', 'validation.json')));
  const validation = JSON.parse(fs.readFileSync(path.join(out, 'evidence', 'validation.json'), 'utf8'));
  assert.equal(validation.ok, true);
  assert.ok(validation.datasetPath && fs.existsSync(validation.datasetPath));
});

test('生成器：默认拒绝覆盖已有目录，--force 可覆盖', async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-gen2-'));
  const out = path.join(t, 'demo-fixture');
  await generate({ id: 'demo-fixture', name: '演示插件', out, port: 0 });
  await assert.rejects(() => generate({ id: 'demo-fixture', name: '演示插件', out, port: 0 }), /输出目录已存在/);
  await generate({ id: 'demo-fixture', name: '演示插件', out, port: 0, force: true });
  assert.ok(fs.existsSync(path.join(out, 'plugin.json')));
});

test('probe：fixture 勘探返回字段/样本/行数', async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-probe-'));
  const fixture = path.join(t, 'data.json');
  fs.writeFileSync(fixture, JSON.stringify({ rows: [{ a: 1, b: 'x' }, { a: 2, b: 'y' }] }), 'utf8');
  const r = await probeFixture(fixture);
  assert.equal(r.kind, 'fixture');
  assert.equal(r.count, 2);
  assert.deepEqual(r.fields, ['a', 'b']);
  assert.equal(r.sample.length, 2);
});

test('pipeline：需求单 → probe → generate → validate → staging → 报告', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-pipe-'));
  const fixture = path.join(dataRoot, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ rows: [{ k: 1, v: 'a' }, { k: 2, v: 'b' }, { k: 3, v: 'c' }] }), 'utf8');
  const token = 'pipe-token';
  const cp = createControlPlane({ dataRoot, token });
  const { port } = await cp.start({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  try {
    const created = await (await fetch(`${base}/requests`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ brief: '流水线生成', params: { pluginId: 'pipe-demo', name: '流水线演示', type: 'api', fixture } }),
    })).json();
    const requestId = created.request.id;
    const out = await runPipeline({ baseUrl: base, token, requestId, dataRoot });
    assert.equal(out.ok, true);
    assert.equal(out.state, 'staging');

    const req = await (await fetch(`${base}/requests/${requestId}`, { headers: H })).json();
    assert.equal(req.request.state, 'staging');
    const steps = req.request.steps.filter((s) => s.status === 'succeeded').map((s) => s.step);
    for (const s of ['probe', 'generate', 'validate', 'staging']) assert.ok(steps.includes(s), `缺少步骤 ${s}`);

    const report = path.join(out.pluginDir, 'report', 'pipe-demo-report.html');
    assert.ok(fs.existsSync(report), '报告应生成');
    assert.ok(fs.statSync(report).size > 0);
    assert.ok(fs.existsSync(path.join(out.pluginDir, 'evidence', 'validation.json')));
    assert.ok(fs.existsSync(path.join(out.pluginDir, 'evidence', 'probe.json')) === false, 'probe 证据在 runDir');
    assert.ok(fs.existsSync(path.join(dataRoot, 'generator', 'runs', requestId, 'probe.json')));
  } finally {
    await cp.stop();
  }
});

test('probe 安全：allowlist / 私网拒绝 / SSRF 防护', async () => {
  assert.equal(isHostAllowed('a.example.com', ['*.example.com']), true);
  assert.equal(isHostAllowed('example.com', ['*.example.com']), false);
  assert.equal(isHostAllowed('127.0.0.1', ['127.0.0.1']), true);
  assert.equal(isPrivateIp('10.1.2.3'), true);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('192.168.1.1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  await assert.rejects(() => assertUrlAllowed('http://169.254.169.254/latest/meta-data'), /allowlist/);
  await assert.rejects(() => assertUrlAllowed('http://10.0.0.1/'), /allowlist/);
  await assert.rejects(() => assertUrlAllowed('file:///C:/Windows/win.ini'), /http/);
});

test('probe HTTP：本机 JSON、鉴权不回显、超大响应拒绝', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: { list: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] } }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  process.env.PROBE_TEST_TOKEN = 'super-secret-token';
  try {
    const r = await probeHttp(base, { authEnv: 'PROBE_TEST_TOKEN' });
    assert.equal(r.kind, 'http');
    assert.equal(r.count, 2);
    assert.deepEqual(r.fields, ['id', 'name']);
    assert.equal(r.authUsed, true);
    assert.ok(!JSON.stringify(r).includes('super-secret-token'), '凭证不得出现在 probe 结果');
    await assert.rejects(() => probeHttp(`${base}/big`), /响应过大/);
  } finally {
    delete process.env.PROBE_TEST_TOKEN;
    await new Promise((r) => srv.close(r));
  }
});

test('golden tickets：两类 fixture 生成→校验→报告均通过', async () => {
  const tickets = [
    { id: 'golden-orders', name: '订单黄金样例', rows: [{ order_id: 'SO-1', amount: 10 }, { order_id: 'SO-2', amount: 20 }], fields: ['order_id', 'amount'] },
    { id: 'golden-inventory', name: '库存黄金样例', rows: [{ sku: 'SKU-1', stock: 5 }, { sku: 'SKU-2', stock: 0 }], fields: ['sku', 'stock'] },
  ];
  for (const t of tickets) {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-a-${t.id}-`));
    const fixture = path.join(dataRoot, 'fixture.json');
    fs.writeFileSync(fixture, JSON.stringify({ rows: t.rows }), 'utf8');
    const out = path.join(dataRoot, 'plugin');
    await generate({ id: t.id, name: t.name, type: 'api', out, fixture, port: 0 });
    const v = await validateDir(out);
    assert.equal(v.ok, true, `${t.id}: ${JSON.stringify(v.errors)}`);
    const evidence = JSON.parse(fs.readFileSync(path.join(out, 'evidence', 'validation.json'), 'utf8'));
    const ds = JSON.parse(fs.readFileSync(evidence.datasetPath, 'utf8'));
    const rows = (ds.pages || []).flatMap((p) => p.rows || []);
    assert.equal(rows.length, t.rows.length);
    assert.deepEqual(Object.keys(rows[0]), t.fields);
    const report = fs.readFileSync(path.join(out, 'report', `${t.id}-report.html`), 'utf8');
    assert.match(report, /样本行/);
    assert.match(report, new RegExp(t.id));
    assert.ok(evidence.checks.some((c) => c.name === 'sandbox:service' && c.ok), 'service 沙箱标记缺失');
  }
});

test('sandbox：仅允许写 staging，拒绝写外部路径', () => {
  assert.equal(sandbox.supportsPermissionModel(), true, 'Node 24 应支持 permission model');
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-sandbox-'));
  const allowed = path.join(t, 'allowed');
  const deniedDir = path.join(t, 'denied');
  fs.mkdirSync(allowed, { recursive: true });
  fs.mkdirSync(deniedDir, { recursive: true });
  const denied = path.join(deniedDir, 'escape.txt');
  const argsDenied = sandbox.buildArgs({ readDirs: [], writeDirs: [allowed], scriptArgs: ['-e', `require('fs').writeFileSync(${JSON.stringify(denied)}, 'x')`] });
  const r1 = spawnSync(process.execPath, argsDenied, { encoding: 'utf8' });
  assert.notEqual(r1.status, 0, '写外部路径应被拒绝');
  assert.ok(!fs.existsSync(denied), '外部文件不应被创建');

  const allowedFile = path.join(allowed, 'ok.txt');
  const argsOk = sandbox.buildArgs({ readDirs: [], writeDirs: [allowed], scriptArgs: ['-e', `require('fs').writeFileSync(${JSON.stringify(allowedFile)}, 'ok')`] });
  const r2 = spawnSync(process.execPath, argsOk, { encoding: 'utf8' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.readFileSync(allowedFile, 'utf8'), 'ok');
});
