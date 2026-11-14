// probe13.mjs —— 找到 632016 的过滤方式（店铺列表 + listing 过滤参数）
const KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const BASE = 'https://api.giikin.com/agent/shopee/user/openapi';
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const USER_ID = 632016;

async function post(url, body, label) {
  try {
    const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    const d = j?.data || {};
    console.log(`\n=== ${label} → ${res.status} ${j?.code ?? ''} ${(j?.msg || j?.message || '').slice(0, 80)}`);
    if (Array.isArray(d.list)) {
      console.log('  pagination:', JSON.stringify(d.pagination));
      console.log('  listLen:', d.list.length, 'userIdArr:', Array.isArray(d.userIdArr) ? d.userIdArr.length : d.userIdArr, 'user_id:', d.user_id);
      if (d.list[0]) console.log('  first keys:', Object.keys(d.list[0]).join(',').slice(0, 300));
    } else {
      console.log('  data:', text.slice(0, 300));
    }
    return d;
  } catch (e) { console.log(`\n=== ${label} → ERROR ${e.message}`); return null; }
}

// 1) 店铺列表
const shops = await post(`${BASE}/shop/list`, { user_id: USER_ID, page: 1, pageSize: 100 }, 'shop/list user_id=632016');
if (shops?.list?.length) {
  console.log('  前 5 家店:', JSON.stringify(shops.list.slice(0, 5).map((s) => ({
    account_id: s.account_id ?? s.id, shop_id: s.shop_id, shop_user_id: s.shop_user_id, shop_user_name: s.shop_user_name, site: s.site,
  }))));
  const ids = shops.list.map((s) => s.account_id ?? s.id).filter(Boolean).slice(0, 50);
  const shopIds = shops.list.map((s) => s.shop_id).filter(Boolean).slice(0, 50);
  await post(`${BASE}/listing/listing`, { page: 1, pageSize: 5, accountIds: ids }, 'listing accountIds(前50店)');
  await post(`${BASE}/listing/listing`, { page: 1, pageSize: 5, shop_ids: shopIds }, 'listing shop_ids(前50店)');
}

// 2) listing 其它过滤参数
await post(`${BASE}/listing/listing`, { page: 1, pageSize: 5, shop_user_id: USER_ID }, 'listing shop_user_id');
await post(`${BASE}/listing/listing`, { page: 1, pageSize: 5, user_name: '陈雄德' }, 'listing user_name=陈雄德');
await post(`${BASE}/listing/listing`, { page: 1, pageSize: 5, shop_user_name: '陈雄德' }, 'listing shop_user_name');
await post(`${BASE}/listing/listing`, { page: 1, pageSize: 5, is_check_org: false, shop_user_id: USER_ID }, 'listing is_check_org=false');
