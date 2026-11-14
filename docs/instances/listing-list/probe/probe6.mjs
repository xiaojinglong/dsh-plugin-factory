// probe6.mjs —— 试多个 OAuth 应用凭据，找绑定用户 632016（或有权访问）的应用
const TOKEN_URL = 'https://openapi.giikin.com/oauth2/client_token';
const BASE = 'https://openapi.giikin.com/agent/shopee/user/openapi';
const USER_ID = 632016;

const apps = [
  ['rebuild-test', '2019619372320100352', '2mDtGNhSIrKN0RPCdO8FhrwDaQEFR23uy1u9'],
  ['rebuild-prod', '2019247813558472704', '0muvMIFBXbd_5WLoviNw3Sx2jScYtae_iFsl'],
  ['split-generic', '1930185996052803584', 'Jfvi--v0URj4unMU6fcY18s5xJ2TRbIGqy24'],
  ['shopee-app', '1966420876908691456', '43oqQOJQg2kgJOxXtI19YXL9erWRpKIzXgNV'],
  ['other-app', '1981202363756777472', 'V1jwIV7GSgFPnqOZFO_zvue9OvEbsN8an8gL'],
];

for (const [name, id, secret] of apps) {
  let token = '';
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    try { token = JSON.parse(body)?.data?.client_token || ''; } catch {}
    if (!token) { console.log(`\n[${name}] token 失败: ${body.slice(0, 160)}`); continue; }
  } catch (e) { console.log(`\n[${name}] token 异常: ${e.message}`); continue; }

  for (const [ep, body] of [['shop/list', {}], ['listing/listing', { shop_user_id: USER_ID }]]) {
    try {
      const res = await fetch(`${BASE}/${ep}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text();
      console.log(`\n[${name}] ${ep} → ${res.status}\n${text.slice(0, 300)}`);
    } catch (e) { console.log(`\n[${name}] ${ep} 异常: ${e.message}`); }
  }
}
