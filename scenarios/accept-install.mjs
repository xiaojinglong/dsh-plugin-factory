// scenarios/accept-install.mjs —— 验收 + 安装 + 启动 + 跑任务 + 报告
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const cp = 'http://127.0.0.1:8780';
const runs = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenarios', 'run-results.json'), 'utf8'));

async function api(pathname, init = {}) {
  const r = await fetch(cp + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${pathname} ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

for (const run of runs) {
  const id = run.id;
  const out = { id, requestId: run.requestId };
  try {
    await api(`/requests/${run.requestId}/accept`, { method: 'POST', body: JSON.stringify({ acceptedBy: 'scenario-owner', note: '岗位场景验收' }) });
    out.accept = 'ok';
    const inst = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'installer', 'plugin-install.cjs'), 'install', '--source', run.pluginDir, '--root', ROOT], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    out.install = inst.status === 0 ? 'ok' : 'failed';
    if (inst.status !== 0) throw new Error(`install: ${(inst.stdout + inst.stderr).slice(-1200)}`);
    const up = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'up', id], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    out.start = up.status === 0 ? 'ok' : 'failed';
    if (up.status !== 0) throw new Error(`start: ${(up.stdout + up.stderr).slice(-1000)}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifests', `${id}.json`), 'utf8'));
    const port = manifest.port;
    const auth = { Authorization: `Bearer ${manifest.runtime.serviceToken}`, 'Content-Type': 'application/json' };
    const sub = await fetch(`http://127.0.0.1:${port}/jobs`, { method: 'POST', headers: auth, body: JSON.stringify({ params: {} }) });
    const subBody = await sub.json();
    if (sub.status !== 202) throw new Error(`submit ${sub.status}: ${JSON.stringify(subBody).slice(0, 300)}`);
    let job = null;
    for (let i = 0; i < 120; i += 1) {
      await sleep(250);
      const r = await fetch(`http://127.0.0.1:${port}/jobs/${subBody.jobId}`, { headers: auth });
      job = await r.json();
      if (['done', 'failed', 'cancelled'].includes(job.status)) break;
    }
    out.job = job?.status;
    if (job?.status !== 'done') throw new Error(`job ${job?.status}: ${job?.error}`);
    const res = await fetch(`http://127.0.0.1:${port}/jobs/${job.id}/result`, { headers: auth });
    const result = await res.json();
    const datasetPath = result.main?.path;
    out.dataset = datasetPath;
    const pluginDir = path.join(ROOT, 'plugins', id);
    const rep = spawnSync(process.execPath, [path.join(pluginDir, 'gen-report.mjs'), datasetPath], {
      cwd: pluginDir, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, FACTORY_ROOT: ROOT },
    });
    out.reportExit = rep.status;
    out.report = path.join(pluginDir, 'report', `${id}-report.html`);
    out.reportExists = fs.existsSync(out.report) && fs.statSync(out.report).size > 0;
    if (!out.reportExists) throw new Error(`report missing: ${(rep.stdout + rep.stderr).slice(-500)}`);
  } catch (err) {
    out.error = String(err.message || err).slice(0, 1500);
  }
  console.log(id, JSON.stringify(out));
  results.push(out);
}
fs.writeFileSync(path.join(ROOT, 'scenarios', 'scenario-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
