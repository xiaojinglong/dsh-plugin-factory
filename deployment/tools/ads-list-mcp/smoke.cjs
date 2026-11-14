'use strict';
// smoke.cjs —— ads-list MCP 五连冒烟
const m = require('./index.js');
(async () => {
  const cfg = m.loadConfig();
  console.log('[config]', cfg.service.baseUrl);
  const s = await m.externalRequest(cfg, cfg.endpoints.submit, {
    body: m.buildSubmitBody(cfg, 'ads_list', { pages: 2, shop_id: '1097451512', date_from: '2026-11-01', date_to: '2026-11-13' }),
  });
  const id = s.jobId || s.taskId;
  const p = await m.pollTask(cfg, id);
  console.log('[wait]', p.status, '|', p.progress);
  const r = await m.externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId: id } });
  const parsed = await m.parseResultFile(r.main.path);
  const rows = (parsed.data.pages || []).flatMap((x) => x.rows || []);
  console.log('[read] rows', rows.length, '| total', parsed.data.total, '| task', parsed.data.task);
  console.log('[ok] ads-list MCP 五连通过');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
