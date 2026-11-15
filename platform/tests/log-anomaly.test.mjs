// log-anomaly.test.mjs —— 流式日志审计：10 行、1 坏行、4 异常、只留样本
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('log-anomaly-audit：流式读取 + 坏行跳过 + 异常样本上限', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-log-'));
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'service'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scenarios', 'log-anomaly-audit', 'fixture.ndjson'), path.join(dir, 'fixtures', 'data.json'));
  fs.copyFileSync(path.join(ROOT, 'scenarios', 'log-anomaly-audit', 'runner.js'), path.join(dir, 'service', 'runner.js'));
  const runner = require(path.join(dir, 'service', 'runner.js'));
  const saved = [];
  await runner.runJob({ jobId: 'log-test', task: 'log_anomaly_audit' }, {
    params: { max_anomalies: 3 }, setProgress() {}, addMissing() {}, async saveFile(f) { saved.push(f); },
  });
  const ds = JSON.parse(saved[0].content);
  const rows = ds.pages.flatMap((p) => p.rows);
  assert.equal(ds.total, 10);
  assert.equal(rows.length, 3, 'max_anomalies 上限生效');
  assert.ok(rows.every((r) => r.status >= 500 || r.latency_ms >= 1000 || /error|fatal/i.test(r.level)));
  const summary = Object.fromEntries(ds.extra.summary.map((x) => [x.k, x.v]));
  assert.equal(summary['坏行'], 1);
  assert.equal(summary['异常日志'], 4);
});
