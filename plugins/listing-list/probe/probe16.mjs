// probe16.mjs —— 找 status 枚举值 & 排序参数
const KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const URL = 'https://api.giikin.com/agent/shopee/user/openapi/listing/listing';
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const base = { page: 1, pageSize: 20, shop_user_id: 632016, shop_user_name: '陈雄德' };

async function t(label, add) {
  try {
    const res = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify({ ...base, ...add }), signal: AbortSignal.timeout(30000) });
    const j = JSON.parse(await res.text());
    const d = j.data || {};
    const rows = d.list || [];
    console.log(`${label} → code=${j.code} total=${d.pagination?.total} rows=${rows.length}${j.code !== 200 ? ' msg=' + (j.message || '').slice(0, 50) : ''}`);
    if (rows.length) console.log('   status:', [...new Set(rows.map((x) => x.status))].join(','), '| order30:', rows.slice(0, 8).map((x) => x.order_day30).join(','));
  } catch (e) { console.log(`${label} → ERROR ${e.message}`); }
}

for (const s of ['1', '2', '3', '4', '0', 'PUBLISHED', 'ON_SALE', 'NORMAL', 'ACTIVE', 'SALE', 'ONLINE_SALE', 'OFFLINE', 'PENDING']) {
  await t(`status=${s}`, { status: s });
}

await t('sort order_day30 desc', { order_day30: 'desc' });
await t('sort order_count desc', { order_count: 'desc' });
await t('sort update_time desc', { update_time: 'desc' });
await t('sort create_time desc', { create_time: 'desc' });
await t('sort_type "1"', { sort_type: '1' });
await t('sortBy/order', { sortBy: 'order_day30', order: 'desc' });
