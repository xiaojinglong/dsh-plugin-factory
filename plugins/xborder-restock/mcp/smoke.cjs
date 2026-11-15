'use strict';
// 生成插件的 MCP 冒烟（五连：submit→wait→result→read）
const m = require('./index.js');
(async () => {
  const cfg = m.loadConfig();
  const s = await m.externalRequest(cfg, cfg.endpoints.submit, { body: m.buildSubmitBody(cfg, 'xborder_restock', { limit: 2 }) });
  const id = s.jobId || s.taskId;
  const p = await m.pollTask(cfg, id);
  if (p.status !== 'succeeded') throw new Error(`任务未成功：${p.status} ${p.error || ''}`);
  const r = await m.externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId: id } });
  const parsed = await m.parseResultFile(r.main.path);
  const rows = (parsed.data.pages || []).flatMap((x) => x.rows || []);
  if (!rows.length) throw new Error('fixture 返回 0 行');
  console.log('[ok] xborder-restock 冒烟通过 rows=' + rows.length);
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
