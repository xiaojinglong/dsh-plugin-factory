'use strict';

/**
 * runner.js —— fs-ledger 执行层（文件系统型：只读扫描本地 inbox 目录）
 *
 * 覆盖场景：CSV/JSON 解析、表头校验、行级规则、重复主键、坏文件与不支持类型 → ctx.addMissing、
 * 空目录（任务 done + 报告脚本 exit 2）、逐文件进度与取消。
 * 只读：不修改/删除 inbox 内任何文件。
 */

const fs = require('node:fs');
const path = require('node:path');

const INBOX = process.env.INBOX_DIR || path.join(__dirname, '..', 'inbox');

const LEVEL = { P1: 'P1', P2: 'P2', P3: 'P3' };
const RULE = {
  MISSING_SKU: { level: 'P1', label: '缺少主键 SKU' },
  DUPLICATE_SKU: { level: 'P2', label: 'SKU 重复' },
  NEGATIVE_QTY: { level: 'P2', label: '数量为负' },
  MISSING_QTY: { level: 'P2', label: '数量缺失/非法' },
  MISSING_PRICE: { level: 'P2', label: '价格缺失/非法' },
  NEGATIVE_PRICE: { level: 'P1', label: '价格为负' },
  NEGATIVE_STOCK: { level: 'P1', label: '库存为负' },
  SHORT_TITLE: { level: 'P3', label: '标题过短' },
  MISSING_COLUMN: { level: 'P1', label: '缺少必需列' },
  INVALID_JSON: { level: 'P1', label: 'JSON 解析失败' },
  UNSUPPORTED_TYPE: { level: 'P3', label: '不支持的文件类型' },
};

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const rec = { __line: i + 2 };
    header.forEach((h, j) => { rec[h] = cells[j] ?? ''; });
    return rec;
  });
  return { header, rows };
}

function addAnomaly(rows, file, rec, rule, detail, extra = {}) {
  rows.push({ file, row: rec.__line || 0, sku: rec.sku || '', rule, level: (RULE[rule] || LEVEL.P3).level, detail, ...extra });
}

async function scanCsv(ctx, file, text, anomalies) {
  const { header, rows } = parseCsv(text);
  const required = file.startsWith('orders') ? ['sku', 'title', 'qty', 'price'] : ['sku'];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) {
    anomalies.push({ file, row: 1, sku: '', rule: 'MISSING_COLUMN', level: LEVEL.P1, detail: `缺少必需列：${missing.join('、')}` });
    ctx.addMissing(file, `缺少必需列：${missing.join('、')}`);
    return { header, rows: [] };
  }
  const seen = new Map();
  for (const rec of rows) {
    if (!rec.sku) addAnomaly(anomalies, file, rec, 'MISSING_SKU', 'sku 为空');
    if (rec.qty === '' || !Number.isFinite(Number(rec.qty))) addAnomaly(anomalies, file, rec, 'MISSING_QTY', `qty=${JSON.stringify(rec.qty)}`);
    else if (Number(rec.qty) < 0) addAnomaly(anomalies, file, rec, 'NEGATIVE_QTY', `qty=${rec.qty}`);
    if (rec.price === undefined || rec.price === '' || !Number.isFinite(Number(rec.price))) addAnomaly(anomalies, file, rec, 'MISSING_PRICE', `price=${JSON.stringify(rec.price)}`);
    else if (Number(rec.price) < 0) addAnomaly(anomalies, file, rec, 'NEGATIVE_PRICE', `price=${rec.price}`);
    if (rec.title && rec.title.length < 4) addAnomaly(anomalies, file, rec, 'SHORT_TITLE', `title=${rec.title}`);
    if (rec.sku) {
      if (seen.has(rec.sku)) addAnomaly(anomalies, file, rec, 'DUPLICATE_SKU', `${rec.sku} 首次出现在第 ${seen.get(rec.sku)} 行`);
      else seen.set(rec.sku, rec.__line);
    }
  }
  return { header, rows };
}

