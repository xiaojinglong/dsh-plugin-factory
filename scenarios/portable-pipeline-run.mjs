// scenarios/portable-pipeline-run.mjs —— 工厂自动生成 portable-host 插件
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const body = {
  brief: '自动生成 portable-host 插件：JSON 行数统计',
  params: {
    pluginId: 'portable-demo-auto',
    name: 'Portable Demo Auto',
    target: 'portable-host',
    fixture: path.join(ROOT, 'scenarios', 'api-status-mark', 'fixture.json'),
    toolName: 'portable_demo_auto',
    description: 'Count rows in a JSON fixture from a generated portable DSH plugin.',
    effect: 'read',
    outputs: ['dataset', 'audit'],
  },
};
const cr = await fetch('http://127.0.0.1:8780/requests', { method: 'POST', headers: auth, body: JSON.stringify(body) });
if (!cr.ok) throw new Error(`create ${cr.status} ${(await cr.text()).slice(0, 400)}`);
const req = await cr.json();
const pipeline = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'generator', 'pipeline.cjs'), '--request', req.request.id], {
  cwd: ROOT, encoding: 'utf8', timeout: 600000, env: { ...process.env, CONTROL_PLANE_TOKEN: token },
});
const out = `${pipeline.stdout || ''}\n${pipeline.stderr || ''}`;
console.log(out.slice(-4000));
if (pipeline.status !== 0) process.exit(1);
const summary = JSON.parse(pipeline.stdout.slice(pipeline.stdout.indexOf('{')));
const dist = path.join(ROOT, 'data', 'generator', 'runs', req.request.id, 'dist');
const zip = fs.readdirSync(dist).find((f) => f.endsWith('.zip'));
console.log(JSON.stringify({ requestId: req.request.id, state: summary.state, pluginDir: summary.pluginDir, zip: path.join(dist, zip) }, null, 2));
fs.writeFileSync(path.join(ROOT, 'scenarios', 'portable-result.json'), JSON.stringify({ requestId: req.request.id, state: summary.state, pluginDir: summary.pluginDir, zip: path.join(dist, zip) }, null, 2) + '\n', 'utf8');
