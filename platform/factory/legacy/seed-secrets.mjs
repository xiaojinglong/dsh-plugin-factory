// seed-secrets.mjs —— 把现有 .env 中的凭证加密进 DPAPI 存储，并写入每个插件的 SERVICE_TOKEN
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { encryptPlain, decrypt, exists } = require('../runtime/secrets.js');

const ROOT = 'D:/www/dsh-plugin-factory';
const MAN = path.join(ROOT, 'platform', 'manifests');

function readEnv(dir) {
  const f = path.join(dir, '.env');
  const out = {};
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const listingKey = readEnv(path.join(ROOT, 'shop-list', 'service')).LISTING_API_KEY
  || readEnv(path.join(ROOT, 'listing-list', 'service')).LISTING_API_KEY;
const haina = readEnv(path.join(ROOT, 'haina-comment', 'service'));

for (const f of fs.readdirSync(MAN).filter((x) => x.endsWith('.json'))) {
  const m = JSON.parse(fs.readFileSync(path.join(MAN, f), 'utf8'));
  const cur = exists(m.id) ? decrypt(m.id) : {};
  const merged = { ...cur };
  if ((m.secrets || []).includes('LISTING_API_KEY') && listingKey) merged.LISTING_API_KEY = listingKey;
  if ((m.secrets || []).includes('HAINA_EMAIL') && haina.HAINA_EMAIL) merged.HAINA_EMAIL = haina.HAINA_EMAIL;
  if ((m.secrets || []).includes('HAINA_PASSWORD') && haina.HAINA_PASSWORD) merged.HAINA_PASSWORD = haina.HAINA_PASSWORD;
  if (m.runtime?.serviceToken) merged.SERVICE_TOKEN = m.runtime.serviceToken;
  encryptPlain(m.id, JSON.stringify(merged));
  console.log(`${m.id}: ${Object.keys(merged).join(',') || '(空)'}`);
}
