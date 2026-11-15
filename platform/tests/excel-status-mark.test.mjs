// excel-status-mark.test.mjs —— 动作型插件：Excel 生成新文件 + 变更审计
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.FACTORY_ROOT = ROOT;

test('excel-status-mark：6 行全部标记，输出新文件，原文件不动', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-xlsx-'));
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'service'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scenarios', 'excel-status-mark', 'orders.xlsx'), path.join(dir, 'fixtures', 'data.json'));
  fs.copyFileSync(path.join(ROOT, 'scenarios', 'excel-status-mark', 'runner.js'), path.join(dir, 'service', 'runner.js'));
  const runner = require(path.join(dir, 'service', 'runner.js'));
  const saved = [];
  await runner.runJob({ jobId: 'xlsx-test' }, {
    params: {}, setProgress() {}, addMissing() {},
    async saveFile(f) { saved.push(f); if (f.content && f.encoding === 'base64') fs.writeFileSync(path.join(dir, f.fileName), Buffer.from(f.content, 'base64')); },
  });
  const main = saved.find((f) => f.kind === 'main');
  const file = saved.find((f) => f.kind === 'file');
  assert.ok(main && file);
  const ds = JSON.parse(main.content);
  assert.equal(ds.total, 6);
  assert.equal(ds.pages[0].rows.length, 6);
  assert.equal(ds.output_file, 'orders-marked.xlsx');
  assert.ok(fs.existsSync(path.join(dir, 'orders-marked.xlsx')));

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, 'orders-marked.xlsx'));
  const ws = wb.getWorksheet('Orders');
  assert.equal(ws.getCell('D2').value, '高额-已标记');
  assert.equal(ws.getCell('D4').value, '异常-待核对');

  // 输入 fixture 未被覆盖
  const orig = new ExcelJS.Workbook();
  await orig.xlsx.readFile(path.join(dir, 'fixtures', 'data.json'));
  assert.equal(orig.getWorksheet('Orders').getCell('D2').value ?? '', '');
});
