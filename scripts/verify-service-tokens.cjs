#!/usr/bin/env node
'use strict';
// scripts/verify-service-tokens.cjs —— 校验所有插件的健康 + 401/200
const fs = require('node:fs');
const path = require('node:path');
const config = require(path.join(__dirname, '..', 'packages', 'config'));

async function status(port, token) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/jobs?limit=1`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(3000) });
    return r.status;
  } catch { return 0; }
}
(async () => {
  const dir = config.MANIFEST_DIR;
  const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const bad = [];
  for (const m of rows) {
    if (!m.runtime?.serviceToken) continue;
    const h = await fetch(`http://127.0.0.1:${m.port}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (!h || !h.ok) { bad.push(`${m.id}:health`); continue; }
    const no = await status(m.port, '');
    const yes = await status(m.port, m.runtime.serviceToken);
    if (no !== 401) bad.push(`${m.id}:no-token=${no}`);
    if (yes !== 200) bad.push(`${m.id}:token=${yes}`);
  }
  console.log(JSON.stringify({ ok: bad.length === 0, checked: rows.filter((m) => m.runtime?.serviceToken).length, bad }, null, 2));
  process.exit(bad.length ? 1 : 0);
})();
