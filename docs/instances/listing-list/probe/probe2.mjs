// probe2.mjs —— 用网关 OAuth2 client_token 与静态凭证变体测试 listing 接口
const LISTING = 'https://openapi.giikin.com/agent/shopee/user/openapi/listing/listing';
const TOKEN_URL = 'https://openapi.giikin.com/oauth2/client_token';

// 生产凭据（来源：rebuild-shopee/config/autoload/manage_openapi.php，prod 分支）
const CLIENT_ID = '2019247813558472704';
const CLIENT_SECRET = '0muvMIFBXbd_5WLoviNw3Sx2jScYtae_iFsl';
const DKSK_KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';

const body = JSON.stringify({ shop_user_id: 632016 });

async function call(name, headers, opts = {}) {
  try {
    const res = await fetch(LISTING, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: opts.form ? new URLSearchParams({ shop_user_id: '632016' }) : body,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    console.log(`\n=== ${name} → HTTP ${res.status} ===`);
    console.log(text.slice(0, 500));
    return { status: res.status, text };
  } catch (e) {
    console.log(`\n=== ${name} → ERROR ${e.message} ===`);
    return null;
  }
}

// 1) 换 OAuth2 token
let token = '';
try {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  console.log(`=== client_token → HTTP ${res.status} ===\n${text.slice(0, 400)}`);
  try { token = JSON.parse(text)?.data?.client_token || ''; } catch {}
} catch (e) {
  console.log('=== client_token ERROR ===', e.message);
}

if (token) {
  await call('Bearer <client_token>', { authorization: `Bearer ${token}` });
  await call('Bearer <client_token> (form)', { authorization: `Bearer ${token}` }, { form: true });
}
await call('静态凭证 client_id:client_secret', { authorization: `${CLIENT_ID}:${CLIENT_SECRET}` });
await call('Basic base64', { authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}` });
await call('dksk key Bearer', { authorization: `Bearer ${DKSK_KEY}` });
await call('dksk key 原样', { authorization: DKSK_KEY });
