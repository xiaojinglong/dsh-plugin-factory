'use strict';
// smoke.cjs —— gsmp-academy MCP 五连冒烟（2 节课、每节 3 秒，避免重复长时间播放）
const m = require('./index.js');
(async () => {
  const cfg = m.loadConfig();
  console.log('[config]', cfg.service.baseUrl);
  const s = await m.externalRequest(cfg, cfg.endpoints.submit, {
    body: m.buildSubmitBody(cfg, 'gsmp_academy', { max_lessons: 2, seconds_per_lesson: 3, speed: 2 }),
  });
  const id = s.jobId || s.taskId;
  const p = await m.pollTask(cfg, id);
  console.log('[wait]', p.status, '|', p.progress);
  const r = await m.externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId: id } });
  const parsed = await m.parseResultFile(r.main.path);
  const rows = (parsed.data.pages || []).flatMap((x) => x.rows || []);
  console.log('[read] rows', rows.length, '| played', rows.filter((x) => x.status === 'played').length, '| task', parsed.data.task);
  console.log('[ok] gsmp-academy MCP 五连通过');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
