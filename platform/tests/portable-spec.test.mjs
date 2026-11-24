import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { generatePortable, validatePortable } = require(path.join(ROOT, 'apps', 'generator', 'portable.cjs'));
const { cleanEnv } = require(path.join(ROOT, 'apps', 'generator', 'sandbox.cjs'));

test('portable spec：多文件 + 权限 + 测试通过', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-spec-')), 'sum-demo');
  generatePortable({
    id: 'sum-demo', name: 'Sum Demo', out,
    spec: {
      description: 'Sum values from a JSON fixture.',
      effect: 'read',
      permissions: { filesystem: ['read'], network: [] },
      tools: [{ name: 'sum_demo', description: 'Sum values.', parameters: { input_path: { type: 'string', required: false } } }],
      acceptance: ['returns total'],
    },
    files: [
      { path: 'lib/impl.js', content: "import fs from 'node:fs'\nimport path from 'node:path'\nimport { fileURLToPath } from 'node:url'\nconst F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data.json')\nexport async function execute(args = {}) {\n  const d = JSON.parse(fs.readFileSync(args.input_path || F, 'utf8'))\n  const rows = Array.isArray(d) ? d : d.rows\n  return { total: rows.reduce((s, r) => s + Number(r.value || 0), 0) }\n}\n" },
      { path: 'tests/impl.test.mjs', content: "import test from 'node:test'\nimport assert from 'node:assert'\nimport { execute } from '../lib/impl.js'\ntest('sum', async () => { const r = await execute({}); assert.equal(r.total, 30) })\n" },
    ],
  });
  const v = await validatePortable(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.ok(v.checks.some((c) => c.n === 'tests:node' && c.ok));
});

test('portable spec：拒绝越界文件路径', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-spec-bad-')), 'bad');
  assert.throws(() => generatePortable({
    id: 'bad-demo', name: 'Bad', out,
    spec: { tools: [{ name: 'bad_demo' }] },
    files: [{ path: '../escape.js', content: '' }],
  }), /非法文件路径/);
});

test('portable spec：拒绝明文密钥和非法网络权限', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-security-'));
  const secretOut = path.join(root, 'secret-demo');
  generatePortable({
    id: 'secret-demo', name: 'Secret Demo', out: secretOut,
    spec: { description: 'Secret demo.', permissions: { filesystem: [], network: [] }, tools: [{ name: 'secret_demo' }] },
    files: [{ path: 'lib/impl.js', content: "const token = 'sk-123456789012345678901234'\nexport async function execute() { return { token } }\n" }],
  });
  const secretCheck = await validatePortable(secretOut);
  assert.equal(secretCheck.ok, false);
  assert.ok(secretCheck.errors.some((e) => /no-secret-literal/.test(e)));

  const netOut = path.join(root, 'net-demo');
  generatePortable({
    id: 'net-demo', name: 'Net Demo', out: netOut,
    spec: { description: 'Net demo.', permissions: { filesystem: [], network: ['https://example.com/path'] }, tools: [{ name: 'net_demo' }] },
  });
  const netCheck = await validatePortable(netOut);
  assert.equal(netCheck.ok, false);
  assert.ok(netCheck.errors.some((e) => /permission:network-format/.test(e)));
});

test('portable spec：多工具 handlers', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-multi-')), 'multi-demo');
  generatePortable({
    id: 'multi-demo', name: 'Multi Demo', out,
    spec: {
      description: 'Multi tool demo.',
      permissions: { filesystem: ['read'], network: [] },
      tools: [
        { name: 'sum_values', handler: 'sum', description: 'Sum values.', parameters: {} },
        { name: 'count_values', handler: 'count', description: 'Count values.', parameters: {} },
      ],
      acceptance: ['two tools'],
    },
    files: [
      { path: 'lib/handlers.js', content: "export const handlers = { async sum() { return { total: 30 } }, async count() { return { total: 2 } } }\n" },
      { path: 'tests/handlers.test.mjs', content: "import test from 'node:test'\nimport assert from 'node:assert'\nimport { handlers } from '../lib/handlers.js'\ntest('handlers', async () => { assert.equal((await handlers.sum()).total, 30); assert.equal((await handlers.count()).total, 2) })\n" },
    ],
  });
  const v = await validatePortable(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const index = fs.readFileSync(path.join(out, 'index.js'), 'utf8');
  assert.match(index, /runTool\(\{ handler: "sum"/);
  assert.match(index, /name: "count_values"/);
});

test('portable spec：环境契约缺失时校验失败', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-req-')), 'req-demo');
  generatePortable({
    id: 'req-demo', name: 'Req Demo', out,
    spec: {
      permissions: { filesystem: [], network: [] },
      requires: { platform: process.platform, apps: [{ name: 'NoSuchApp', paths: ['C:/definitely-not-installed/app.exe'], required: true }] },
      tools: [{ name: 'req_demo' }],
    },
  });
  const v = await validatePortable(out);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /requires:app:NoSuchApp/.test(e)));
});