async function scanJson(ctx, file, text, anomalies) {
  let data;
  try { data = JSON.parse(text); } catch (e) {
    anomalies.push({ file, row: 0, sku: '', rule: 'INVALID_JSON', level: LEVEL.P1, detail: `JSON 解析失败：${String(e.message).slice(0, 80)}` });
    ctx.addMissing(file, 'JSON 解析失败，已跳过');
    return { items: 0 };
  }
  const list = Array.isArray(data) ? data : [data];
  const seen = new Map();
  list.forEach((rec, i) => {
    const line = i + 1;
    if (!rec || typeof rec !== 'object') return;
    if (!rec.sku) anomalies.push({ file, row: line, sku: '', rule: 'MISSING_SKU', level: LEVEL.P1, detail: 'sku 为空' });
    if (rec.stock !== undefined && Number(rec.stock) < 0) anomalies.push({ file, row: line, sku: rec.sku || '', rule: 'NEGATIVE_STOCK', level: LEVEL.P1, detail: `stock=${rec.stock}` });
    if (rec.sku) {
      if (seen.has(rec.sku)) anomalies.push({ file, row: line, sku: rec.sku, rule: 'DUPLICATE_SKU', level: LEVEL.P2, detail: `首次出现在第 ${seen.get(rec.sku)} 条` });
      else seen.set(rec.sku, line);
    }
  });
  return { items: list.length };
}

async function runJob(job, ctx) {
  const started = Date.now();
  if (!fs.existsSync(INBOX)) throw new Error(`inbox 目录不存在：${INBOX}`);
  const files = fs.readdirSync(INBOX).filter((f) => !f.startsWith('.')).sort();
  const anomalies = [];
  const summaries = [];
  let unreadable = 0;

  for (const [i, file] of files.entries()) {
    if (ctx.isAborted()) throw new Error('任务已被终止');
    ctx.setProgress(`扫描 ${i + 1}/${files.length}：${file}`);
    const full = path.join(INBOX, file);
    const ext = path.extname(file).toLowerCase();
    let text = '';
    try { text = fs.readFileSync(full, 'utf8'); } catch (e) {
      unreadable += 1;
      ctx.addMissing(file, `读取失败：${e.message}`);
      summaries.push({ file, type: ext, rows: 0, anomalies: 0, status: 'unreadable' });
      continue;
    }
    let result;
    if (ext === '.csv') result = await scanCsv(ctx, file, text, anomalies);
    else if (ext === '.json') result = await scanJson(ctx, file, text, anomalies);
    else {
      unreadable += 1;
      anomalies.push({ file, row: 0, sku: '', rule: 'UNSUPPORTED_TYPE', level: LEVEL.P3, detail: `不支持的类型 ${ext || '(无扩展名)'}，已跳过` });
      ctx.addMissing(file, `不支持的文件类型 ${ext || '(无扩展名)'}`);
      summaries.push({ file, type: ext, rows: 0, anomalies: 1, status: 'skipped' });
      continue;
    }
    const fileAnomalies = anomalies.filter((a) => a.file === file).length;
    summaries.push({ file, type: ext, rows: result.rows ? result.rows.length : (result.items || 0), anomalies: fileAnomalies, status: 'read' });
  }

  const byRule = {};
  for (const a of anomalies) byRule[a.rule] = (byRule[a.rule] || 0) + 1;
  const dataset = {
    task: 'fs_ledger',
    fetchedAt: new Date().toISOString(),
    params: { inbox: INBOX },
    extra: {
      inbox: INBOX, fileCount: files.length, unreadable,
      anomalyCount: anomalies.length, byRule, files: summaries,
      elapsedMs: Date.now() - started,
    },
    total: anomalies.length,
    totalPages: '-',
    pages: [{ page: 1, rows: anomalies }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'fs_ledger_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：${files.length} 个文件，异常 ${anomalies.length} 条，缺失/不可读 ${unreadable} 个`);
}

module.exports = { runJob, INBOX, RULE };
