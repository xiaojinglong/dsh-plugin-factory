// scenarios/csv-pipeline-check.mjs —— CSV 转换后的 fixture 走工厂 staging
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const body = {
  brief: 'CSV 接入验收：跨境补货（真实导出格式）',
  params: {
    pluginId: 'xborder-csv-smoke',
    name: '跨境补货 CSV 接入验收',
    type: 'file',
    fixture: path.join(ROOT, 'scenarios', 'xborder-restock', 'fixture.from-csv.json'),
    runnerFile: path.join(ROOT, 'scenarios', 'xborder-restock', 'runner.js'),
    reportFile: path.join(ROOT, 'templates', 'report', 'business-report.mjs'),
  },
};
const r = await fetch('http://127.0.0.1:8780/requests', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!r.ok) throw new Error(`create ${r.status} ${(await r.text()).slice(0, 300)}`);
const req = await r.json();
const id = req.request.id;
const p = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'generator', 'pipeline.cjs'), '--request', id], {
  cwd: ROOT, encoding: 'utf8', timeout: 300000, env: { ...process.env, CONTROL_PLANE_TOKEN: token },
});
const out = `${p.stdout || ''}\n${p.stderr || ''}`;
const state = /"state":\s*"([^"]+)"/.exec(out)?.[1] || 'unknown';
const pluginDir = /"pluginDir":\s*"([^"]+)"/.exec(out)?.[1] || '';
console.log(JSON.stringify({ requestId: id, state, pluginDir, exit: p.status }, null, 2));
if (state !== 'staging') console.log(out.slice(-2000));
