// probe3.mjs —— 验证用户上下文如何传给 /user/openapi
const LISTING = 'https://openapi.giikin.com/agent/shopee/user/openapi/listing/listing';
const SHOPLIST = 'https://openapi.giikin.com/agent/shopee/user/openapi/shop/list';
const TOKEN_URL = 'https://openapi.giikin.com/oauth2/client_token';
const ACORE = 'https://api.giikin.com/acore/skill/v1/open/page?page=1&pageSize=1';

const CLIENT_ID = '2019247813558472704';
const CLIENT_SECRET = '0muvMIFBXbd_5WLoviNw3Sx2jScYtae_iFsl';
const DKSK_KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const USER_ID = 632016;

async function req(name, url, { method = 'POST', headers = {}, body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    console.log(`\n=== ${name} → HTTP ${res.status} ===\n${text.slice(0, 600)}`);
    return text;
  } catch (e) {
    console.log(`\n=== ${name} → ERROR ${e.message} ===`);
    return '';
  }
}

// 0) Acore 验证 dk key 是否有效
await req('Acore open/page（dk key）', ACORE, { method: 'GET', headers: { authorization: DKSK_KEY } });

// 1) 换 client_token
let token = '';
try {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    signal: AbortSignal.timeout(20000),
  });
  token = JSON.parse(await res.text())?.data?.client_token || '';
  console.log(`\nclient_token = ${token}`);
} catch (e) { console.log('token error', e.message); }
if (!token) process.exit(0);

const auth = { authorization: `Bearer ${token}` };
const gkUser = Buffer.from(JSON.stringify({ id: USER_ID, name: '丁月', account: 'dingyue' })).toString('base64');

// 2) 用户上下文变体
await req('listing + body user_id', LISTING, { headers: auth, body: { user_id: USER_ID } });
await req('listing + body shop_user_id + user_id', LISTING, { headers: auth, body: { shop_user_id: USER_ID, user_id: USER_ID } });
await req('listing + gk-service-user 头', LISTING, { headers: { ...auth, 'gk-service-user': gkUser }, body: { shop_user_id: USER_ID } });
await req('listing + gk-service-user 头 + 无 body', LISTING, { headers: { ...auth, 'gk-service-user': gkUser }, body: {} });
await req('shop/list（client_token）', SHOPLIST, { headers: auth, body: {} });
await req('shop/list + gk-service-user', SHOPLIST, { headers: { ...auth, 'gk-service-user': gkUser }, body: {} });
