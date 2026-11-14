// probe.mjs —— 探测 openapi.giikin.com 的鉴权方式与响应结构
import { readFile } from 'node:fs/promises';

const AUTH = JSON.parse(await readFile('D:/www/dsh-plugin-factory/.acore/auth.json', 'utf8'));
const KEY = AUTH.authKey;
const URL_API = 'https://openapi.giikin.com/agent/shopee/user/openapi/listing/listing';
const BODY = { shop_user_id: 632016 };

const variants = [
  { name: 'Authorization: Bearer', headers: { authorization: `Bearer ${KEY}` } },
  { name: 'Authorization: 原样', headers: { authorization: KEY } },
  { name: 'x-auth-key', headers: { 'x-auth-key': KEY } },
  { name: 'x-api-key', headers: { 'x-api-key': KEY } },
  { name: 'auth-key', headers: { 'auth-key': KEY } },
  { name: '无鉴权头', headers: {} },
];

for (const v of variants) {
  try {
    const res = await fetch(URL_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...v.headers },
      body: JSON.stringify(BODY),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    console.log(`\n=== ${v.name} → HTTP ${res.status} ===`);
    console.log('headers:', JSON.stringify(Object.fromEntries([...res.headers].filter(([k]) => /auth|token|key/i.test(k)))));
    console.log('body:', text.slice(0, 400));
  } catch (err) {
    console.log(`\n=== ${v.name} → ERROR: ${err.message}`);
  }
}
