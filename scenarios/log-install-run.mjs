// scenarios/log-install-run.mjs —— 流式日志插件：accept → install → job → report
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const requestId = 'req_20261115060523_b1148b';
const pluginDir = path.join(ROOT, 'data', 'generator', 'runs', requestId, 'log-anomaly-audit');
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

let r = await fetch(`http://127.0.0.1:8780/requests/${requestId}/accept`, {
  method: 'POST', headers: auth, body: JSON.stringify({ acceptedBy: 'scenario-owner', note: '1M 流式日志场景验收' }),
});
console.log('accept', r.status, r.ok ? 'ok' : (await r.text()).slice(0, 200));
const inst = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'installer', 'plugin-install.cjs'), 'install', '--source', pluginDir, '--root', ROOT], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
console.log('install', inst.status === 0 ? 'ok' : 'failed');
if (inst.status !== 0) { console.log((inst.stdout + inst.stderr).slice(-1200)); process.exit(1); }
const up = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'up', 'log-anomaly-audit'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
console.log('start', up.status === 0 ? 'ok' : 'failed');
if (up.status !== 0) { console.log((up.stdout + up.stderr).slice(-800)); process.exit(1); }
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifests', 'log-anomaly-audit.json'), 'utf8'));
const h = { Authorization: `Bearer ${m.runtime.serviceToken}`, 'Content-Type': 'application/json' };
const sub = await fetch(`http://127.0.0.1:${m.port}/jobs`, { method: 'POST', headers: h, body: JSON.stringify({ params: {} }) });
const subBody = await sub.json();
let job;
for (let i = 0; i < 80; i += 1) {
  await new Promise((x) => setTimeout(x, 200));
  job = await fetch(`http://127.0.0.1:${m.port}/jobs/${subBody.jobId}`, { headers: h }).then((x) => x.json());
  if (['done', 'failed', 'cancelled'].includes(job.status)) break;
}
console.log('job', job.status);
const result = await fetch(`http://127.0.0.1:${m.port}/jobs/${job.jobId}/result`, { headers: h }).then((x) => x.json());
const dataset = result.main.path;
const ds = JSON.parse(fs.readFileSync(dataset, 'utf8'));
const out = path.join(ROOT, 'plugins', 'log-anomaly-audit');
const rep = spawnSync(process.execPath, [path.join(out, 'gen-report.mjs'), dataset], { cwd: out, encoding: 'utf8', timeout: 120000, env: { ...process.env, FACTORY_ROOT: ROOT } });
const report = path.join(out, 'report', 'log-anomaly-audit-report.html');
const summary = Object.fromEntries((ds.extra.summary || []).map((x) => [x.k, x.v]));
console.log(JSON.stringify({ dataset, total: ds.total, anomalies: ds.pages.flatMap((p) => p.rows).length, summary, report: fs.existsSync(report), reportExit: rep.status }, null, 2));
fs.writeFileSync(path.join(ROOT, 'scenarios', 'log-result.json'), JSON.stringify({ requestId, pluginDir, total: ds.total, anomalies: ds.pages.flatMap((p) => p.rows).length, summary, report }, null, 2) + '\n', 'utf8');
