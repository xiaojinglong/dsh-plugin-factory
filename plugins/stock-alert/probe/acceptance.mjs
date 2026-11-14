// acceptance.mjs —— 验收自检：样本/库存抽查/报告结构/凭证泄露
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const PLUGIN = 'D:/www/dsh-plugin-factory/plugins/stock-alert';
const jobsDir = path.join(PLUGIN, 'service/data/jobs');
const latest = readdirSync(jobsDir).sort().reverse().find((d) => readdirSync(path.join(jobsDir, d)).some((f) => f.endsWith('_dataset.json')));
const dsPath = path.join(jobsDir, latest, 'stock_alert_dataset.json');
const ds = JSON.parse(readFileSync(dsPath, 'utf8'));
const rows = (ds.pages || []).flatMap((p) => p.rows || []);
const html = readFileSync(path.join(PLUGIN, 'report/stock-alert-report.html'), 'utf8');
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const total = (r) => n(r.normal_stock) + n(r.warehouse_stock_total) + n(r.oversea_stock);
let fail = 0;
const ok = (cond, msg) => { console.log(`[${cond ? 'PASS' : 'FAIL'}] ${msg}`); if (!cond) fail += 1; };

ok(rows.length === 34 && ds.total === 34 && (ds.pages || []).length === 2, `样本 34 条 / total 34 / 2 页（实际 ${rows.length}/${ds.total}/${(ds.pages || []).length}）`);
ok(new Set(rows.map((r) => r.item_id)).size === rows.length, 'item_id 样本内唯一');
ok(html.includes(`任务：${latest}`) && html.includes(ds.fetchedAt), `报告页眉含 jobId=${latest} 与 fetchedAt=${ds.fetchedAt}`);
ok((html.match(/<h2>/g) || []).length === 8, '报告 8 节齐全');
ok(html.includes('样本覆盖率') && html.includes('限制与未决'), '报告含覆盖率与限制章节');
ok(!/dk-ai-p-[0-9a-f]{6}/.test(html) && !html.includes(process.env.LISTING_API_KEY || 'dk-ai-p-'), '报告不含凭证明文');

const picks = ['42927643978', '51100235891', '41124477872', '42009146387'];
for (const id of picks) {
  const r = rows.find((x) => String(x.item_id) === id);
  const block = html.match(new RegExp(`<tr><td>${id}</td>[\\s\\S]*?</tr>`));
  const nums = block ? [...block[0].matchAll(/<td class="num">(?:<b>)?(-?\d+)(?:<\/b>)?<\/td>/g)].map((m) => Number(m[1])) : [];
  const expect = [n(r.normal_stock), n(r.warehouse_stock_total), n(r.oversea_stock), total(r), n(r.order_day30), n(r.no_stock)];
  ok(block && JSON.stringify(nums) === JSON.stringify(expect), `抽查 ${id}：normal=${n(r.normal_stock)} 仓=${n(r.warehouse_stock_total)} 海外=${n(r.oversea_stock)} 总=${total(r)} 30天单=${n(r.order_day30)} → 报告表格 ${JSON.stringify(nums)} 与 job 数据 ${JSON.stringify(expect)} 一致`);
}
console.log(`\n验收结果：${fail === 0 ? '全部 PASS ✅' : `${fail} 项 FAIL ❌`}  dataset=${dsPath}`);
process.exit(fail === 0 ? 0 : 1);
