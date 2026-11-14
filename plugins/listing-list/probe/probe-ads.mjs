// probe-ads.mjs —— 探测 shop/list 分页 & ads/list 参数
const KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const BASE = 'https://api.giikin.com/agent/shopee/user/openapi';
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  return { status: res.status, json: JSON.parse(await res.text()) };
};

// 1) shop/list 2 页
const shops = [];
for (const page of [1, 2]) {
  const { json } = await post(`${BASE}/shop/list`, { user_id: 632016, page, pageSize: 100 });
  const d = json.data || {};
  shops.push(...(d.list || []));
  if (page === 1) console.log('shop/list pagination:', JSON.stringify(d.pagination), '| user_id:', d.user_id, '| first shop keys:', Object.keys(d.list?.[0] || {}).length);
}
console.log('shops rows:', shops.length, '| sites:', JSON.stringify([...new Set(shops.map(s => s.site))].slice(0, 10)));
const shop = shops[0];
console.log('sample shop:', JSON.stringify({ id: shop.id, shop_id: shop.shop_id, account: shop.account, site: shop.site, shop_user_id: shop.shop_user_id, status: shop.status, team: shop.team, store_type: shop.store_type }));

// 2) ads/list 参数变体
const variants = [
  ['shop_id+date_time', { shop_id: String(shop.shop_id || shop.id), date_time: ['2026-11-01', '2026-11-13'], page: 1, pageSize: 10 }],
  ['shop_id+date_from/to', { shop_id: String(shop.shop_id || shop.id), date_from: '2026-11-01', date_to: '2026-11-13', page: 1, pageSize: 10 }],
  ['shop_id only', { shop_id: String(shop.shop_id || shop.id), page: 1, pageSize: 10 }],
  ['account_id', { account_id: shop.id, page: 1, pageSize: 10 }],
];
for (const [label, body] of variants) {
  try {
    const { status, json } = await post(`${BASE}/ads/list`, body);
    const d = json.data || {};
    console.log(`\nads/list ${label} → http=${status} code=${json.code} msg=${(json.message || '').slice(0, 60)}`);
    if (json.code === 200) {
      console.log('  keys:', Object.keys(d).join(','), '| total:', d.total ?? d.pagination?.total, '| rows:', (d.campaigns || d.list || []).length);
      const first = (d.campaigns || d.list || [])[0];
      if (first) console.log('  first:', JSON.stringify(first).slice(0, 400));
    }
  } catch (e) { console.log(`ads/list ${label} → ERROR ${e.message}`); }
}
