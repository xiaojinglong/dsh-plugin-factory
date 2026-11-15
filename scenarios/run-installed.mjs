// scenarios/run-installed.mjs —— 已安装的 6 个场景：启动、跑任务、出报告
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const runs = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenarios', 'run-results.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
for (const run of runs) {
  const id = run.id;
  const out = { id, requestId: run.requestId };
  try {
    const up = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'up', id], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    out.start = up.status === 0 ? 'ok' : 'failed';
    if (up.status !== 0) throw new Error(`start: ${(up.stdout + up.stderr).slice(-800)}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifests', `${id}.json`), 'utf8'));
    const port = manifest.port;
    const auth = { Authorization: `Bearer ${manifest.runtime.serviceToken}`, 'Content-Type': 'application/json' };
    let sub; let subBody;
    for (let i = 0; i < 20; i += 1) {
      try {
        sub = await fetch(`http://127.0.0.1:${port}/jobs`, { method: 'POST', headers: auth, body: JSON.stringify({ params: {} }) });
        subBody = await sub.json().catch(() => ({}));
        if (sub.status === 202) break;
      } catch {}
      await sleep(250);
    }
    if (!sub || sub.status !== 202) throw new Error(`submit: ${sub?.status} ${JSON.stringify(subBody).slice(0, 300)}`);
    let job = null;
    for (let i = 0; i < 160; i += 1) {
      await sleep(250);
      const r = await fetch(`http://127.0.0.1:${port}/jobs/${subBody.jobId}`, { headers: auth });
      job = await r.json();
      if (['done', 'failed', 'cancelled'].includes(job.status)) break;
    }
    out.job = job?.status;
    if (job?.status !== 'done') throw new Error(`job ${job?.status}: ${job?.error}`);
    const res = await fetch(`http://127.0.0.1:${port}/jobs/${job.jobId || job.id}/result`, { headers: auth });
    const result = await res.json();
    const datasetPath = result.main?.path || result.result?.main?.path || result.path;
    if (!datasetPath) throw new Error(`result shape: ${JSON.stringify(result).slice(0, 300)}`);
    out.dataset = datasetPath;
    out.rows = JSON.parse(fs.readFileSync(datasetPath, 'utf8')).total;
    const pluginDir = path.join(ROOT, 'plugins', id);
    const rep = spawnSync(process.execPath, [path.join(pluginDir, 'gen-report.mjs'), datasetPath], {
      cwd: pluginDir, encoding: 'utf8', timeout: 120000, env: { ...process.env, FACTORY_ROOT: ROOT },
    });
    out.reportExit = rep.status;
    out.report = path.join(pluginDir, 'report', `${id}-report.html`);
    out.reportExists = fs.existsSync(out.report) && fs.statSync(out.report).size > 0;
    if (!out.reportExists) throw new Error(`report: ${(rep.stdout + rep.stderr).slice(-400)}`);
  } catch (err) {
    out.error = String(err.message || err).slice(0, 1200);
  }
  console.log(id, JSON.stringify(out));
  results.push(out);
}
fs.writeFileSync(path.join(ROOT, 'scenarios', 'scenario-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
