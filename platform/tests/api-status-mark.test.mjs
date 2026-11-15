// api-status-mark.test.mjs —— 动作型插件：dry_run/confirm_write/API 调用/回执
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function load() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-api-'));
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'service'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scenarios', 'api-status-mark', 'fixture.json'), path.join(dir, 'fixtures', 'data.json'));
  fs.copyFileSync(path.join(ROOT, 'scenarios', 'api-status-mark', 'runner.js'), path.join(dir, 'service', 'runner.js'));
  return { dir, runner: require(path.join(dir, 'service', 'runner.js')) };
}
function ctx(saved) {
  return { params: {}, setProgress() {}, addMissing() {}, async saveFile(f) { saved.push(f); } };
}

test('api-status-mark：dry_run 不调用 API，confirm_write 逐条更新', async () => {
  const { runner } = load();
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const target = `http://127.0.0.1:${server.address().port}`;
  try {
    let saved = [];
    const c1 = ctx(saved);
    c1.params = { dry_run: true };
    await runner.runJob({ jobId: 'dry' }, c1);
    const dry = JSON.parse(saved.find((f) => f.kind === 'main').content);
    assert.equal(dry.pages[0].rows.length, 4);
    assert.equal(calls, 0, 'dry_run 不应调用 API');

    saved = [];
    const c2 = ctx(saved);
    c2.params = { confirm_write: true, target_url: target, idempotency_key: 'test-key' };
    await runner.runJob({ jobId: 'real' }, c2);
    const real = JSON.parse(saved.find((f) => f.kind === 'main').content);
    assert.equal(real.pages[0].rows.length, 4);
    assert.equal(calls, 4);
    const receipt = JSON.parse(saved.find((f) => f.kind === 'receipt').content);
    assert.equal(receipt.updated, 4);
    assert.equal(receipt.confirmWrite, true);
  } finally { server.close(); }
});

test('api-status-mark：没有 confirm_write 拒绝执行', async () => {
  const { runner } = load();
  await assert.rejects(() => runner.runJob({ jobId: 'no' }, ctx([])), /confirm_write/);
});
