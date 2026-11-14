import { writeFile } from "node:fs/promises";
const KEY = "dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7";
const URL = "https://api.giikin.com/agent/shopee/user/openapi/listing/listing";
const H = { "content-type": "application/json", authorization: `Bearer ${KEY}` };
const OUT = "D:/www/dsh-plugin-factory/plugins/listing-list/data";
const pages = [];
for (const page of [1, 2]) {
  const res = await fetch(URL, { method: "POST", headers: H, body: JSON.stringify({ page, pageSize: 20, shop_user_id: 632016, shop_user_name: "陈雄德", status: "NORMAL" }), signal: AbortSignal.timeout(60000) });
  const j = JSON.parse(await res.text());
  const d = j.data || {};
  pages.push({ page, code: j.code, total: d.pagination?.total, totalPages: d.pagination?.totalPages, rows: d.list || [] });
  await writeFile(`${OUT}/raw_page${page}.json`, JSON.stringify(j, null, 2), "utf8");
}
await writeFile(`${OUT}/dataset.json`, JSON.stringify(pages, null, 2), "utf8");
const all = pages.flatMap(p => p.rows);
console.log("meta:", JSON.stringify(pages.map(p => ({ page: p.page, code: p.code, total: p.total, totalPages: p.totalPages, rows: p.rows.length }))));
console.log("rows:", all.length, "| status:", [...new Set(all.map(r => r.status))].join(","), "| order30 sum:", all.reduce((s,r)=>s+(Number(r.order_day30)||0),0), "| views sum:", all.reduce((s,r)=>s+(Number(r.views)||0),0), "| stock sum:", all.reduce((s,r)=>s+(Number(r.normal_stock)||0),0));
