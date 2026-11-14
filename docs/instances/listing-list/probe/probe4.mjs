// probe4.mjs —— 穷举静态凭证的传法（目标：让 /user/openapi/shop/list 返回 user_id=632016 或 userIdArr 授权）
const SHOPLIST = 'https://openapi.giikin.com/agent/shopee/user/openapi/shop/list';
const DKSK_KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const USER_ID = 632016;

const variants = [
  ['x-auth-key', { 'x-auth-key': DKSK_KEY }],
  ['x-api-key', { 'x-api-key': DKSK_KEY }],
  ['x-acore-key', { 'x-acore-key': DKSK_KEY }],
  ['x-dk-key', { 'x-dk-key': DKSK_KEY }],
  ['authkey', { authkey: DKSK_KEY }],
  ['token', { token: DKSK_KEY }],
  ['x-token', { 'x-token': DKSK_KEY }],
  ['api-key', { 'api-key': DKSK_KEY }],
  ['x-client-key', { 'x-client-key': DKSK_KEY }],
  ['authorization 原样', { authorization: DKSK_KEY }],
  ['authorization Bearer', { authorization: `Bearer ${DKSK_KEY}` }],
  ['authorization Basic b64', { authorization: `Basic ${Buffer.from(DKSK_KEY).toString('base64')}` }],
  ['authorization App', { authorization: `App ${DKSK_KEY}` }],
  ['authorization app-key', { authorization: `app-key ${DKSK_KEY}` }],
];

for (const [name, headers] of variants) {
  try {
    const res = await fetch(SHOPLIST, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ user_id: USER_ID }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    console.log(`${name} → ${res.status} ${text.slice(0, 220).replace(/\n/g, ' ')}`);
  } catch (e) {
    console.log(`${name} → ERROR ${e.message}`);
  }
}

// 查询参数方式
for (const qs of ['authKey', 'access_token', 'token', 'api_key', 'app_key']) {
  try {
    const res = await fetch(`${SHOPLIST}?${qs}=${encodeURIComponent(DKSK_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: USER_ID }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    console.log(`query ${qs} → ${res.status} ${text.slice(0, 220).replace(/\n/g, ' ')}`);
  } catch (e) {
    console.log(`query ${qs} → ERROR ${e.message}`);
  }
}
