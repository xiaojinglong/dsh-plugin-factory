// scenarios/csv-adapter.mjs —— 真实 CSV 导出 → 场景 fixture JSON
// 用法：node scenarios/csv-adapter.mjs --scenario xborder-restock --input export.csv --out fixture.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

export function parseCsv(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  if (!clean.length) return { header: [], rows: [] };
  const header = clean[0].map((h) => h.trim());
  const list = clean.slice(1).map((cells) => {
    const rec = {};
    header.forEach((h, i) => { rec[h] = cells[i] ?? ''; });
    return rec;
  });
  return { header, rows: list };
}

function cast(rec, map) {
  const out = {};
  for (const [k, raw] of Object.entries(rec)) {
    let v = raw;
    if ((map.numbers || []).includes(k)) v = raw === '' ? 0 : Number(raw);
    else if ((map.booleans || []).includes(k)) v = /^(true|1|yes|y|是)$/i.test(String(raw).trim());
    else if ((map.arrays || []).includes(k)) v = String(raw).split(/[;|]/).map((x) => x.trim()).filter(Boolean);
    out[k] = v;
  }
  return out;
}

export function convertCsv(scenario, csvText, opts = {}) {
  const dir = path.join(ROOT, 'scenarios', scenario);
  const mapFile = path.join(dir, 'csv-map.json');
  if (!fs.existsSync(mapFile)) throw new Error(`缺少 csv-map.json：${scenario}`);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const parsed = parseCsv(csvText);
  if (!parsed.rows.length) throw new Error('CSV 没有数据行');
  const list = parsed.rows.map((r) => cast(r, map));
  if (scenario === 'hr-resume-screen') {
    let job = opts.job;
    if (!job) {
      const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
      job = fixture.job;
    }
    return { job, candidates: list };
  }
  return { [map.list || 'rows']: list };
}

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (!process.argv[i].startsWith('--')) continue;
    const k = process.argv[i].slice(2);
    const v = process.argv[i + 1];
    if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
  }
  if (!args.scenario || !args.input) {
    console.error('用法：node scenarios/csv-adapter.mjs --scenario <id> --input <csv> [--out <json>]');
    process.exit(1);
  }
  const out = args.out || path.join(ROOT, 'scenarios', args.scenario, 'fixture.from-csv.json');
  const converted = convertCsv(args.scenario, fs.readFileSync(args.input, 'utf8'), {
    job: args.job ? JSON.parse(fs.readFileSync(args.job, 'utf8')) : undefined,
  });
  fs.writeFileSync(out, JSON.stringify(converted, null, 2) + '\n', 'utf8');
  const n = converted.candidates?.length ?? converted.rows?.length ?? 0;
  console.log(JSON.stringify({ ok: true, scenario: args.scenario, rows: n, out }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
