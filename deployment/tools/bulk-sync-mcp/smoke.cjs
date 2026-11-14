'use strict';
// smoke.cjs —— bulk-sync MCP 五连冒烟（含首轮 500 自动重试）
const m = require('./index.js');
(async () => {
  const cfg = m.loadConfig();
  console.log('[config]', cfg.service.baseUrl);
  const s = await m.externalRequest(cfg, cfg.endpoints.submit, {
    body: m.buildSubmitBody(cfg, 'bulk_sync', { pages: 2, pageSize: 50, total_rows: 180, delay_ms: 10, fail_first_n: 1 }),
  });
  const id = s.jobId || s.taskId;
  console.log('[submit]', id);
  const p = await m.pollTask(cfg, id);
  console.log('[wait]', p.status, '|', p.progress);
  if (p.status !== 'succeeded') throw new Error(`任务未成功：${p.status} ${p.error || ''}`);
  const r = await m.externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId: id } });
  const parsed = await m.parseResultFile(r.main.path);
  const rows = (parsed.data.pages || []).flatMap((x) => x.rows || []);
  console.log('[read] rows', rows.length, '| total', parsed.data.total, '| task', parsed.data.task);
  if (rows.length !== 100) throw new Error(`期望 2 页 100 条，实际 ${rows.length}`);
  if (Number(parsed.data.total) !== 180) throw new Error(`期望 total=180，实际 ${parsed.data.total}`);
  console.log('[ok] bulk-sync MCP 五连通过（首轮 500 → 重试成功）');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
