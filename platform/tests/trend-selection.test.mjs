// trend-selection.test.mjs —— 趋势+选品评分
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('trend-selection-audit：3 推荐 / 2 排除', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-trend-'));
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'service'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scenarios', 'trend-selection-audit', 'fixture.json'), path.join(dir, 'fixtures', 'data.json'));
  fs.copyFileSync(path.join(ROOT, 'scenarios', 'trend-selection-audit', 'runner.js'), path.join(dir, 'service', 'runner.js'));
  const runner = require(path.join(dir, 'service', 'runner.js'));
  const saved = [];
  await runner.runJob({ jobId: 'trend-test' }, { params: {}, setProgress() {}, addMissing() {}, async saveFile(f) { saved.push(f); } });
  const ds = JSON.parse(saved[0].content);
  const rows = ds.pages.flatMap((p) => p.rows);
  const kpi = Object.fromEntries(ds.extra.summary.map((x) => [x.k, x.v]));
  assert.equal(rows.length, 5);
  assert.equal(kpi['推荐'], 3);
  assert.equal(kpi['排除'], 2);
  assert.ok(rows.filter((r) => r.trend === '下行' || r.trend === '季节性').every((r) => r.decision === '排除'));
});
