// probe11.mjs —— dk key（USER 身份）在 Acore 网关上试代理路径
const KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const USER_ID = 632016;
const auth = { authorization: KEY, 'content-type': 'application/json' };
const body = JSON.stringify({ shop_user_id: USER_ID });

const urls = [
  'https://api.giikin.com/acore/agent/shopee/user/openapi/listing/listing',
  'https://api.giikin.com/acore/openapi/agent/shopee/user/openapi/listing/listing',
  'https://api.giikin.com/acore/shopee/user/openapi/listing/listing',
  'https://api.giikin.com/acore/agent/shopee/user/openapi/shop/list',
  'https://api.giikin.com/acore/shopee/user/openapi/shop/list',
];

for (const url of urls) {
  try {
    const res = await fetch(url, { method: 'POST', headers: auth, body, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    console.log(`\n${url} → ${res.status}\n${text.slice(0, 300)}`);
  } catch (e) {
    console.log(`\n${url} → ERROR ${e.message}`);
  }
}
