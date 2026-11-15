'use strict';
// product-selection-score —— 趋势/竞争/利润评分（选品）
const fs = require('node:fs');
const path = require('node:path');

function trendOf(arr) {
  const a = (arr || []).map(Number).filter((x) => Number.isFinite(x));
  if (a.length < 6) return { trend: '数据不足', slope: 0, ratio: 0 };
  const first = a.slice(0, 3).reduce((s, x) => s + x, 0) / 3;
  const last = a.slice(-3).reduce((s, x) => s + x, 0) / 3;
  const min = Math.min(...a); const max = Math.max(...a);
  const ratio = min > 0 ? max / min : 99;
  if (ratio > 2.2) return { trend: '季节性', slope: last - first, ratio };
  const change = first > 0 ? (last - first) / first : 0;
  if (change > 0.15) return { trend: '向上', slope: change, ratio };
  if (change < -0.15) return { trend: '下行', slope: change, ratio };
  return { trend: '平稳', slope: change, ratio };
}

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const list = Array.isArray(data.rows) ? data.rows : [];
  if (!list.length) throw new Error('候选 ASIN 为空');

  const rows = list.map((r) => {
    const price = Number(r.price) || 0;
    const cost = Number(r.cost) || 0;
    const shipping = Number(r.shipping) || 0;
    const margin = price > 0 ? Math.round(((price - cost - shipping) / price) * 1000) / 10 : 0;
    const t = trendOf(r.trend);
    let decision = '推荐';
    if (t.trend === '下行' || t.trend === '季节性') decision = '排除';
    else if (margin < 20) decision = '观察';
    const trendFactor = t.trend === '向上' ? 1.2 : t.trend === '平稳' ? 1 : 0.7;
    const score = Math.round((Number(r.monthly_sales) / 100) * (margin / 100) * trendFactor * 10);
    return {
      asin: r.asin, name: r.name, keyword: r.keyword, monthly_sales: r.monthly_sales,
      price, margin: `${margin}%`, competition: r.competition, trend: t.trend,
      trend_change: `${Math.round(t.slope * 100)}%`, score, decision,
      link: `https://www.amazon.com/dp/${r.asin}`,
    };
  }).sort((a, b) => b.score - a.score);

  const recommend = rows.filter((x) => x.decision === '推荐');
  const exclude = rows.filter((x) => x.decision === '排除');
  const avgMargin = Math.round(rows.reduce((s, x) => s + parseFloat(x.margin), 0) / rows.length * 10) / 10;
  const dataset = {
    task: job.task || 'product_selection_score', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: `选品评分：${data.keyword || ''}`,
      columns: ['asin', 'name', 'monthly_sales', 'price', 'margin', 'competition', 'trend', 'trend_change', 'score', 'decision', 'link'],
      labels: { asin: 'ASIN', name: '名称', monthly_sales: '月销估算', price: '价格', margin: '毛利率', competition: '竞争', trend: '趋势', trend_change: '变化', score: '机会分', decision: '结论', link: '链接' },
      summary: [
        { k: '候选 ASIN', v: rows.length, s: '对比池' },
        { k: '推荐', v: recommend.length, s: '可进入下一步' },
        { k: '排除', v: exclude.length, s: '下行/季节' },
        { k: '平均毛利', v: `${avgMargin}%`, s: '粗算' },
      ],
      conclusion: `评估 ${rows.length} 个 ASIN，${recommend.length} 个推荐、${exclude.length} 个排除；平均毛利率 ${avgMargin}%。`,
      recommendations: [
        '排除下行/强季节性 ASIN，避免压库存。',
        '推荐项优先看毛利≥20% 且竞争“低/中”的。',
        '正式下单前用真实物流/佣金/退货率重算利润。',
      ],
    },
    total: rows.length, totalPages: 1, pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'product_selection_score_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：推荐 ${recommend.length}，排除 ${exclude.length}`);
}
module.exports = { runJob };
