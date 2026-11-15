// scenarios/stress-report.mjs —— 5k 行业务报告生成耗时/体积
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const id = 'xborder-restock';
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenarios', id, 'fixture.json'), 'utf8'));
const rows = Array.from({ length: 50000 }, (_, i) => ({ ...(data.rows[i % data.rows.length]), sku: `SKU-${i + 1}` }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-report-'));
fs.mkdirSync(path.join(dir, 'service'), { recursive: true });
fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
fs.mkdirSync(path.join(dir, 'report'), { recursive: true });
fs.writeFileSync(path.join(dir, 'fixtures', 'data.json'), JSON.stringify({ ...data, rows }), 'utf8');
fs.copyFileSync(path.join(ROOT, 'scenarios', id, 'runner.js'), path.join(dir, 'service', 'runner.js'));
fs.copyFileSync(path.join(ROOT, 'templates', 'report', 'business-report.mjs'), path.join(dir, 'gen-report.mjs'));
const runner = require(path.join(dir, 'service', 'runner.js'));
const saved = [];
await runner.runJob({ jobId: 'report-stress' }, { params: {}, setProgress() {}, addMissing() {}, async saveFile(f) { saved.push(f); } });
const dataset = path.join(dir, 'dataset.json');
fs.writeFileSync(dataset, saved[0].content, 'utf8');
const t0 = performance.now();
const r = spawnSync(process.execPath, [path.join(dir, 'gen-report.mjs'), dataset], {
  cwd: dir, encoding: 'utf8', timeout: 300000, env: { ...process.env, FACTORY_ROOT: ROOT },
});
const ms = Math.round(performance.now() - t0);
const report = path.join(dir, 'report', `${path.basename(dir)}-report.html`);
const bytes = fs.existsSync(report) ? fs.statSync(report).size : 0;
console.log(JSON.stringify({ id, rows: 50000, exit: r.status, ms, bytes, report: bytes > 0, stderr: (r.stderr || '').slice(0, 300) }, null, 2));
