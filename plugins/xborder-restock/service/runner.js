'use strict';
// xborder-restock —— 多站点库存/补货/资金风险（本地 fixture）
const fs = require('node:fs');
const path = require('node:path');

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new Error('库存数据为空');
  ctx.setProgress(`计算 ${rows.length} 个 SKU 的补货建议`);

  const out = rows.map((r) => {
    const daily = Number(r.daily_sales_7d) || 0;
    const stock = Number(r.stock) || 0;
    const transit = Number(r.in_transit) || 0;
    const lead = Number(r.lead_time_days) || 0;
    const moq = Math.max(1, Number(r.moq) || 1);
    const cover = daily > 0 ? (stock + transit) / daily : 999;
    const targetDays = lead + 14;
    const need = Math.max(0, Math.ceil(targetDays * daily - stock - transit));
    const reorderQty = need > 0 ? Math.ceil(need / moq) * moq : 0;
    const revenueAtRisk = daily > 0 ? Math.round(Math.max(0, lead + 7 - cover) * daily * Number(r.price || 0)) : 0;
    let severity = 'P3';
    if (cover < lead) severity = 'P1';
    else if (cover < lead + 7) severity = 'P2';
    const action = cover < lead ? '空运/紧急补货' : cover < lead + 7 ? '立即下单' : reorderQty > 0 ? '按计划补货' : '保持观察';
    return {
      sku: r.sku, site: r.site, name: r.name, stock, in_transit: transit,
      daily_sales: daily, lead_time: lead, cover_days: daily > 0 ? Math.round(cover * 10) / 10 : '无销量',
      reorder_qty: reorderQty, severity, revenue_at_risk: revenueAtRisk,
      action: reorderQty > 0 || severity !== 'P3' ? action : '保持观察',
    };
  }).sort((a, b) => (a.severity > b.severity ? -1 : a.severity < b.severity ? 1 : b.revenue_at_risk - a.revenue_at_risk));

  const p1 = out.filter((x) => x.severity === 'P1');
  const p2 = out.filter((x) => x.severity === 'P2');
  const risk = out.reduce((s, x) => s + x.revenue_at_risk, 0);
  const dataset = {
    task: 'xborder_restock', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '多站点库存补货',
      columns: ['sku', 'site', 'name', 'stock', 'in_transit', 'daily_sales', 'cover_days', 'lead_time', 'reorder_qty', 'severity', 'revenue_at_risk', 'action'],
      labels: { sku: 'SKU', site: '站点', name: '品名', stock: '库存', in_transit: '在途', daily_sales: '日均销量', cover_days: '可售天数', lead_time: '交期(天)', reorder_qty: '建议补货', severity: '优先级', revenue_at_risk: '风险销售额', action: '动作' },
      summary: [
        { k: 'SKU 数', v: out.length, s: '多站点' },
        { k: 'P1 断货风险', v: p1.length, s: '可售 < 交期' },
        { k: 'P2 低库存', v: p2.length, s: '可售 < 交期+7' },
        { k: '风险销售额', v: `$${risk.toLocaleString('en-US')}`, s: '缺货窗口估算' },
      ],
      conclusion: `共 ${out.length} 个 SKU，${p1.length} 个 P1、${p2.length} 个 P2；预计缺货风险销售额 $${risk.toLocaleString('en-US')}。`,
      recommendations: [
        'P1 先锁空运/海外仓调拨，按“风险销售额”从高到低处理。',
        '补货量按 MOQ 向上取整，避免为凑整造成二次积压。',
        '把可售天数纳入每日看板，交期波动>5 天的 SKU 单独告警。',
      ],
    },
    total: out.length, totalPages: 1, pages: [{ page: 1, rows: out }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'xborder_restock_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：P1 ${p1.length} / P2 ${p2.length}`);
}
module.exports = { runJob };
