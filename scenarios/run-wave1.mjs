// scenarios/run-wave1.mjs —— Wave 1：5 个 A 类插件走工厂 staging
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const reportFile = path.join(ROOT, 'templates', 'report', 'business-report.mjs');
const list = [
  ['git-flow-audit', 'Git 工作流审计'],
  ['boss-candidate-score', 'BOSS 候选人评分'],
  ['product-selection-score', '选品评分'],
  ['ops-daily-audit', '跨境运营日报'],
  ['supplier-quote-compare', '供应商报价对比'],
];
const results = [];
for (const [id, name] of list) {
  const dir = path.join(ROOT, 'scenarios', id);
  const r = await fetch('http://127.0.0.1:8780/requests', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief: `${name}：Wave 1 岗位场景验收`, params: { pluginId: id, name, type: 'file', fixture: path.join(dir, 'fixture.json'), runnerFile: path.join(dir, 'runner.js'), reportFile } }),
  });
  if (!r.ok) throw new Error(`${id} create ${r.status} ${(await r.text()).slice(0, 200)}`);
  const req = await r.json();
  const p = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'generator', 'pipeline.cjs'), '--request', req.request.id], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000, env: { ...process.env, CONTROL_PLANE_TOKEN: token },
  });
  const out = `${p.stdout || ''}\n${p.stderr || ''}`;
  const state = /"state":\s*"([^"]+)"/.exec(out)?.[1] || 'unknown';
  const pluginDir = /"pluginDir":\s*"([^"]+)"/.exec(out)?.[1] || '';
  console.log(id, state, p.status);
  if (state !== 'staging') console.log(out.slice(-1500));
  results.push({ id, requestId: req.request.id, state, pluginDir });
}
fs.writeFileSync(path.join(ROOT, 'scenarios', 'wave1-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
