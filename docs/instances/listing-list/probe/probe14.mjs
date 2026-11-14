// probe14.mjs —— 确认过滤参数，抓 2 页真实数据落盘
import { writeFile, mkdir } from 'node:fs/promises';

const KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const URL = 'https://api.giikin.com/agent/shopee/user/openapi/listing/listing';
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const OUT = 'D:/www/dsh-plugin-factory/docs/instances/listing-list/data';
await mkdir(OUT, { recursive: true });

async function fetchPage(body, tag) {
  const res = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  const j = JSON.parse(text);
  const d = j.data || {};
  console.log(`\n[${tag}] http=${res.status} code=${j.code} total=${d.pagination?.total} rows=${(d.list || []).length}`);
  return { j, rows: d.list || [] };
}

// 1) 对比过滤：shop_user_name / user_name / 无过滤
const variants = [
  { shop_user_id: 632016, shop_user_name: '陈雄德', page: 1, pageSize: 20 },
  { shop_user_id: 632016, page: 1, pageSize: 20 },
];
for (const v of variants) {
  const { rows } = await fetchPage(v, JSON.stringify(v));
  if (rows[0]) {
    const r = rows[0];
    console.log('  样例行字段值：', JSON.stringify({
      id: r.id, account_id: r.account_id, shop_user_id: r.shop_user_id, shop_user_name: r.shop_user_name,
      user_id: r.user_id, user_name: r.user_name, status: r.status, site: r.site,
    }));
  }
}

// 2) 抓 2 页（第 2 页 base 不变）
const pages = [];
for (const page of [1, 2]) {
  const { j, rows } = await fetchPage({ shop_user_id: 632016, shop_user_name: '陈雄德', page, pageSize: 20 }, `page ${page}`);
  pages.push({ page, meta: { pagination: j.data?.pagination, userIdArr: j.data?.userIdArr }, rows });
  await writeFile(`${OUT}/raw_page${page}.json`, JSON.stringify(j, null, 2), 'utf8');
}
await writeFile(`${OUT}/dataset.json`, JSON.stringify(pages, null, 2), 'utf8');
const all = pages.flatMap((p) => p.rows);
console.log(`\n落盘完成：2 页共 ${all.length} 条 → ${OUT}/dataset.json`);
console.log('全部字段（', Object.keys(all[0] || {}).length, '）：');
console.log(Object.keys(all[0] || {}).join(', '));
