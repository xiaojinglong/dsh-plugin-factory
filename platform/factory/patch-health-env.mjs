// patch-health-env.mjs —— CLI health 改用 node:http（规避 undici 退出断言）+ 清理 .env 明文凭证
import fs from 'node:fs';
import path from 'node:path';

const R = 'D:/www/dsh-plugin-factory';

/* 1) cli.cjs health() 用 http.get */
let cli = fs.readFileSync(`${R}/platform/factory/cli.cjs`, 'utf8');
const oldHealth = `async function health(port, timeoutMs = 3000) {
  try {
    const res = await fetch(\`http://127.0.0.1:\${port}/health\`, { signal: AbortSignal.timeout(timeoutMs) });
    const j = await res.json();
    return j.ok === true ? j : null;
  } catch { return null; }
}`;
const newHealth = `async function health(port, timeoutMs = 3000) {
  const http = require('node:http');
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { const j = JSON.parse(data); resolve(j.ok === true ? j : null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}`;
if (cli.includes('AbortSignal.timeout(timeoutMs)')) cli = cli.replace(oldHealth, newHealth);
fs.writeFileSync(`${R}/platform/factory/cli.cjs`, cli, 'utf8');

/* 2) 清理 .env 中的明文凭证（已迁移至 DPAPI secrets） */
const SECRET_KEYS = ['LISTING_API_KEY', 'HAINA_EMAIL', 'HAINA_PASSWORD', 'SERVICE_TOKEN', 'WRITE_APPROVAL_TOKEN'];
const envs = [
  'listing-list/service', 'shop-list/service', 'ads-list/service', 'draft-cleanup/service',
  'stock-alert/service', 'haina-comment/service', 'gsmp-academy/service',
];
for (const rel of envs) {
  const f = path.join(R, rel, '.env');
  if (!fs.existsSync(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const kept = lines.filter((l) => {
    const t = l.trim();
    if (!t || t.startsWith('#')) return true;
    const k = t.slice(0, t.indexOf('=')).trim();
    return !SECRET_KEYS.includes(k);
  });
  if (kept.some((l) => l.includes('凭证'))) { /* 保留注释 */ }
  fs.writeFileSync(f, kept.join('\n').replace(/\n+$/, '') + '\n', 'utf8');
}
console.log('cli health patched:', !cli.includes('AbortSignal.timeout(timeoutMs)'));
console.log('env 已清理明文凭证（7 个服务）');