test('portable spec：file 连接器注入并通过校验', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-conn-')), 'conn-demo');
  generatePortable({
    id: 'conn-demo', name: 'Conn Demo', out,
    spec: { permissions: { filesystem: ['read'], network: [] }, connectors: ['file'], tools: [{ name: 'conn_demo' }] },
    files: [{ path: 'lib/impl.js', content: "import { readJson } from '../lib/connectors/file.js'\nexport async function execute(args = {}) { return readJson(args.path) }\n" }],
  });
  assert.ok(fs.existsSync(path.join(out, 'lib', 'connectors', 'file.js')));
  const v = await validatePortable(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('portable spec：desktop 录制注入插件', { skip: process.platform !== 'win32' ? 'desktop 录制仅支持 win32' : false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-rec-'));
  const rec = path.join(dir, 'rec.json');
  fs.writeFileSync(rec, JSON.stringify({ name: 'demo', durationMs: 100, events: [{ t: 0, type: 'mouse_move', x: 1, y: 2 }] }), 'utf8');
  const out = path.join(dir, 'rec-demo');
  generatePortable({
    id: 'rec-demo', name: 'Rec Demo', out, recording: rec,
    spec: {
      permissions: { filesystem: ['read'], network: [], process: true },
      requires: { platform: 'win32', desktop: true },
      connectors: ['desktop'],
      tools: [{ name: 'rec_demo' }],
    },
  });
  assert.ok(fs.existsSync(path.join(out, 'recordings', 'flow.json')));
  assert.ok(fs.existsSync(path.join(out, 'lib', 'connectors', 'desktop-replay.ps1')));
  const v = await validatePortable(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('portable spec：desktop 连接器要求 process 权限', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-conn-bad-')), 'conn-bad');
  assert.throws(() => generatePortable({
    id: 'conn-bad', name: 'Conn Bad', out,
    spec: { permissions: { filesystem: [], network: [] }, connectors: ['desktop'], tools: [{ name: 'conn_bad' }] },
  }), /desktop 连接器需要/);
});

test('portable spec：拒绝未白名单依赖', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-deps-')), 'dep-demo');
  assert.throws(() => generatePortable({
    id: 'dep-demo', name: 'Dep', out,
    spec: { tools: [{ name: 'dep_demo' }], dependencies: { 'left-pad': '1.3.0' } },
  }), /白名单/);
});

test('portable sandbox：用户代码在受限子进程执行', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-sandbox-')), 'sandbox-demo');
  generatePortable({
    id: 'sandbox-demo', name: 'Sandbox Demo', out,
    spec: { description: 'Sandbox demo.', permissions: { filesystem: ['read'], network: [] }, tools: [{ name: 'sandbox_demo' }] },
    files: [{ path: 'lib/impl.js', content: "import fs from 'node:fs'\nimport path from 'node:path'\nimport { fileURLToPath } from 'node:url'\nconst F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data.json')\nexport async function execute() { const d = JSON.parse(fs.readFileSync(F, 'utf8')); return { total: d.rows.length } }\n" }],
  });
  const mod = await import(`${pathToFileURL(path.join(out, 'lib', 'sandbox.js')).href}?t=${Date.now()}`);
  const result = await mod.runTool({ args: {} });
  assert.equal(result.total, 2);
});

test('portable sandbox：写新父目录不被误拒', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-write-'));
  const out = path.join(root, 'write-demo');
  generatePortable({
    id: 'write-demo', name: 'Write Demo', out,
    spec: { description: 'Write demo.', permissions: { filesystem: ['write'], network: [] }, tools: [{ name: 'write_demo' }] },
    files: [{ path: 'lib/impl.js', content: "import fs from 'node:fs'\nimport path from 'node:path'\nexport async function execute(args = {}) { const f = path.join(args.output_path, 'nested', 'out.txt'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'ok'); return { file: f } }\n" }],
  });
  const target = path.join(root, 'new-parent', 'result');
  const mod = await import(`${pathToFileURL(path.join(out, 'lib', 'sandbox.js')).href}?t=${Date.now()}`);
  const result = await mod.runTool({ args: { output_path: target } });
  assert.equal(fs.readFileSync(result.file, 'utf8'), 'ok');
});

test('legacy sandbox：清理 NODE_OPTIONS/DEBUG', () => {
  const env = cleanEnv({ NODE_OPTIONS: '--require=x', NODE_REPL_EXTERNAL_MODULE: 'x', DEBUG: '*', KEEP: '1' });
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NODE_REPL_EXTERNAL_MODULE, undefined);
  assert.equal(env.DEBUG, undefined);
  assert.equal(env.KEEP, '1');
});

