// probe5.mjs —— 确认 dk key 在 Acore 侧的有效性，并尝试 /user/openapi 的其它入口
const DKSK_KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const USER_ID = 632016;

async function req(name, url, { method = 'POST', headers = {}, body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    console.log(`\n=== ${name} → ${res.status} ===\n${text.slice(0, 400)}`);
  } catch (e) {
    console.log(`\n=== ${name} → ERROR ${e.message} ===`);
  }
}

const auth = { authorization: DKSK_KEY };
const bearer = { authorization: `Bearer ${DKSK_KEY}` };

// Acore 侧验证 key（POST，正确的 skill open/page 接口）
await req('acore POST skill/open/page', 'https://api.giikin.com/acore/skill/v1/open/page', {
  headers: auth, body: { page: 1, pageSize: 1 },
});

// 网关侧：不带 /agent/shopee 前缀
await req('openapi /user/openapi/listing/listing', 'https://openapi.giikin.com/user/openapi/listing/listing', {
  headers: bearer, body: { shop_user_id: USER_ID },
});
await req('openapi /agent/shopee/user/openapi/listing/listing raw dk', 'https://openapi.giikin.com/agent/shopee/user/openapi/listing/listing', {
  headers: auth, body: { shop_user_id: USER_ID },
});
// 测试环境
await req('openapi-test 静态凭证', 'https://openapi-test.giikin.cn/agent/shopee/user/openapi/listing/listing', {
  headers: bearer, body: { shop_user_id: USER_ID },
});
