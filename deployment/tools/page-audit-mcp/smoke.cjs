'use strict';
// smoke.cjs —— page-audit MCP 五连冒烟（浏览器型：登录态 + 3 页巡检 + 截图）
const path = require('node:path');
const fs = require('node:fs');
const m = require('./index.js');

(async () => {
  const cfg = m.loadConfig();
  console.log('[config]', cfg.service.baseUrl);
  const s = await m.externalRequest(cfg, cfg.endpoints.submit, {
    body: m.buildSubmitBody(cfg, 'page_audit', { pages: 3 }),
  });
  const id = s.jobId || s.taskId;
  console.log('[submit]', id);
  const p = await m.pollTask(cfg, id);
  console.log('[wait]', p.status, '|', p.progress);
  if (p.status !== 'succeeded') throw new Error(`任务未成功：${p.status} ${p.error || ''}`);
  const r = await m.externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId: id } });
  const parsed = await m.parseResultFile(r.main.path);
  const rows = (parsed.data.pages || []).flatMap((x) => x.rows || []);
  const issues = rows.reduce((s2, x) => s2 + (x.issues || []).length, 0);
  console.log('[read] pages', rows.length, '| items', parsed.data.extra?.itemCount, '| issues', issues, '| task', parsed.data.task);
  if (rows.length !== 3) throw new Error(`期望 3 页，实际 ${rows.length}`);
  if (!issues) throw new Error('期望命中巡检问题，实际 0');
  const dataRoot = path.resolve(path.dirname(r.main.path), '..', '..');
  for (const row of rows) {
    if (!row.screenshot) throw new Error(`第 ${row.seq} 页缺截图记录`);
    if (!fs.existsSync(path.join(dataRoot, row.screenshot))) throw new Error(`截图不存在：${row.screenshot}`);
  }
  console.log('[ok] page-audit MCP 五连通过（3 页 / 截图齐全 / 命中问题）');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
