// scenarios/api-pipeline-run.mjs —— 动作型插件：API 写操作全链路
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

let calls = 0;
const server = http.createServer((req, res) => {
  if (/^\/orders\/[^/]+\/status$/.test(req.url) && req.method === 'PATCH') {
    calls += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const target = `http://127.0.0.1:${server.address().port}`;

try {
  const body = {
    brief: '动作型插件：调用 API 标记订单状态（dry_run/confirm_write/回执）',
    params: {
      pluginId: 'api-status-mark', name: 'API 订单状态标记', type: 'api',
      fixture: path.join(ROOT, 'scenarios', 'api-status-mark', 'fixture.json'),
      runnerFile: path.join(ROOT, 'scenarios', 'api-status-mark', 'runner.js'),
      effect: 'write', outputs: ['dataset', 'receipt', 'audit'],
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
    method: 'POST', headers: auth, body: JSON.stringify({ acceptedBy: 'action-owner', note: 'API 动作插件验收' }),
  });
  console.log('accept', acc.status);
  const down = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'down', 'api-status-mark'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  if (down.stdout) console.log(down.stdout.trim());
  const inst = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'installer', 'plugin-install.cjs'), 'install', '--source', pluginDir, '--root', ROOT, '--force'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  console.log('install', inst.status === 0 ? 'ok' : 'failed');
  if (inst.status !== 0) { console.log((inst.stdout + inst.stderr).slice(-2500)); process.exit(1); }
  const up = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'up', 'api-status-mark'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  console.log('start', up.status === 0 ? 'ok' : 'failed');
  if (up.status !== 0) process.exit(1);

  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifests', 'api-status-mark.json'), 'utf8'));
  const h = { Authorization: `Bearer ${m.runtime.serviceToken}`, 'Content-Type': 'application/json' };
  const sub = await fetch(`http://127.0.0.1:${m.port}/jobs`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ params: { confirm_write: true, target_url: target, idempotency_key: 'uat-api-status-1' } }),
  });
  const subBody = await sub.json();
  let job;
  for (let i = 0; i < 100; i += 1) {
    await new Promise((r) => setTimeout(r, 200));
    job = await fetch(`http://127.0.0.1:${m.port}/jobs/${subBody.jobId}`, { headers: h }).then((r) => r.json());
    if (['done', 'failed', 'cancelled'].includes(job.status)) break;
  }
  console.log('job', job.status);
  const result = await fetch(`http://127.0.0.1:${m.port}/jobs/${job.jobId}/result`, { headers: h }).then((r) => r.json());
  const ds = JSON.parse(fs.readFileSync(result.main.path, 'utf8'));
  const artifacts = (result.artifacts || []).map((x) => ({ kind: x.kind, file: x.fileName, exists: fs.existsSync(x.path) }));
  console.log(JSON.stringify({ requestId: req.request.id, total: ds.total, updated: ds.extra.summary.find((x) => x.k === '成功')?.v, calls, artifacts }, null, 2));
  fs.writeFileSync(path.join(ROOT, 'scenarios', 'api-result.json'), JSON.stringify({ requestId: req.request.id, total: ds.total, calls, artifacts }, null, 2) + '\n', 'utf8');
} finally {
  server.close();
}
