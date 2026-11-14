'use strict';
// smoke.cjs —— 直接驱动 MCP 薄壳，验证 submit→wait→result→read 全链路（不依赖 DSH）
const m = require('./index.js');

(async () => {
  const cfg = m.loadConfig();
  console.log('[config] baseUrl =', cfg.service.baseUrl, '| done→', m.mapTaskStatus(cfg, 'done'));

  const submitted = await m.externalRequest(cfg, cfg.endpoints.submit, {
    body: m.buildSubmitBody(cfg, 'draft_cleanup', { pages: 2 }),
  });
  const id = submitted.jobId || submitted.taskId;
  console.log('[submit]', JSON.stringify(submitted));

  const polled = await m.pollTask(cfg, id);
  console.log('[wait] status =', polled.status, '| progress =', polled.progress);

  const result = await m.externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId: id } });
  console.log('[result] main =', result.main.fileName, '| details =', (result.details || []).length, '| missing =', (result.missingItems || []).length);

  const parsed = await m.parseResultFile(result.main.path);
  const pages = parsed.data?.pages || [];
  const rows = pages.flatMap((p) => p.rows || []);
  console.log('[read] type =', parsed.type, '| pages =', pages.length, '| rows =', rows.length, '| total =', parsed.data?.total);
  console.log('[read] main.path =', result.main.path);
  console.log('[ok] MCP 五连通过');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
