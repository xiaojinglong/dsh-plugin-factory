// probe12.mjs —— 正确主机 api.giikin.com + dk key Bearer
const KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const URL = 'https://api.giikin.com/agent/shopee/user/openapi/listing/listing';
const USER_ID = 632016;

async function call(name, body) {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    console.log(`\n=== ${name} → HTTP ${res.status} ===`);
    console.log(text.slice(0, 700));
    try {
      const j = JSON.parse(text);
      const d = j.data || {};
      console.log('summary:', JSON.stringify({
        code: j.code, msg: j.msg || j.message, pagination: d.pagination,
        listLen: Array.isArray(d.list) ? d.list.length : undefined,
        userIdArr: d.userIdArr, realUser: d.realUser,
      }));
      const first = Array.isArray(d.list) ? d.list[0] : null;
      if (first) console.log('first row keys:', Object.keys(first).join(', ').slice(0, 800));
    } catch {}
  } catch (e) {
    console.log(`\n=== ${name} → ERROR ${e.message} ===`);
  }
}

await call('最小参数', { page: 1, pageSize: 5, shop_user_id: USER_ID });
await call('带分页', { page: 1, pageSize: 10, shop_user_id: USER_ID, sort_type: 1, shop_status: 1, status: 1, is_check_org: true });
await call('仅分页（不带 shop_user_id）', { page: 1, pageSize: 5 });
