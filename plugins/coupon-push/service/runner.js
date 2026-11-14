'use strict';

/**
 * runner.js —— coupon-push 执行层（写操作 · 模拟外部优惠券系统）
 *
 * 目的：在"不触碰任何真实系统"的前提下，验证工厂写操作四道闸：
 *   dry_run 预演 / confirm_write 显式确认 / 逐条审计 / 限速与连续失败停止；
 *   另验证 runtime 侧的每日额度、idempotency_key 去重。
 *
 * "外部系统"= 本插件 data/sim-external/coupons.json（模拟，可随时删除重建）。
 */

const fs = require('node:fs');
const path = require('node:path');

const SIM_DIR = path.join(__dirname, 'data', 'sim-external');
const STORE = path.join(SIM_DIR, 'coupons.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readStore() {
  try {
    const arr = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeStore(list) {
  fs.mkdirSync(SIM_DIR, { recursive: true });
  const tmp = `${STORE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, STORE);
}

async function runJob(job, ctx) {
  const p = ctx.params || {};
  const dryRun = p.dry_run === true;
  const confirmWrite = p.confirm_write === true;

  // 第四道闸的兜底（即使 runtime 配置被误改为 read-only，插件本身也不允许未确认写入）
  if (!dryRun && !confirmWrite) {
    throw new Error('写操作保护：需显式传 confirm_write=true 才会发放优惠券（可先用 dry_run=true 预演）');
  }
  const apiKey = String(process.env.COUPON_API_KEY || '').trim();
  if (!dryRun && !apiKey) throw new Error('缺少凭证 COUPON_API_KEY：请用 factory secret coupon-push set COUPON_API_KEY=... 加密保存');

  const count = Math.max(1, Math.min(20, Number(p.count) || 5));
  const rateMs = Math.max(100, Math.min(3000, Number(p.rate_ms) || 350));
  const failSeq = new Set((Array.isArray(p.fail_seq) ? p.fail_seq : []).map(Number));
  const runTag = String(job.jobId || Date.now()).slice(-6);
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const store = readStore();
  const known = new Set(store.map((x) => x.key));
  const rows = [];
  let submitted = 0; let skipped = 0; let failed = 0; let consecutive = 0; let stopped = false;

  for (let seq = 1; seq <= count; seq += 1) {
    if (ctx.isAborted()) throw new Error('任务已被终止');
    const shop = `SHOP-${((seq - 1) % 5) + 1}`;
    const couponCode = `SIM-${day}-${runTag}-${String(seq).padStart(2, '0')}`;
    const itemKey = `${shop}:${couponCode}`;
    const amount = [5, 10, 15][(seq - 1) % 3];
    const qty = 100;
    ctx.setProgress(`优惠券 ${seq}/${count}：${shop} ${couponCode}${dryRun ? '（预演）' : ''}`);
    const base = { seq, shop_id: shop, coupon_code: couponCode, amount, qty, key: itemKey };

    if (known.has(itemKey)) {
      rows.push({ ...base, status: 'skipped_duplicate', http_status: 200, receipt: '已存在，跳过（幂等）', at: new Date().toISOString() });
      skipped += 1;
      continue;
    }
    if (dryRun) {
      rows.push({ ...base, status: 'planned', http_status: 0, receipt: 'dry_run 未提交', at: new Date().toISOString() });
      continue;
    }

    await sleep(rateMs); // 限速：串行 + 间隔
    if (failSeq.has(seq)) {
      failed += 1;
      consecutive += 1;
      rows.push({ ...base, status: 'failed', http_status: 500, receipt: '模拟上游失败（fail_seq）', at: new Date().toISOString() });
      ctx.addMissing(itemKey, `模拟写失败（fail_seq 含 ${seq}）`);
      if (consecutive >= 3) { stopped = true; ctx.log('连续失败 3 条，停止剩余优惠券'); break; }
      continue;
    }
    consecutive = 0;
    const rec = { ...base, status: 'submitted', http_status: 200, receipt: '模拟发放成功（写入本地模拟外部系统）', at: new Date().toISOString() };
    store.push({ ...rec, jobId: job.jobId });
    known.add(itemKey);
    writeStore(store);
    rows.push(rec);
    submitted += 1;
  }

  const dataset = {
    task: 'coupon_push',
    fetchedAt: new Date().toISOString(),
    params: { count, dry_run: dryRun, confirm_write: confirmWrite, rate_ms: rateMs, fail_seq: [...failSeq] },
    extra: {
      simulated: true,
      externalStore: STORE,
      planned: rows.filter((r) => r.status === 'planned').length,
      submitted,
      skipped_duplicate: skipped,
      failed,
      stoppedEarly: stopped,
      total: rows.length,
    },
    total: rows.length,
    totalPages: '-',
    pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'coupon_push_audit.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：计划 ${rows.length}，提交 ${submitted}，跳过 ${skipped}，失败 ${failed}${stopped ? '（提前停止）' : ''}`);
}

module.exports = { runJob, STORE };
