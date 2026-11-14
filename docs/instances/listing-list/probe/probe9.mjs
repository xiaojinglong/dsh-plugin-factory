// probe9.mjs —— 网关 realUser / scope 传参探索
const BASE = 'https://openapi.giikin.com/agent/shopee/user/openapi';
const TOKEN_URL = 'https://openapi.giikin.com/oauth2/client_token';
const CLIENT_ID = '2019247813558472704';
const CLIENT_SECRET = '0muvMIFBXbd_5WLoviNw3Sx2jScYtae_iFsl';
const USER_ID = 632016;

async function token(extra = {}) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...extra }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  try { return JSON.parse(body)?.data?.client_token || ''; } catch { return ''; }
}

const tok = await token();
console.log('token ok:', !!tok);
if (!tok) process.exit(0);
const auth = { authorization: `Bearer ${tok}` };

async function tryIt(label, headers = {}, body = {}) {
  try {
    const res = await fetch(`${BASE}/shop/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth, ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    console.log(`\n${label} → ${res.status}\n${text.slice(0, 260)}`);
  } catch (e) { console.log(`\n${label} → ERROR ${e.message}`); }
}

await tryIt('基线');
await tryIt('X-Real-User-Id', { 'x-real-user-id': String(USER_ID) });
await tryIt('Real-User-Id', { 'real-user-id': String(USER_ID) });
await tryIt('X-User-Id', { 'x-user-id': String(USER_ID) });
await tryIt('gk-real-user(base64 json)', { 'gk-real-user': Buffer.from(JSON.stringify({ id: USER_ID })).toString('base64') });
await tryIt('body real_user_id', {}, { real_user_id: USER_ID });
await tryIt('body user_id', {}, { user_id: USER_ID });
await tryIt('body shop_user_id', {}, { shop_user_id: USER_ID });

// scope 变体
for (const scope of [`user:${USER_ID}`, String(USER_ID)]) {
  const t2 = await token({ scope });
  if (!t2) { console.log(`\nscope=${scope} → token 获取失败`); continue; }
  try {
    const res = await fetch(`${BASE}/shop/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t2}` },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    });
    console.log(`\nscope=${scope} → ${res.status}\n${(await res.text()).slice(0, 260)}`);
  } catch (e) { console.log(`\nscope=${scope} → ERROR ${e.message}`); }
}
