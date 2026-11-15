// wave1.test.mjs —— Wave 1 A 类插件业务规则回归
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function run(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-a-wave1-${id}-`));
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'service'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scenarios', id, 'fixture.json'), path.join(dir, 'fixtures', 'data.json'));
  fs.copyFileSync(path.join(ROOT, 'scenarios', id, 'runner.js'), path.join(dir, 'service', 'runner.js'));
  const runner = require(path.join(dir, 'service', 'runner.js'));
  const saved = [];
  await runner.runJob({ jobId: `wave1-${id}` }, { params: {}, setProgress() {}, addMissing() {}, async saveFile(f) { saved.push(f); } });
  const ds = JSON.parse(saved[0].content);
  return { ds, rows: ds.pages.flatMap((p) => p.rows), kpi: Object.fromEntries((ds.extra.summary || []).map((x) => [x.k, x.v])) };
}

test('git-flow-audit：6 个 Issue 中 2 个流程通过，CI 全绿 4 个', async () => {
  const { rows, kpi } = await run('git-flow-audit');
  assert.equal(rows.length, 6);
  assert.equal(kpi['流程通过'], 2);
  assert.equal(kpi['CI 全绿'], 4);
  assert.ok(rows.some((r) => /CI 未全绿/.test(r.problems)));
  assert.ok(rows.some((r) => /commit 未关联/.test(r.problems)));
});

test('boss-candidate-score：20 人过滤后≥15，报告有排名/链接', async () => {
  const { rows, kpi } = await run('boss-candidate-score');
  assert.equal(rows.length, 20);
  assert.ok(kpi['通过'] >= 15, `通过 ${kpi['通过']}`);
  assert.ok(rows.filter((r) => r.decision === '通过').every((r) => /zhipin\.com/.test(r.link)));
  assert.ok(rows.every((r) => typeof r.score === 'number'));
});

test('product-selection-score：10 个 ASIN，下行/季节性被排除', async () => {
  const { rows, kpi } = await run('product-selection-score');
  assert.equal(rows.length, 10);
  assert.ok(kpi['排除'] >= 3);
  assert.ok(rows.filter((r) => r.trend === '下行' || r.trend === '季节性').every((r) => r.decision === '排除'));
  assert.ok(rows.every((r) => /^B0/.test(r.asin)));
});

test('ops-daily-audit：未回复 2/未发货 3/物流停滞 2/否定词 2', async () => {
  const { rows, kpi } = await run('ops-daily-audit');
  assert.equal(rows.length, 9);
  assert.equal(kpi['未回复消息'], 2);
  assert.equal(kpi['未发货订单'], 3);
  assert.equal(kpi['物流停滞'], 2);
  assert.equal(kpi['否定词候选'], 2);
});

test('supplier-quote-compare：4 家，含税运到岸价/MOQ/交期齐全', async () => {
  const { rows, kpi } = await run('supplier-quote-compare');
  assert.equal(rows.length, 4);
  assert.equal(kpi['供应商'], 4);
  assert.ok(rows.every((r) => r.landed_total > 0 && r.unit_landed > 0));
  assert.ok(rows.some((r) => r.risk === 'MOQ 高于目标量'));
});
