// scenarios/api-adapter.mjs —— 分页 API → 场景 fixture JSON（本地/真实均可用）
// 用法：node scenarios/api-adapter.mjs --scenario xborder-restock --url http://127.0.0.1:9000 --path /api/rows --out fixture.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { castRecord } from './csv-adapter.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pick(obj, dotted) {
  return String(dotted || '').split('.').filter(Boolean).reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

export async function fetchPaged(opts) {
  const base = String(opts.baseUrl || '').replace(/\/+$/, '');
  const endpoint = String(opts.path || '/').startsWith('/') ? opts.path : `/${opts.path}`;
  const pageParam = opts.pageParam || 'page';
  const sizeParam = opts.pageSizeParam || 'per_page';
  const pageSize = Math.max(1, Number(opts.pageSize) || 100);
  const maxPages = Math.max(1, Number(opts.maxPages) || 50);
  const itemsPath = opts.itemsPath || 'rows';
  const retries = Math.max(0, Number(opts.retries) || 3);
  const token = opts.token || '';
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(base + endpoint);
    url.searchParams.set(pageParam, String(page));
    url.searchParams.set(sizeParam, String(pageSize));
    let res; let lastErr;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
        if (res.ok) break;
        if (res.status === 429 || res.status >= 500) { lastErr = new Error(`HTTP ${res.status}`); await sleep(150 * 2 ** attempt); continue; }
        throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      } catch (err) {
        lastErr = err;
        if (attempt >= retries) throw err;
        await sleep(150 * 2 ** attempt);
      }
    }
    if (!res || !res.ok) throw lastErr || new Error('请求失败');
    const body = await res.json();
    const items = Array.isArray(body) ? body : pick(body, itemsPath);
    if (!Array.isArray(items)) throw new Error(`响应缺少数组 ${itemsPath}`);
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
}

export function normalizeItems(scenario, items) {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenarios', scenario, 'csv-map.json'), 'utf8'));
  const list = items.map((r) => castRecord(r, map));
  if (scenario === 'hr-resume-screen') {
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenarios', scenario, 'fixture.json'), 'utf8'));
    return { job: fixture.job, candidates: list };
  }
  return { [map.list || 'rows']: list };
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (!process.argv[i].startsWith('--')) continue;
    const k = process.argv[i].slice(2);
    const v = process.argv[i + 1];
    if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
  }
  if (!args.scenario || !args.url) {
    console.error('用法：node scenarios/api-adapter.mjs --scenario <id> --url <base> --path </api> [--out <json>]');
    process.exit(1);
  }
  const token = args['token-env'] ? process.env[args['token-env']] : '';
  const items = await fetchPaged({
    baseUrl: args.url, path: args.path || '/', token,
    pageParam: args['page-param'], pageSizeParam: args['page-size-param'],
    pageSize: Number(args['page-size']) || undefined, maxPages: Number(args['max-pages']) || undefined,
    itemsPath: args['items-path'], retries: Number(args.retries) || undefined,
  });
  const out = args.out || path.join(ROOT, 'scenarios', args.scenario, 'fixture.from-api.json');
  fs.writeFileSync(out, JSON.stringify(normalizeItems(args.scenario, items), null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ok: true, scenario: args.scenario, rows: items.length, out }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
