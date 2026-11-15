'use strict';
// supplier-quote-compare —— 3–5 家供应商报价 / 含税运 / 交期 / MOQ / 样品
const fs = require('node:fs');
const path = require('node:path');

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const list = Array.isArray(data.rows) ? data.rows : [];
  if (!list.length) throw new Error('供应商报价为空');
  const targetQty = Number(data.target_qty) || 500;
  const taxRate = Number(data.tax_rate) || 0.13;

  const rows = list.map((r) => {
    const unit = Number(r.unit_price) || 0;
    const moq = Number(r.moq) || 1;
    const qty = Math.max(targetQty, moq);
    const goods = unit * qty;
    const tax = r.tax_included ? 0 : goods * taxRate;
    const landed = goods + Number(r.shipping || 0) + tax;
    const unitLanded = landed / qty;
    let score = 100;
    score -= unitLanded * 8;
    score -= Number(r.lead_time_days) * 0.8;
    score += Number(r.rating || 0) * 3;
    if (r.sample_supported) score += 5;
    if (qty > targetQty) score -= 8;
    return {
      supplier: r.supplier, unit_price: unit, moq, order_qty: qty,
      shipping: Number(r.shipping || 0), tax_included: r.tax_included ? '是' : '否',
      landed_total: Math.round(landed), unit_landed: Math.round(unitLanded * 100) / 100,
      lead_time_days: r.lead_time_days, sample_supported: r.sample_supported ? '是' : '否',
      rating: r.rating, score: Math.round(score),
      risk: qty > targetQty ? 'MOQ 高于目标量' : Number(r.lead_time_days) > 20 ? '交期偏长' : '正常',
    };
  }).sort((a, b) => b.score - a.score);

  const best = rows[0];
  const cheapest = [...rows].sort((a, b) => a.unit_landed - b.unit_landed)[0];
  const fastest = [...rows].sort((a, b) => a.lead_time_days - b.lead_time_days)[0];
  const dataset = {
    task: job.task || 'supplier_quote_compare', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '供应商报价对比',
      columns: ['supplier', 'unit_price', 'moq', 'order_qty', 'shipping', 'tax_included', 'landed_total', 'unit_landed', 'lead_time_days', 'sample_supported', 'rating', 'score', 'risk'],
      labels: { supplier: '供应商', unit_price: '单价', moq: 'MOQ', order_qty: '实际下单量', shipping: '运费', tax_included: '含税', landed_total: '到岸总价', unit_landed: '到岸单价', lead_time_days: '交期(天)', sample_supported: '样品', rating: '评分', score: '综合分', risk: '风险' },
      summary: [
        { k: '供应商', v: rows.length, s: '3–5 家' },
        { k: '最低到岸价', v: `¥${cheapest.unit_landed}`, s: cheapest.supplier },
        { k: '最快交期', v: `${fastest.lead_time_days}天`, s: fastest.supplier },
        { k: '综合推荐', v: best.supplier, s: `评分 ${best.score}` },
      ],
      conclusion: `对比 ${rows.length} 家供应商（目标 ${targetQty} 件，税率 ${taxRate * 100}%）：最低到岸单价 ${cheapest.supplier} ¥${cheapest.unit_landed}，最快交期 ${fastest.supplier} ${fastest.lead_time_days} 天，综合推荐 ${best.supplier}。`,
      recommendations: [
        '先看“到岸单价 + 交期 + MOQ”三项，不只看单价。',
        'MOQ 高于目标量的供应商要按实际下单量重算资金占用。',
        '样品支持与评分作为加分项，正式下单前索样验证。',
      ],
    },
    total: rows.length, totalPages: 1, pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'supplier_quote_compare_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：${rows.length} 家，推荐 ${best.supplier}`);
}
module.exports = { runJob };
