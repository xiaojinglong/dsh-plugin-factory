// scenarios/trend-pipeline-run.mjs —— 趋势选品插件：pipeline → accept → install → job → report
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const body = {
  brief: 'Google Trends + 选品工具：趋势选品审计（CSV 导出）',
  params: {
    pluginId: 'trend-selection-audit',
    name: '趋势选品审计',
    type: 'file',
    fixture: path.join(ROOT, 'scenarios', 'trend-selection-audit', 'fixture.json'),
    runnerFile: path.join(ROOT, 'scenarios', 'trend-selection-audit', 'runner.js'),
    reportFile: path.join(ROOT, 'templates', 'report', 'business-report.mjs'),
  },
};
const cr = await fetch('http://127.0.0.1:8780/requests', { method: 'POST', headers: auth, body: JSON.stringify(body) });
if (!cr.ok) throw new Error(`create ${cr.status} ${(await cr.text()).slice(0, 200)}`);
const req = await cr.json();
const pipeline = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'generator', 'pipeline.cjs'), '--request', req.request.id], {
  cwd: ROOT, encoding: 'utf8', timeout: 300000, env: { ...process.env, CONTROL_PLANE_TOKEN: token },
});
const out = `${pipeline.stdout || ''}\n${pipeline.stderr || ''}`;
const state = /"state":\s*"([^"]+)"/.exec(out)?.[1] || 'unknown';
const pluginDir = /"pluginDir":\s*"([^"]+)"/.exec(out)?.[1] || '';
console.log('pipeline', state);
if (state !== 'staging') { console.log(out.slice(-2000)); process.exit(1); }
const acc = await fetch(`http://127.0.0.1:8780/requests/${req.request.id}/accept`, {
  method: 'POST', headers: auth, body: JSON.stringify({ acceptedBy: 'wave2-owner', note: '趋势选品 CSV 导出验收' }),
});
console.log('accept', acc.status);
const inst = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'installer', 'plugin-install.cjs'), 'install', '--source', pluginDir, '--root', ROOT], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
console.log('install', inst.status === 0 ? 'ok' : 'failed');
if (inst.status !== 0) { console.log((inst.stdout + inst.stderr).slice(-1200)); process.exit(1); }
const up = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'up', 'trend-selection-audit'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
console.log('start', up.status === 0 ? 'ok' : 'failed');
if (up.status !== 0) process.exit(1);
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifests', 'trend-selection-audit.json'), 'utf8'));
const h = { Authorization: `Bearer ${m.runtime.serviceToken}`, 'Content-Type': 'application/json' };
const sub = await fetch(`http://127.0.0.1:${m.port}/jobs`, { method: 'POST', headers: h, body: JSON.stringify({ params: {} }) });
const subBody = await sub.json();
let job;
for (let i = 0; i < 100; i += 1) {
  await new Promise((r) => setTimeout(r, 200));
  job = await fetch(`http://127.0.0.1:${m.port}/jobs/${subBody.jobId}`, { headers: h }).then((r) => r.json());
  if (['done', 'failed', 'cancelled'].includes(job.status)) break;
}
console.log('job', job.status);
const result = await fetch(`http://127.0.0.1:${m.port}/jobs/${job.jobId}/result`, { headers: h }).then((r) => r.json());
const dataset = result.main.path;
const ds = JSON.parse(fs.readFileSync(dataset, 'utf8'));
const pdir = path.join(ROOT, 'plugins', 'trend-selection-audit');
const rep = spawnSync(process.execPath, [path.join(pdir, 'gen-report.mjs'), dataset], { cwd: pdir, encoding: 'utf8', timeout: 120000, env: { ...process.env, FACTORY_ROOT: ROOT } });
const report = path.join(pdir, 'report', 'trend-selection-audit-report.html');
console.log(JSON.stringify({ requestId: req.request.id, dataset, total: ds.total, report: fs.existsSync(report), reportExit: rep.status }, null, 2));
fs.writeFileSync(path.join(ROOT, 'scenarios', 'trend-result.json'), JSON.stringify({ requestId: req.request.id, dataset, total: ds.total, report }, null, 2) + '\n', 'utf8');
