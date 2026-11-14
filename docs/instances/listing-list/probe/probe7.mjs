// probe7.mjs —— 用 gsmp 登录态（SSO token）直接作为网关凭证
import { readFile } from 'node:fs/promises';

const session = JSON.parse(await readFile('D:/www/dsh-plugin-factory/data/sessions/default.json', 'utf8'));
const cookie = (name) => (session.cookies || []).find((c) => c.name === name)?.value || '';
const token = cookie('token');          // 51c16a...
const userToken = cookie('userToken');  // {%22_user%22:...}
const guardToken = cookie('guard_token');
const phpSession = cookie('PHPSESSID');

console.log('token =', token);
console.log('userToken =', decodeURIComponent(userToken).slice(0, 120));
console.log('guard_token =', guardToken);

const BASE = 'https://openapi.giikin.com/agent/shopee/user/openapi';
const USER_ID = 632016;

const candidates = [
  ['sso token', token],
  ['guard_token', guardToken],
  ['phpsessid', phpSession],
  ['decoded userToken', decodeURIComponent(userToken)],
];

for (const [name, value] of candidates) {
  if (!value) continue;
  for (const [ep, body] of [['shop/list', {}], ['listing/listing', { shop_user_id: USER_ID }]]) {
    try {
      const res = await fetch(`${BASE}/${ep}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${value}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      const text = await res.text();
      console.log(`\n[${name}] ${ep} → ${res.status}\n${text.slice(0, 320)}`);
    } catch (e) {
      console.log(`\n[${name}] ${ep} → ERROR ${e.message}`);
    }
  }
}
