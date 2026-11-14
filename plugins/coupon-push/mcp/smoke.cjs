'use strict';
// smoke.cjs —— coupon-push MCP 冒烟：写闸门 / dry_run / 真实写 / 幂等去重
const m = require('./index.js');

async function submit(cfg, params) {
  return m.externalRequest(cfg, cfg.endpoints.submit, { body: m.buildSubmitBody(cfg, 'coupon_push', params) });
}
async function audit(cfg, jobId) {
  const p = await m.pollTask(cfg, jobId);
  if (p.status !== 'succeeded') throw new Error(`任务未成功：${p.status} ${p.error || ''}`);
  const r = await m.externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId: jobId } });
  const parsed = await m.parseResultFile(r.main.path);
  return { rows: (parsed.data.pages || []).flatMap((x) => x.rows || []), ds: parsed.data };
}

(async () => {
  const cfg = m.loadConfig();
  console.log('[config]', cfg.service.baseUrl);

  // 1) 写闸门：不传 confirm_write 必须 403
  let gate = false;
  try { await submit(cfg, { count: 1 }); } catch (e) { gate = /403/.test(e.message); }
  if (!gate) throw new Error('写闸门未生效：未传 confirm_write 未被拒绝（期望 403）');
  console.log('[gate] 未 confirm_write → 403');

  // 2) dry_run 预演：3 条 planned，不提交
  const d = await submit(cfg, { dry_run: true, count: 3 });
  const dryId = d.jobId;
  const dry = await audit(cfg, dryId);
  const planned = dry.rows.filter((r) => r.status === 'planned').length;
  if (planned !== 3) throw new Error(`dry_run 期望 3 条 planned，实际 ${planned}`);
  console.log('[dry_run] planned', planned, '| job', dryId);

  // 3) 真实写：2 条 submitted（写入本地模拟外部系统）
  const idem = `smoke-${Date.now()}`;
  const w = await submit(cfg, { confirm_write: true, count: 2, rate_ms: 120, idempotency_key: idem });
  const real = await audit(cfg, w.jobId);
  const submitted = real.rows.filter((r) => r.status === 'submitted').length;
  if (submitted !== 2) throw new Error(`真实写期望 2 条 submitted，实际 ${submitted}`);
  console.log('[write] submitted', submitted, '| job', w.jobId);

  // 4) 幂等：同一 idempotency_key 再提交 → 复用同一任务
  const again = await submit(cfg, { confirm_write: true, count: 2, rate_ms: 120, idempotency_key: idem });
  if (!again.deduplicated || again.jobId !== w.jobId) throw new Error(`幂等去重失败：${JSON.stringify(again)}`);
  console.log('[idempotent] deduplicated', again.deduplicated, '| job', again.jobId);

  console.log('[ok] coupon-push MCP 冒烟通过（闸门/预演/真实写/幂等）');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
