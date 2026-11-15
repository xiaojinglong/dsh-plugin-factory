// scenarios/selection-input.mjs —— Google Trends CSV + 选品工具 CSV → 选品趋势 fixture
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, castRecord } from './csv-adapter.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

export function parseGoogleTrends(text) {
  const cleaned = String(text).replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/);
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const first = String(lines[i].split(',')[0] || '').replace(/"/g, '').trim().toLowerCase();
    if (['month', 'week', 'day', 'date'].includes(first)) { headerIndex = i; break; }
  }
  if (headerIndex < 0) throw new Error('Google Trends CSV 找不到表头（Month/Week/Day/Date）');
  // 保留表头及其后的数据行；parseCsv 需要从表头开始
  const body = lines.slice(headerIndex).join('\n');
  const { header, rows } = parseCsv(body);
  if (header.length < 2) throw new Error('Google Trends CSV 至少需要 1 个关键词列');
  const dateKey = header[0];
  const keywords = header.slice(1);
  const dates = [];
  const series = Object.fromEntries(keywords.map((k) => [k, []]));
  for (const r of rows) {
    dates.push(r[dateKey]);
    for (const k of keywords) {
      const raw = String(r[k] ?? '').trim();
      const v = raw === '<1' ? 0.5 : Number(raw);
      series[k].push(Number.isFinite(v) ? v : 0);
    }
  }
  return { dates, series, keywords };
}

export function parseSelection(text) {
  const { rows } = parseCsv(text);
  return rows.map((r) => castRecord(r, {
    numbers: ['monthly_sales', 'price', 'reviews', 'cost', 'shipping'],
    booleans: [], arrays: [],
  }));
}

export function buildFixture(trendsText, selectionText) {
  const trends = parseGoogleTrends(trendsText);
  const rows = parseSelection(selectionText).map((r) => {
    const key = trends.keywords.find((k) => String(k).toLowerCase() === String(r.keyword).toLowerCase())
      || trends.keywords[0];
    return { ...r, trend_keyword: key, trend: trends.series[key] || [] };
  });
  return {
    keyword: trends.keywords[0] || '',
    dates: trends.dates,
    keywords: trends.keywords,
    rows,
  };
}

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (!process.argv[i].startsWith('--')) continue;
    const k = process.argv[i].slice(2);
    const v = process.argv[i + 1];
    if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
  }
  if (!args.trends || !args.selection) {
    console.error('用法：node scenarios/selection-input.mjs --trends <google-trends.csv> --selection <sellersprite.csv> [--out <json>]');
    process.exit(1);
  }
  const fixture = buildFixture(fs.readFileSync(args.trends, 'utf8'), fs.readFileSync(args.selection, 'utf8'));
  const out = args.out || path.join(ROOT, 'scenarios', 'trend-selection-audit', 'fixture.from-csv.json');
  fs.writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ok: true, keywords: fixture.keywords.length, rows: fixture.rows.length, out }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
