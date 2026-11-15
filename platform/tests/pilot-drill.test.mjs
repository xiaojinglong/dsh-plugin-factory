// pilot-drill.test.mjs —— M6 试点演练（临时数据根）
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runPilotDrill } = require('../../scripts/pilot-drill.cjs');

test('pilot-drill：需求单→staging→accept→备份→恢复→巡检全绿', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-drill-test-'));
  const r = await runPilotDrill({ root });
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.ok(r.requestId.startsWith('req_'));
  assert.ok(r.checks.every((c) => c.ok));
  const report = JSON.parse(fs.readFileSync(path.join(root, 'pilot-drill.json'), 'utf8'));
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((c) => c.name === 'restored-request' && c.ok));
});
