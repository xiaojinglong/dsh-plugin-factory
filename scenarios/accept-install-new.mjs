// scenarios/accept-install-new.mjs —— 新 3 个角色：验收 + 安装
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const runs = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenarios', 'run-results.json'), 'utf8'));
const ids = new Set(['opt-keyword-gap', 'promo-channel-roi', 'assistant-account-audit']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(pathname, init = {}) {
  const r = await fetch('http://127.0.0.1:8780' + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${pathname} ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
for (const run of runs.filter((x) => ids.has(x.id))) {
  await api(`/requests/${run.requestId}/accept`, { method: 'POST', body: JSON.stringify({ acceptedBy: 'scenario-owner', note: '岗位场景验收' }) });
  const inst = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'installer', 'plugin-install.cjs'), 'install', '--source', run.pluginDir, '--root', ROOT], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  console.log(run.id, 'accept=ok', 'install=', inst.status === 0 ? 'ok' : 'failed');
  if (inst.status !== 0) console.log((inst.stdout + inst.stderr).slice(-1000));
  await sleep(200);
}
