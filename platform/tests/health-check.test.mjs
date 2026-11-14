// health-check.test.mjs —— M6 健康/容量巡检
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createControlPlane } = require('../../apps/control-plane/server.cjs');
const { checkHealth } = require('../../scripts/health-check.cjs');

test('health-check：健康/容量阈值可判定', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-hc-'));
  const token = 'hc-token';
  const cp = createControlPlane({ dataRoot, token });
  const { port } = await cp.start({ port: 0 });
  const url = `http://127.0.0.1:${port}`;
  try {
    await fetch(`${url}/requests`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ brief: '巡检' }),
    });
    const ok = await checkHealth({ url, token, thresholds: { maxAudit: 1000, maxDbBytes: 100 * 1024 * 1024, maxFailed: 10 } });
    assert.equal(ok.ok, true, JSON.stringify(ok.checks));
    assert.ok(ok.metrics.dbSizeBytes > 0);
    assert.ok(ok.checks.some((c) => c.name === 'audit-count' && c.ok));

    const bad = await checkHealth({ url, token, thresholds: { maxAudit: 0 } });
    assert.equal(bad.ok, false);
    assert.ok(bad.checks.some((c) => c.name === 'audit-count' && !c.ok));

    let alertBody = null;
    const hook = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => { alertBody = JSON.parse(data); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
    });
    await new Promise((r) => hook.listen(0, '127.0.0.1', r));
    try {
      const alerted = await checkHealth({ url, token, thresholds: { maxAudit: 0 }, webhook: `http://127.0.0.1:${hook.address().port}/hook` });
      assert.equal(alerted.ok, false);
      assert.equal(alerted.alert.ok, true);
      assert.match(alertBody.text, /巡检失败/);
    } finally {
      await new Promise((r) => hook.close(r));
    }
  } finally {
    await cp.stop();
  }
});
