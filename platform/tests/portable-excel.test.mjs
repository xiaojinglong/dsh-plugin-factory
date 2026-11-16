import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markWorkbook } from '../../portable-plugins/excel-status-mark/lib/mark.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('portable excel-status-mark：标记 6 行且不改输入', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-xlsx-'));
  const input = path.join(dir, 'orders.xlsx');
  const output = path.join(dir, 'out.xlsx');
  fs.copyFileSync(path.join(ROOT, 'scenarios', 'excel-status-mark', 'orders.xlsx'), input);
  const result = await markWorkbook(input, output);
  assert.equal(result.total, 6);
  assert.equal(result.changed, 6);
  assert.ok(fs.existsSync(output));
  assert.ok(fs.statSync(output).size > 0);
});
