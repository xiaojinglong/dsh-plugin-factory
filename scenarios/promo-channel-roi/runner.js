'use strict';
// promo-channel-roi —— 网络推广：渠道 ROI 与预算再分配（本地 fixture）
const fs = require('node:fs');
const path = require('node:path');
const n = (v) => Number(v) || 0;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0);
const r2 = (v) => Math.round(v * 100) / 100;

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new Error('渠道数据为空');
  ctx.setProgress(`分析 ${rows.length} 个渠道`);

  const out = rows.map((r) => {
    const spend = n(r.spend); const revenue = n(r.revenue);
    const roas = spend > 0 ? r2(revenue / spend) : 0;
    const roi = spend > 0 ? r2((revenue - spend) / spend) : 0;
    const cac = n(r.leads) > 0 ? r2(spend / n(r.leads)) : 0;
    const ctr = pct(n(r.clicks), n(r.impressions));
    const cvr = pct(n(r.orders), n(r.clicks));
    let action = '保持';
    let severity = 'P3';
    if (roas >= 2.5) { action = '加预算'; severity = 'P3'; }
    else if (roas >= 1.5) { action = '优化后加'; severity = 'P2'; }
    else if (roas > 0) { action = '降预算/优化'; severity = 'P1'; }
    else { action = '暂停'; severity = 'P1'; }
    return {
      channel: r.channel, spend, revenue, roas, roi, cac, ctr: `${ctr}%`, cvr: `${cvr}%`,
      leads: n(r.leads), orders: n(r.orders), severity, action,
    };
  }).sort((a, b) => b.roas - a.roas);

  const spend = out.reduce((s, x) => s + x.spend, 0);
  const revenue = out.reduce((s, x) => s + x.revenue, 0);
  const roas = spend > 0 ? r2(revenue / spend) : 0;
  const cut = out.filter((x) => x.severity === 'P1');
  const scale = out.filter((x) => x.action === '加预算');
  const dataset = {
    task: job.task || 'promo_channel_roi', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '渠道 ROI 与预算再分配',
      columns: ['channel', 'spend', 'revenue', 'roas', 'roi', 'cac', 'ctr', 'cvr', 'leads', 'orders', 'severity', 'action'],
      labels: { channel: '渠道', spend: '花费', revenue: '收入', roas: 'ROAS', roi: 'ROI', cac: 'CAC', ctr: 'CTR', cvr: 'CVR', leads: '线索', orders: '订单', severity: '风险', action: '建议' },
      summary: [
        { k: '总花费', v: `¥${spend.toLocaleString('zh-CN')}`, s: '全渠道' },
        { k: '总收入', v: `¥${revenue.toLocaleString('zh-CN')}`, s: '归因收入' },
        { k: '整体 ROAS', v: roas, s: '收入/花费' },
        { k: '需降/停', v: cut.length, s: 'P1 渠道' },
      ],
      conclusion: `总花费 ¥${spend.toLocaleString('zh-CN')}、收入 ¥${revenue.toLocaleString('zh-CN')}，整体 ROAS ${roas}；${cut.length} 个渠道需降/停，${scale.length} 个可加预算。`,
      recommendations: [
        `把 P1 渠道预算转给 ROAS≥2.5 的 ${scale.map((x) => x.channel).join('、') || '高效渠道'}，先小步测试。`,
        'ROAS 1.5–2.5 的渠道先优化素材/落地页，再决定是否加预算。',
        '关注 CAC 与复购，避免只看首单 ROAS 造成误判。',
      ],
    },
    total: out.length, totalPages: 1, pages: [{ page: 1, rows: out }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'promo_channel_roi_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：ROAS ${roas}，需降/停 ${cut.length}`);
}
module.exports = { runJob };
