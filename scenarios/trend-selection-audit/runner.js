'use strict';
// trend-selection-audit —— Google Trends 趋势 + 选品工具候选 合并评分
const fs = require('node:fs');
const path = require('node:path');

function trendOf(arr) {
  const a = (arr || []).map(Number).filter((x) => Number.isFinite(x));
  if (a.length < 6) return { trend: '数据不足', change: 0, avg: 0, peak: 0 };
  const first = a.slice(0, 3).reduce((s, x) => s + x, 0) / 3;
  const last = a.slice(-3).reduce((s, x) => s + x, 0) / 3;
  const min = Math.min(...a); const max = Math.max(...a);
  const ratio = min > 0 ? max / min : 99;
  const avg = Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  if (ratio > 2.2) return { trend: '季节性', change: last - first, avg, peak: max };
  const change = first > 0 ? (last - first) / first : 0;
  if (change > 0.15) return { trend: '向上', change, avg, peak: max };
  if (change < -0.15) return { trend: '下行', change, avg, peak: max };
  return { trend: '平稳', change, avg, peak: max };
}

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const list = Array.isArray(data.rows) ? data.rows : [];
  if (!list.length) throw new Error('选品候选为空');
  const rows = list.map((r) => {
    const price = Number(r.price) || 0;
    const cost = Number(r.cost) || 0;
    const shipping = Number(r.shipping) || 0;
    const margin = price > 0 ? Math.round(((price - cost - shipping) / price) * 1000) / 10 : 0;
    const t = trendOf(r.trend);
    let decision = '推荐';
    if (t.trend === '下行' || t.trend === '季节性') decision = '排除';
    else if (margin < 20) decision = '观察';
    const factor = t.trend === '向上' ? 1.2 : t.trend === '平稳' ? 1 : 0.7;
    const score = Math.round((Number(r.monthly_sales) / 100) * (margin / 100) * factor * 10);
    return {
      asin: r.asin, name: r.name, keyword: r.keyword || r.trend_keyword, monthly_sales: r.monthly_sales,
      price, margin: `${margin}%`, trend: t.trend, trend_change: `${Math.round(t.change * 100)}%`,
      trend_avg: t.avg, trend_peak: t.peak, competition: r.competition, score, decision,
      link: `https://www.amazon.com/dp/${r.asin}`,
    };
  }).sort((a, b) => b.score - a.score);

  const recommend = rows.filter((x) => x.decision === '推荐');
  const exclude = rows.filter((x) => x.decision === '排除');
  const avgMargin = Math.round(rows.reduce((s, x) => s + parseFloat(x.margin), 0) / rows.length * 10) / 10;
  const dataset = {
    task: job.task || 'trend_selection_audit', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: 'Google Trends + 选品工具 趋势审计',
      columns: ['asin', 'name', 'keyword', 'monthly_sales', 'price', 'margin', 'trend', 'trend_change', 'trend_avg', 'trend_peak', 'competition', 'score', 'decision', 'link'],
      labels: { asin: 'ASIN', name: '名称', keyword: '关键词', monthly_sales: '月销', price: '价格', margin: '毛利率', trend: '趋势', trend_change: '12月变化', trend_avg: '均值', trend_peak: '峰值', competition: '竞争', score: '机会分', decision: '结论', link: '链接' },
      summary: [
        { k: '关键词', v: (data.keywords || []).length, s: '趋势来源' },
        { k: '候选 ASIN', v: rows.length, s: '选品工具' },
        { k: '推荐', v: recommend.length, s: '可进入下一步' },
        { k: '排除', v: exclude.length, s: '下行/季节' },
      ],
      conclusion: `合并 ${(data.keywords || []).length} 个 Google Trends 关键词与 ${rows.length} 个候选 ASIN，推荐 ${recommend.length} 个、排除 ${exclude.length} 个，平均毛利 ${avgMargin}%。`,
      recommendations: [
        '趋势向下/强季节性的 ASIN 先排除，不做库存。',
        '推荐项优先看毛利≥20% 且竞争低/中的。',
        'Google Trends 采用导出 CSV；实时抓取当前 IP 会 429。',
      ],
    },
    total: rows.length, totalPages: 1, pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'trend_selection_audit_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：推荐 ${recommend.length}，排除 ${exclude.length}`);
}
module.exports = { runJob };
