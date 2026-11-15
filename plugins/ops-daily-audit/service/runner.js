'use strict';
// ops-daily-audit —— 跨境运营日报：消息/订单/物流/Listing/广告否定词
const fs = require('node:fs');
const path = require('node:path');
const NOW = new Date('2026-11-15T04:00:00Z');
const hours = (a, b) => (new Date(b) - new Date(a)) / 3600000;

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = [];
  const messages = data.messages || [];
  for (const m of messages) {
    const age = m.replied_at ? hours(m.received_at, m.replied_at) : hours(m.received_at, NOW);
    if (!m.replied_at || age > 24) {
      rows.push({
        type: '消息', ref: m.id, severity: !m.replied_at || age > 24 ? 'P1' : 'P2',
        detail: m.replied_at ? `首响 ${Math.round(age)}h 超 24h` : '未回复',
        action: '24h 内回复并记录处理结果', buyer: m.buyer,
      });
    }
  }
  const pendingOrders = (data.orders || []).filter((o) => o.status === 'pending');
  for (const o of pendingOrders) {
    const age = hours(o.paid_at, NOW);
    rows.push({
      type: '订单', ref: o.id, severity: !o.address_ok || age > 48 ? 'P1' : 'P2',
      detail: !o.address_ok ? '地址异常，需买家确认' : `未发货 ${Math.round(age)}h`,
      action: !o.address_ok ? '联系买家改地址后再发' : '安排发货/打印面单', buyer: o.sku,
    });
  }
  for (const t of data.tracking || []) {
    if (Number(t.last_update_days) > 3 && t.status === 'in_transit') {
      rows.push({ type: '物流', ref: t.tracking_no, severity: Number(t.last_update_days) > 7 ? 'P1' : 'P2', detail: `${t.last_update_days} 天无更新`, action: '联系承运商/补发评估', buyer: '' });
    }
  }
  for (const s of data.search_terms || []) {
    if (Number(s.spend) > 0 && Number(s.conversions) === 0) {
      rows.push({ type: '广告', ref: s.term, severity: 'P1', detail: `花费 ${s.spend}，0 转化`, action: '加入否定词', buyer: '' });
    }
  }
  const changedListings = (data.listings || []).filter((l) => l.changed).length;
  if (changedListings > 3) rows.push({ type: 'Listing', ref: 'daily', severity: 'P2', detail: `今日改动 ${changedListings} 个，超 3 个上限`, action: '拆到次日/记录改动', buyer: '' });

  rows.sort((a, b) => (a.severity > b.severity ? -1 : a.severity < b.severity ? 1 : 0));
  const p1 = rows.filter((r) => r.severity === 'P1');
  const dataset = {
    task: job.task || 'ops_daily_audit', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '跨境运营日报审计',
      columns: ['type', 'ref', 'severity', 'detail', 'action', 'buyer'],
      labels: { type: '类型', ref: '单号/ID', severity: '级别', detail: '问题', action: '动作', buyer: '买家/SKU' },
      summary: [
        { k: '未回复消息', v: new Set(rows.filter((r) => r.type === '消息').map((r) => r.ref)).size, s: '目标 0' },
        { k: '未发货订单', v: pendingOrders.length, s: '全部处理/标记' },
        { k: '物流停滞', v: rows.filter((r) => r.type === '物流').length, s: '>3 天' },
        { k: '否定词候选', v: rows.filter((r) => r.type === '广告').length, s: '0 转化' },
      ],
      conclusion: `发现 ${rows.length} 个异常，其中 P1 ${p1.length} 个；未回复消息 ${rows.filter((r) => r.type === '消息').length} 个、未发货订单 ${pendingOrders.length} 个、物流停滞 ${rows.filter((r) => r.type === '物流').length} 个。`,
      recommendations: [
        'P1 先处理未回复/地址异常/物流超 7 天，避免差评与退款。',
        '高花费 0 转化搜索词当天加否定词。',
        'Listing 每日改动≤3 个，超出的排到次日。',
      ],
    },
    total: rows.length, totalPages: 1, pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'ops_daily_audit_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：异常 ${rows.length}，P1 ${p1.length}`);
}
module.exports = { runJob };
