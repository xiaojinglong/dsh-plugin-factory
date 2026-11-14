// probe15.mjs —— 逐个参数隔离，找安全过滤（在线商品）
const KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const URL = 'https://api.giikin.com/agent/shopee/user/openapi/listing/listing';
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const base = { page: 1, pageSize: 20, shop_user_id: 632016, shop_user_name: '陈雄德' };

const extra = [
  ['status:1', { status: 1 }],
  ['status:"ONLINE"', { status: 'ONLINE' }],
  ['shop_status:1', { shop_status: 1 }],
  ['sort_type:1', { sort_type: 1 }],
  ['is_check_org:true', { is_check_org: true }],
  ['no_stock:0', { no_stock: 0 }],
  ['pageSize:100', { pageSize: 100 }],
];

for (const [label, add] of extra) {
  try {
    const res = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify({ ...base, ...add }), signal: AbortSignal.timeout(30000) });
    const j = JSON.parse(await res.text());
    const d = j.data || {};
    console.log(`${label} → http=${res.status} code=${j.code} total=${d.pagination?.total} rows=${(d.list || []).length}${j.code !== 200 ? ' msg=' + (j.message || '').slice(0, 60) : ''}`);
    if (j.code === 200 && d.list?.[0]) console.log('   status样本:', d.list.slice(0, 5).map((x) => x.status).join(','), '| order30:', d.list.slice(0, 5).map((x) => x.order_day30).join(','));
  } catch (e) { console.log(`${label} → ERROR ${e.message}`); }
}
