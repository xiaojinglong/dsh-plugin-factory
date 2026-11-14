import { readFileSync } from 'node:fs';
const ds = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rows = (ds.pages || []).flatMap((p) => p.rows || []);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const total = (r) => num(r.normal_stock) + num(r.warehouse_stock_total) + num(r.oversea_stock);
console.log(JSON.stringify({
  task: ds.task, params: ds.params, total: ds.total, totalPages: ds.totalPages,
  pageLens: (ds.pages || []).map((p) => [p.page, p.rows.length]),
  rows: rows.length,
  sites: [...new Set(rows.map((r) => r.site))],
  zero: rows.filter((r) => total(r) === 0).length,
  low: rows.filter((r) => total(r) > 0 && total(r) <= 10).length,
  high: rows.filter((r) => num(r.order_day30) > 0 && total(r) === 0).length,
  with30: rows.filter((r) => num(r.order_day30) > 0).length,
  bothWh: rows.filter((r) => num(r.warehouse_stock_total) > 0 && num(r.oversea_stock) > 0).length,
  sameWh: rows.filter((r) => num(r.warehouse_stock_total) > 0 && num(r.warehouse_stock_total) === num(r.oversea_stock)).length,
}, null, 2));
for (const r of rows) {
  const t = total(r);
  if (t <= 10 || num(r.order_day30) > 0) {
    console.log([r.site, r.item_id, `ns=${num(r.normal_stock)} wh=${num(r.warehouse_stock_total)} ov=${num(r.oversea_stock)} total=${t}`,
      `d3=${num(r.order_day3)} d7=${num(r.order_day7)} d30=${num(r.order_day30)} d90=${num(r.order_day90)} cnt=${num(r.order_count)}`,
      String(r.item_name).slice(0, 40)].join(' | '));
  }
}
