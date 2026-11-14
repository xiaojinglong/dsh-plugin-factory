'use strict';
// smoke.cjs —— fs-ledger MCP 五连冒烟（文件系统型：扫描 inbox + 缺失项上报）
const m = require('./index.js');

(async () => {
  const cfg = m.loadConfig();
  console.log('[config]', cfg.service.baseUrl);
  const s = await m.externalRequest(cfg, cfg.endpoints.submit, { body: m.buildSubmitBody(cfg, 'fs_ledger', {}) });
  const id = s.jobId || s.taskId;
  console.log('[submit]', id);
  const p = await m.pollTask(cfg, id);
  console.log('[wait]', p.status, '|', p.progress);
  if (p.status !== 'succeeded') throw new Error(`任务未成功：${p.status} ${p.error || ''}`);
  const r = await m.externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId: id } });
  const parsed = await m.parseResultFile(r.main.path);
  const rows = (parsed.data.pages || []).flatMap((x) => x.rows || []);
  const missing = (r.missingItems || []).map((x) => x.itemName);
  console.log('[read] anomalies', rows.length, '| files', parsed.data.extra?.fileCount, '| missingItems', missing.join(','));
  if (!rows.length) throw new Error('期望命中台账异常，实际 0');
  if (!missing.includes('bad.json')) throw new Error(`缺失项应包含 bad.json，实际 ${missing.join(',')}`);
  if (!missing.includes('notes.md')) throw new Error(`缺失项应包含 notes.md，实际 ${missing.join(',')}`);
  console.log('[ok] fs-ledger MCP 五连通过（扫描/异常/缺失项）');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