test('portable sandbox：未声明 read 时不能读外部绝对路径', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-read-deny-'));
  const out = path.join(root, 'read-deny');
  generatePortable({
    id: 'read-deny', name: 'Read Deny', out,
    spec: { description: 'Read deny demo.', permissions: { filesystem: [], network: [] }, tools: [{ name: 'read_deny' }] },
    files: [{ path: 'lib/impl.js', content: "import fs from 'node:fs'\nexport async function execute(args = {}) { return { data: fs.readFileSync(args.input_path, 'utf8') } }\n" }],
  });
  const input = process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/hosts';
  const mod = await import(`${pathToFileURL(path.join(out, 'lib', 'sandbox.js')).href}?t=${Date.now()}`);
  await assert.rejects(() => mod.runTool({ args: { input_path: input } }), /sandbox|permission|EACCES|ERR_ACCESS_DENIED/i);
});

test('portable sandbox：输出文件已存在时仍可覆盖', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-overwrite-'));
  const out = path.join(root, 'overwrite-demo');
  generatePortable({
    id: 'overwrite-demo', name: 'Overwrite Demo', out,
    spec: { description: 'Overwrite demo.', permissions: { filesystem: ['write'], network: [] }, tools: [{ name: 'overwrite_demo' }] },
    files: [{ path: 'lib/impl.js', content: "import fs from 'node:fs'\nexport async function execute(args = {}) { fs.writeFileSync(args.output_path, 'new'); return { ok: true } }\n" }],
  });
  const target = path.join(root, 'existing', 'out.txt');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'old');
  const mod = await import(`${pathToFileURL(path.join(out, 'lib', 'sandbox.js')).href}?t=${Date.now()}`);
  const result = await mod.runTool({ args: { output_path: target } });
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'new');
});

test('portable sandbox：越界读取被拒绝', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-sandbox-deny-')), 'sandbox-deny');
  generatePortable({
    id: 'sandbox-deny', name: 'Sandbox Deny', out,
    spec: { description: 'Deny demo.', permissions: { filesystem: ['read'], network: [] }, tools: [{ name: 'sandbox_deny' }] },
    files: [{ path: 'lib/impl.js', content: "import fs from 'node:fs'\nexport async function execute() { const p = process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/shadow'; return { data: fs.readFileSync(p, 'utf8') } }\n" }],
  });
  const mod = await import(`${pathToFileURL(path.join(out, 'lib', 'sandbox.js')).href}?t=${Date.now()}`);
  await assert.rejects(() => mod.runTool({ args: {} }), /sandbox|permission|EACCES|ERR_ACCESS_DENIED/i);
});

test('portable sandbox：只注入声明凭证', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-cred-')), 'cred-demo');
  generatePortable({
    id: 'cred-demo', name: 'Cred Demo', out,
    spec: {
      description: 'Credential demo.', permissions: { filesystem: [], network: [] },
      credentials: [{ env: 'DSH_TEST_KEY', required: true }],
      tools: [{ name: 'cred_demo' }],
    },
    files: [{ path: 'lib/impl.js', content: "export async function execute() { return { key: process.env.DSH_TEST_KEY || null } }\n" }],
  });
  const mod = await import(`${pathToFileURL(path.join(out, 'lib', 'sandbox.js')).href}?t=${Date.now()}`);
  process.env.DSH_TEST_KEY = 'secret-value';
  assert.equal((await mod.runTool({ args: {} })).key, 'secret-value');
  delete process.env.DSH_TEST_KEY;
  await assert.rejects(() => mod.runTool({ args: {} }), /缺少凭证/);
});

test('portable sandbox：未声明网络被拦截', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-net-deny-')), 'net-deny');
  generatePortable({
    id: 'net-deny', name: 'Net Deny', out,
    spec: { description: 'Net deny.', permissions: { filesystem: [], network: [] }, tools: [{ name: 'net_deny' }] },
    files: [{ path: 'lib/impl.js', content: "export async function execute() { return { ok: await fetch('http://127.0.0.1:9').then(() => true).catch(() => false) } }\n" }],
  });
  const mod = await import(`${pathToFileURL(path.join(out, 'lib', 'sandbox.js')).href}?t=${Date.now()}`);
  await assert.rejects(() => mod.runTool({ args: {} }), /network blocked/i);
});

test('portable sandbox：允许声明的网络目标', async () => {
  const http = await import('node:http');
  const server = http.createServer((req, res) => res.end('allowed'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-net-ok-')), 'net-ok');
  generatePortable({
    id: 'net-ok', name: 'Net OK', out,
    spec: { description: 'Net ok.', permissions: { filesystem: [], network: ['127.0.0.1'] }, tools: [{ name: 'net_ok' }] },
    files: [{ path: 'lib/impl.js', content: "export async function execute(args) { return { text: await (await fetch(args.url)).text() } }\n" }],
  });
  try {
    const mod = await import(`${pathToFileURL(path.join(out, 'lib', 'sandbox.js')).href}?t=${Date.now()}`);
    const result = await mod.runTool({ args: { url: `http://127.0.0.1:${port}/` } });
    assert.equal(result.text, 'allowed');
  } finally {
    server.close();
  }
});
