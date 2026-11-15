// scenarios/run-all.mjs —— 批量跑岗位场景：create_request → pipeline
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'control-plane', 'token'), 'utf8').trim();
const cp = 'http://127.0.0.1:8780';
const reportFile = path.join(ROOT, 'templates', 'report', 'business-report.mjs');
const scenarios = [
  { id: 'hr-resume-screen', name: '简历筛选与面试安排', task: 'hr_resume_screen' },
  { id: 'xborder-restock', name: '多站点库存补货', task: 'xborder_restock' },
  { id: 'admin-asset-audit', name: '固定资产盘点', task: 'admin_asset_audit' },
  { id: 'cs-ticket-triage', name: '客服工单分诊', task: 'cs_ticket_triage' },
  { id: 'dev-repo-audit', name: '代码仓库健康审计', task: 'dev_repo_audit' },
  { id: 'seo-content-preflight', name: '内容发布前检查', task: 'seo_content_preflight' },
  { id: 'opt-keyword-gap', name: '关键词机会与内容缺口', task: 'opt_keyword_gap' },
  { id: 'promo-channel-roi', name: '渠道 ROI 与预算再分配', task: 'promo_channel_roi' },
  { id: 'assistant-account-audit', name: '账号资产与权限审计', task: 'assistant_account_audit' },
];

async function api(pathname, init = {}) {
  const r = await fetch(cp + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${pathname} ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const results = [];
for (const s of scenarios) {
  const dir = path.join(ROOT, 'scenarios', s.id);
  const fixture = path.join(dir, 'fixture.json');
  const runnerFile = path.join(dir, 'runner.js');
  console.log(`\n=== ${s.id} create ===`);
  const req = await api('/requests', {
    method: 'POST',
    body: JSON.stringify({
      brief: `${s.name}：岗位场景验收（本地 fixture）`,
      params: { pluginId: s.id, name: s.name, type: 'file', fixture, runnerFile, reportFile },
    }),
  });
  const id = req.request.id;
  console.log('request', id);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'generator', 'pipeline.cjs'), '--request', id], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000,
    env: { ...process.env, CONTROL_PLANE_TOKEN: token },
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const state = /"state":\s*"([^"]+)"/.exec(out)?.[1] || 'unknown';
  const pluginDir = /"pluginDir":\s*"([^"]+)"/.exec(out)?.[1] || '';
  console.log('state', state, 'exit', r.status);
  if (state !== 'staging') console.log(out.slice(-2500));
  results.push({ id: s.id, requestId: id, state, pluginDir, exit: r.status });
}
fs.writeFileSync(path.join(ROOT, 'scenarios', 'run-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
console.log('\nresults', JSON.stringify(results, null, 2));
