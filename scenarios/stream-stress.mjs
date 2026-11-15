// scenarios/stream-stress.mjs —— 1M NDJSON 流式审计（不落仓库大文件）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const N = 1_000_000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-stream-'));
const log = path.join(dir, '1m.ndjson');

async function generate() {
  const ws = fs.createWriteStream(log, { encoding: 'utf8' });
  for (let i = 0; i < N; i += 1) {
    const bad = i % 1000 === 0;
    const line = JSON.stringify({
      ts: new Date(1763000000000 + i * 1000).toISOString(),
      service: ['api', 'auth', 'billing', 'search'][i % 4],
      level: bad ? 'error' : 'info',
      status: bad ? 500 : 200,
      latency_ms: bad ? 1500 : 80 + (i % 200),
      message: bad ? 'synthetic error' : 'ok',
    });
    if (!ws.write(line + '\n')) await new Promise((r) => ws.once('drain', r));
  }
  await new Promise((r) => ws.end(r));
}

const tGen = performance.now();
await generate();
const genMs = Math.round(performance.now() - tGen);
const sizeMb = Math.round(fs.statSync(log).size / 1048576);

const work = path.join(dir, 'plugin');
fs.mkdirSync(path.join(work, 'fixtures'), { recursive: true });
fs.mkdirSync(path.join(work, 'service'), { recursive: true });
fs.mkdirSync(path.join(work, 'report'), { recursive: true });
fs.copyFileSync(log, path.join(work, 'fixtures', 'data.json'));
fs.copyFileSync(path.join(ROOT, 'scenarios', 'log-anomaly-audit', 'runner.js'), path.join(work, 'service', 'runner.js'));
fs.copyFileSync(path.join(ROOT, 'templates', 'report', 'business-report.mjs'), path.join(work, 'gen-report.mjs'));

const runner = require(path.join(work, 'service', 'runner.js'));
const saved = [];
const before = process.memoryUsage().heapUsed;
const tRun = performance.now();
await runner.runJob({ jobId: 'stream-1m' }, { params: {}, setProgress() {}, addMissing() {}, async saveFile(f) { saved.push(f); } });
const runMs = Math.round(performance.now() - tRun);
const heapMb = Math.round((process.memoryUsage().heapUsed - before) / 1048576);
const dsPath = path.join(work, 'dataset.json');
fs.writeFileSync(dsPath, saved[0].content, 'utf8');
const ds = JSON.parse(saved[0].content);
const rows = ds.pages.flatMap((p) => p.rows).length;

const tRep = performance.now();
const rep = spawnSync(process.execPath, [path.join(work, 'gen-report.mjs'), dsPath], {
  cwd: work, encoding: 'utf8', timeout: 300000, env: { ...process.env, FACTORY_ROOT: ROOT },
});
const repMs = Math.round(performance.now() - tRep);
const report = path.join(work, 'report', `${path.basename(work)}-report.html`);
const reportBytes = fs.existsSync(report) ? fs.statSync(report).size : 0;

const result = { rows: N, genMs, sizeMb, runMs, heapMb, datasetTotal: ds.total, anomalies: rows, repMs, reportBytes, reportExit: rep.status };
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(ROOT, 'scenarios', 'stream-results.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
fs.rmSync(dir, { recursive: true, force: true });
