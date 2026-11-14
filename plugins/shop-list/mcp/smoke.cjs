'use strict';
// smoke.cjs —— shop-list MCP 五连冒烟
const m = require('./index.js');
(async () => {
  const cfg = m.loadConfig();
  console.log('[config]', cfg.service.baseUrl);
  const s = await m.externalRequest(cfg, cfg.endpoints.submit, { body: m.buildSubmitBody(cfg, 'shop_list', { pages: 2, pageSize: 100 }) });
  const id = s.jobId || s.taskId;
  const p = await m.pollTask(cfg, id);
  console.log('[wait]', p.status, '|', p.progress);
  const r = await m.externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId: id } });
  const parsed = await m.parseResultFile(r.main.path);
  const rows = (parsed.data.pages || []).flatMap((x) => x.rows || []);
  console.log('[read] rows', rows.length, '| total', parsed.data.total, '| task', parsed.data.task);
  console.log('[ok] shop-list MCP 五连通过');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
