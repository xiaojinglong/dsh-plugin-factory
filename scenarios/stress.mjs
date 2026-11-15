// scenarios/stress.mjs —— 大数据量 + 并发压测（不修改已安装插件）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const IDS = ['hr-resume-screen', 'xborder-restock', 'admin-asset-audit', 'cs-ticket-triage', 'dev-repo-audit', 'seo-content-preflight', 'opt-keyword-gap', 'promo-channel-roi', 'assistant-account-audit'];
const UNIQUE = {
  'hr-resume-screen': ['candidates', 'name'],
  'xborder-restock': ['rows', 'sku'],
  'admin-asset-audit': ['rows', 'asset_id'],
  'cs-ticket-triage': ['rows', 'ticket_id'],
  'dev-repo-audit': ['rows', 'path'],
  'seo-content-preflight': ['rows', 'url'],
  'opt-keyword-gap': ['rows', 'keyword'],
  'promo-channel-roi': ['rows', 'channel'],
  'assistant-account-audit': ['rows', 'account'],
};

function scale(id, data, n) {
  const [field, key] = UNIQUE[id];
  const base = data[field] || [];
  const list = Array.from({ length: n }, (_, i) => {
    const src = base[i % base.length];
    return { ...src, [key]: `${src[key]}-${i + 1}` };
  });
  return { ...data, [field]: list };
}

function runOne(id, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-a-stress-${id}-`));
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'service'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixtures', 'data.json'), JSON.stringify(data), 'utf8');
  fs.copyFileSync(path.join(ROOT, 'scenarios', id, 'runner.js'), path.join(dir, 'service', 'runner.js'));
  const runner = require(path.join(dir, 'service', 'runner.js'));
  const saved = [];
  const ctx = { params: {}, setProgress() {}, addMissing() {}, async saveFile(f) { saved.push(f); } };
  return runner.runJob({ jobId: `stress-${id}` }, ctx).then(() => {
    const ds = JSON.parse(saved[0].content);
    return (ds.pages || []).flatMap((p) => p.rows || []).length;
  });
}

const results = [];
for (const id of IDS) {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenarios', id, 'fixture.json'), 'utf8'));
  for (const n of [1000, 5000, 50000]) {
    const data = scale(id, base, n);
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const rows = await runOne(id, data);
    const ms = Math.round(performance.now() - t0);
    const heapMb = Math.round((process.memoryUsage().heapUsed - before) / 1048576);
    results.push({ id, rows, ms, heapMb });
    console.log(`${id} rows=${rows} ms=${ms} heap+${heapMb}MB`);
  }
}
fs.writeFileSync(path.join(ROOT, 'scenarios', 'stress-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');

// 并发：对已安装服务同时提交 5 个任务
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const concurrency = [];
for (const id of ['hr-resume-screen', 'xborder-restock', 'promo-channel-roi', 'assistant-account-audit']) {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifests', `${id}.json`), 'utf8'));
  const port = m.port; const auth = { Authorization: `Bearer ${m.runtime.serviceToken}`, 'Content-Type': 'application/json' };
  const t0 = performance.now();
  const subs = await Promise.all(Array.from({ length: 20 }, () => fetch(`http://127.0.0.1:${port}/jobs`, { method: 'POST', headers: auth, body: JSON.stringify({ params: {} }) }).then((r) => r.json())));
  let done = 0; let failed = 0;
  for (const s of subs) {
    let st = null;
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      st = await fetch(`http://127.0.0.1:${port}/jobs/${s.jobId}`, { headers: auth }).then((r) => r.json());
      if (['done', 'failed', 'cancelled'].includes(st.status)) break;
    }
    if (st?.status === 'done') done += 1; else failed += 1;
  }
  const ms = Math.round(performance.now() - t0);
  concurrency.push({ id, jobs: 20, done, failed, ms });
  console.log(`concurrency ${id}: done=${done} failed=${failed} ${ms}ms`);
}
fs.writeFileSync(path.join(ROOT, 'scenarios', 'concurrency-results.json'), JSON.stringify(concurrency, null, 2) + '\n', 'utf8');
