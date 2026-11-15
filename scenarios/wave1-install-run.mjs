// scenarios/wave1-install-run.mjs —— Wave 1：验收/安装/任务/报告
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const runs = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenarios', 'wave1-results.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outAll = [];
for (const run of runs) {
  const id = run.id;
  const out = { id, requestId: run.requestId };
  try {
    const acc = await fetch(`http://127.0.0.1:8780/requests/${run.requestId}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ acceptedBy: 'wave1-owner', note: 'Wave 1 A 类场景验收' }),
    });
    out.accept = acc.ok ? 'ok' : `failed:${acc.status}`;
    const inst = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'installer', 'plugin-install.cjs'), 'install', '--source', run.pluginDir, '--root', ROOT], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    out.install = inst.status === 0 ? 'ok' : 'failed';
    if (inst.status !== 0) throw new Error((inst.stdout + inst.stderr).slice(-1200));
    const up = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'up', id], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    out.start = up.status === 0 ? 'ok' : 'failed';
    if (up.status !== 0) throw new Error((up.stdout + up.stderr).slice(-800));
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifests', `${id}.json`), 'utf8'));
    const h = { Authorization: `Bearer ${m.runtime.serviceToken}`, 'Content-Type': 'application/json' };
    const sub = await fetch(`http://127.0.0.1:${m.port}/jobs`, { method: 'POST', headers: h, body: JSON.stringify({ params: {} }) });
    const subBody = await sub.json();
    if (sub.status !== 202) throw new Error(`submit ${sub.status} ${JSON.stringify(subBody).slice(0, 200)}`);
    let job;
    for (let i = 0; i < 120; i += 1) {
      await sleep(200);
      job = await fetch(`http://127.0.0.1:${m.port}/jobs/${subBody.jobId}`, { headers: h }).then((r) => r.json());
      if (['done', 'failed', 'cancelled'].includes(job.status)) break;
    }
    out.job = job?.status;
    if (job?.status !== 'done') throw new Error(`job ${job?.status}: ${job?.error}`);
    const result = await fetch(`http://127.0.0.1:${m.port}/jobs/${job.jobId}/result`, { headers: h }).then((r) => r.json());
    out.dataset = result.main.path;
    out.rows = JSON.parse(fs.readFileSync(out.dataset, 'utf8')).total;
    const pdir = path.join(ROOT, 'plugins', id);
    const rep = spawnSync(process.execPath, [path.join(pdir, 'gen-report.mjs'), out.dataset], { cwd: pdir, encoding: 'utf8', timeout: 120000, env: { ...process.env, FACTORY_ROOT: ROOT } });
    out.reportExit = rep.status;
    out.report = path.join(pdir, 'report', `${id}-report.html`);
    out.reportExists = fs.existsSync(out.report) && fs.statSync(out.report).size > 0;
    if (!out.reportExists) throw new Error((rep.stdout + rep.stderr).slice(-500));
  } catch (err) {
    out.error = String(err.message || err).slice(0, 1200);
  }
  console.log(id, JSON.stringify(out));
  outAll.push(out);
}
fs.writeFileSync(path.join(ROOT, 'scenarios', 'wave1-run-results.json'), JSON.stringify(outAll, null, 2) + '\n', 'utf8');
