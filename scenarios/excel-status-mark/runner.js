'use strict';
// excel-status-mark —— 动作型插件：读取订单 Excel，生成“已标记”新文件 + 变更审计
// 原文件不覆盖；输出新 xlsx 与 diff 记录。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function findRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'platform', 'factory', 'bootstrap.js'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.env.FACTORY_ROOT || path.resolve(start, '..', '..', '..', '..');
}
const FACTORY_ROOT = process.env.FACTORY_ROOT || findRoot(__dirname);
const ExcelJS = require(path.join(FACTORY_ROOT, 'node_modules', 'exceljs'));

function mark(amount) {
  if (!Number.isFinite(amount)) return '异常-待核对';
  if (amount <= 0) return '异常-待核对';
  if (amount >= 100) return '高额-已标记';
  return '正常';
}

async function runJob(job, ctx) {
  const src = path.join(__dirname, '..', 'fixtures', 'data.json');
  if (!fs.existsSync(src)) throw new Error(`Excel fixture 不存在：${src}`);
  ctx.setProgress('读取 Excel');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(src);
  const ws = wb.getWorksheet('Orders') || wb.worksheets[0];
  if (!ws) throw new Error('Excel 没有工作表');

  const header = ws.getRow(1).values.filter(Boolean).map(String);
  const col = (name) => header.indexOf(name) + 1;
  const idCol = col('order_id');
  const amountCol = col('amount');
  const statusCol = col('status');
  if (!idCol || !amountCol || !statusCol) throw new Error(`Excel 需要 order_id/amount/status 列，实际：${header.join(',')}`);

  const changed = [];
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = String(row.getCell(idCol).value ?? '');
    if (!id) return;
    const amount = Number(row.getCell(amountCol).value);
    const before = String(row.getCell(statusCol).value ?? '');
    const after = mark(amount);
    rows.push({ order_id: id, amount, before, after });
    if (before !== after) {
      row.getCell(statusCol).value = after;
      changed.push({ order_id: id, amount, before, after });
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  await ctx.saveFile({ kind: 'file', fileName: 'orders-marked.xlsx', content: Buffer.from(buf).toString('base64'), encoding: 'base64' });

  const dataset = {
    task: job.task || 'excel_status_mark',
    fetchedAt: new Date().toISOString(),
    effect: 'file',
    outputs: ['dataset', 'file', 'audit'],
    params: ctx.params || {},
    source: src,
    output_file: 'orders-marked.xlsx',
    extra: {
      title: 'Excel 状态标记',
      columns: ['order_id', 'amount', 'before', 'after'],
      labels: { order_id: '订单号', amount: '金额', before: '原状态', after: '新状态' },
      summary: [
        { k: '数据行', v: rows.length, s: '读取' },
        { k: '变更', v: changed.length, s: '写入新文件' },
        { k: '未变更', v: rows.length - changed.length, s: '保持' },
        { k: '原文件', v: '未修改', s: '只读' },
      ],
      conclusion: `读取 ${rows.length} 行，标记 ${changed.length} 行，输出 orders-marked.xlsx；原文件未修改。`,
      recommendations: ['下载新文件后人工复核再替换原表。', '高额/异常状态可接后续 API 动作。'],
    },
    total: rows.length,
    totalPages: 1,
    pages: [{ page: 1, rows: changed }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'excel_status_mark_audit.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：${rows.length} 行，变更 ${changed.length} 行`);
}
module.exports = { runJob };
