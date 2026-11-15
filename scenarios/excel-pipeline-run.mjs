// scenarios/excel-pipeline-run.mjs —— 动作型插件：无报告 pipeline + 安装 + 运行
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const body = {
  brief: '动作型插件：订单 Excel 状态标记（生成新文件，不覆盖原文件）',
  params: {
    pluginId: 'excel-status-mark', name: '订单 Excel 状态标记', type: 'file',
    fixture: path.join(ROOT, 'scenarios', 'excel-status-mark', 'orders.xlsx'),
    runnerFile: path.join(ROOT, 'scenarios', 'excel-status-mark', 'runner.js'),
    effect: 'file', outputs: ['dataset', 'file', 'audit'],
  },
};
const cr = await fetch('http://127.0.0.1:8780/requests', { method: 'POST', headers: auth, body: JSON.stringify(body) });
if (!cr.ok) throw new Error(`create ${cr.status} ${(await cr.text()).slice(0, 300)}`);
const req = await cr.json();
const pipeline = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'generator', 'pipeline.cjs'), '--request', req.request.id], {
  cwd: ROOT, encoding: 'utf8', timeout: 300000, env: { ...process.env, CONTROL_PLANE_TOKEN: token },
});
const out = `${pipeline.stdout || ''}\n${pipeline.stderr || ''}`;
const state = /"state":\s*"([^"]+)"/.exec(out)?.[1] || 'unknown';
const pluginDir = /"pluginDir":\s*"([^"]+)"/.exec(out)?.[1] || '';
console.log('pipeline', state);
if (state !== 'staging') { console.log(out.slice(-3000)); process.exit(1); }
const acc = await fetch(`http://127.0.0.1:8780/requests/${req.request.id}/accept`, {
  method: 'POST', headers: auth, body: JSON.stringify({ acceptedBy: 'action-owner', note: '动作型插件验收' }),
});
console.log('accept', acc.status);
const down = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'down', 'excel-status-mark'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
if (down.stdout) console.log(down.stdout.trim());
const inst = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'installer', 'plugin-install.cjs'), 'install', '--source', pluginDir, '--root', ROOT, '--force'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
console.log('install', inst.status === 0 ? 'ok' : 'failed');
if (inst.status !== 0) { console.log((inst.stdout + inst.stderr).slice(-2500)); process.exit(1); }
const up = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'up', 'excel-status-mark'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
console.log('start', up.status === 0 ? 'ok' : 'failed');
if (up.status !== 0) { console.log((up.stdout + up.stderr).slice(-1200)); process.exit(1); }
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifests', 'excel-status-mark.json'), 'utf8'));
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
const auditPath = result.main?.path;
const ds = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const fileArtifact = (result.artifacts || []).find((x) => x.kind === 'file') || (result.details || []).find((x) => x.kind === 'file');
console.log(JSON.stringify({ requestId: req.request.id, auditPath, total: ds.total, changed: ds.pages[0].rows.length, file: fileArtifact?.path, fileExists: fileArtifact ? fs.existsSync(fileArtifact.path) : false }, null, 2));
fs.writeFileSync(path.join(ROOT, 'scenarios', 'excel-result.json'), JSON.stringify({ requestId: req.request.id, auditPath, total: ds.total, changed: ds.pages[0].rows.length, file: fileArtifact?.path }, null, 2) + '\n', 'utf8');
