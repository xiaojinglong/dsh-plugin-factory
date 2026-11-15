// selection-input.test.mjs —— Google Trends CSV + 选品工具 CSV 合并
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGoogleTrends, buildFixture } from '../../scenarios/selection-input.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const trends = fs.readFileSync(path.join(ROOT, 'scenarios', 'samples', 'google-trends.csv'), 'utf8');
const selection = fs.readFileSync(path.join(ROOT, 'scenarios', 'samples', 'selection-tool.csv'), 'utf8');

test('Google Trends CSV：跳过元数据，解析 3 关键词 × 12 月', () => {
  const t = parseGoogleTrends(trends);
  assert.equal(t.keywords.length, 3);
  assert.equal(t.dates.length, 12);
  assert.equal(t.series.shopee.length, 12);
  assert.equal(t.series.shopee[0], 45);
});

test('合并：5 个 ASIN 每个都带 12 月趋势数组', () => {
  const f = buildFixture(trends, selection);
  assert.equal(f.rows.length, 5);
  assert.equal(f.keywords.length, 3);
  assert.ok(f.rows.every((r) => r.trend.length === 12));
  assert.equal(f.rows[0].trend_keyword, 'shopee');
});
