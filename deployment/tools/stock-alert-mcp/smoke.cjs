#!/usr/bin/env node
'use strict';

/**
 * smoke.cjs —— stock-alert MCP 五连冒烟：submit → wait → status → result → read
 * 直接复用 index.js 的工具实现（config.json 驱动），不额外造轮子。
 * 运行：node smoke.cjs
 */
const path = require('node:path');
const {
  getConfig,
  externalRequest,
  pollTask,
  parseResultFile,
  buildSubmitBody,
} = require('./index.js');

(async () => {
  const cfg = getConfig();
  const params = { pages: 2, shop_user_name: '陈雄德', status: 'NORMAL' };
  const t0 = Date.now();
  console.log(`[1/5] submit_task → POST ${cfg.service.baseUrl}${cfg.endpoints.submit.path} taskType=stock_alert`);
  const submitted = await externalRequest(cfg, cfg.endpoints.submit, { body: buildSubmitBody(cfg, 'stock_alert', params) });
  const taskId = submitted.taskId || submitted.jobId;
  if (!taskId) throw new Error(`未返回 taskId：${JSON.stringify(submitted)}`);
  console.log(`       taskId=${taskId}`);

  console.log(`[2/5] wait_task → 轮询直到终态`);
  const waited = await pollTask(cfg, taskId);
  console.log(`       status=${waited.status} progress=${waited.progress || '-'}`);
  if (waited.status !== 'succeeded') throw new Error(`任务未成功：${JSON.stringify(waited)}`);

  console.log(`[3/5] get_task_status → GET /jobs/${taskId}`);
  const status = await externalRequest(cfg, cfg.endpoints.status, { pathVars: { taskId } });
  console.log(`       status=${status.status}`);

  console.log(`[4/5] get_task_result → GET /jobs/${taskId}/result`);
  const result = await externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId } });
  const mainPath = result.main && result.main.path;
  if (!mainPath) throw new Error(`未返回 main.path：${JSON.stringify(result)}`);
  console.log(`       main=${path.basename(mainPath)}`);

  console.log(`[5/5] read_result_file → ${mainPath}`);
  const parsed = await parseResultFile(mainPath);
  const rows = (parsed.data.pages || []).flatMap((p) => p.rows || []);
  console.log(`       rows=${rows.length} total=${parsed.data.total} pages=${(parsed.data.pages || []).length}`);

  if (!rows.length) throw new Error('产物为空：0 条');
  console.log(`[OK] 五连冒烟通过，耗时 ${Date.now() - t0}ms，taskId=${taskId}`);
})().catch((err) => {
  console.error(`[FAIL] ${err.message}`);
  process.exit(1);
});
