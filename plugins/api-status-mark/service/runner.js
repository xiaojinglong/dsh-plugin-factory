'use strict';
// api-status-mark —— 动作型插件：调用 API 标记订单状态（dry_run / confirm_write / 审计）
const fs = require('node:fs');
const path = require('node:path');

async function runJob(job, ctx) {
  const p = ctx.params || {};
  const dryRun = p.dry_run === true;
  const confirmWrite = p.confirm_write === true;
  if (!dryRun && !confirmWrite) throw new Error('写操作保护：需要 confirm_write=true（可先 dry_run=true 预演）');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []);
  if (!rows.length) throw new Error('订单数据为空');
  const target = String(p.target_url || process.env.STATUS_API_URL || '').replace(/\/+$/, '');
  if (!dryRun && !target) throw new Error('缺少 target_url（或 STATUS_API_URL）');
  const token = String(process.env.STATUS_API_TOKEN || '');

  const pending = rows.filter((r) => String(r.status) === 'pending');
  const result = [];
  for (const r of pending) {
    if (dryRun) {
      result.push({ order_id: r.id, before: r.status, after: '已标记', http_status: 0, result: 'planned' });
      continue;
    }
    try {
      const res = await fetch(`${target}/orders/${encodeURIComponent(r.id)}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ status: '已标记', idempotency_key: p.idempotency_key || job.jobId }),
        signal: AbortSignal.timeout(15000),
      });
      result.push({ order_id: r.id, before: r.status, after: '已标记', http_status: res.status, result: res.ok ? 'updated' : 'failed' });
    } catch (err) {
      result.push({ order_id: r.id, before: r.status, after: '已标记', http_status: 0, result: `failed: ${err.message.slice(0, 100)}` });
    }
  }
  const updated = result.filter((x) => x.result === 'updated').length;
  const failed = result.filter((x) => String(x.result).startsWith('failed')).length;
  const dataset = {
    task: job.task || 'api_status_mark', fetchedAt: new Date().toISOString(), effect: 'write',
    outputs: ['dataset', 'receipt', 'audit'], params: { dry_run: dryRun, confirm_write: confirmWrite, idempotency_key: p.idempotency_key || '' },
    extra: {
      title: 'API 状态标记',
      columns: ['order_id', 'before', 'after', 'http_status', 'result'],
      labels: { order_id: '订单号', before: '原状态', after: '新状态', http_status: 'HTTP', result: '结果' },
      summary: [
        { k: '待处理', v: pending.length, s: '订单' },
        { k: '成功', v: updated, s: 'API 写入' },
        { k: '失败', v: failed, s: '需重试' },
        { k: '模式', v: dryRun ? '预演' : '正式', s: 'confirm_write' },
      ],
      conclusion: dryRun ? `预演 ${pending.length} 单，未调用 API。` : `处理 ${pending.length} 单：成功 ${updated}，失败 ${failed}。`,
      recommendations: failed ? ['失败单需重试并检查 API 状态。'] : ['成功后可在业务系统复核状态。'],
    },
    total: result.length, totalPages: 1, pages: [{ page: 1, rows: result }],
  };
  const receipt = { target, dryRun, confirmWrite, updated, failed, at: dataset.fetchedAt };
  await ctx.saveFile({ kind: 'receipt', fileName: 'api_status_receipt.json', content: JSON.stringify(receipt, null, 2), encoding: 'utf8' });
  await ctx.saveFile({ kind: 'main', fileName: 'api_status_mark_audit.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：${dryRun ? '预演' : `成功 ${updated}/${result.length}`}`);
}
module.exports = { runJob };
