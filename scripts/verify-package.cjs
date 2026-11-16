#!/usr/bin/env node
'use strict';
// 公开包静态检查：名称、bundle、README/LICENSE、禁止项
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const dir = path.join(ROOT, 'portable-plugins', 'excel-status-mark');
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const errors = [];
if (pkg.private !== false) errors.push('package.json private 必须为 false');
if (!pkg.dsh?.bundle?.patch) errors.push('缺少 dsh.bundle.patch');
if (!pkg.name || pkg.name.startsWith('@local/')) errors.push('包名仍是 @local');
for (const f of ['README.md', 'LICENSE', pkg.dsh?.bundle?.patch]) {
  if (!fs.existsSync(path.join(dir, f))) errors.push(`缺少 ${f}`);
}
for (const f of ['index.js', 'lib/mark.js', 'cordis.patch.yml']) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  if (/FACTORY_ROOT|serviceToken|DPAPI|\b[A-Za-z]:[\\/](?![\\/])/.test(text)) errors.push(`${f} 含禁止项`);
}
console.log(JSON.stringify({ ok: errors.length === 0, name: pkg.name, version: pkg.version, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
