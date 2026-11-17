'use strict';
// scripts/plugin-package-info.cjs —— 查插件包与安装位置
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const registry = require('../packages/plugin-registry');

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
const id = String(args.id || '');
if (!id) {
  console.error('用法：node scripts/plugin-package-info.cjs --id <plugin> [--profile desktop] [--json]');
  process.exit(2);
}
const profile = String(args.profile || process.env.DSH_PROFILE || 'desktop');
const row = registry.latest(id);
if (!row) {
  console.error(`注册表没有插件：${id}`);
  process.exit(1);
}
const hash = row.zip && fs.existsSync(row.zip)
  ? crypto.createHash('sha256').update(fs.readFileSync(row.zip)).digest('hex') : null;
const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const bundle = path.join(local, 'dsh-factory', 'bundles', `${row.id}-${row.version}`);
const profileDir = path.join(os.homedir(), '.dsh', 'profiles', profile);
const out = {
  id: row.id,
  version: row.version,
  requestId: row.requestId,
  zip: row.zip,
  zipExists: !!(row.zip && fs.existsSync(row.zip)),
  sha256: hash,
  generatedDir: row.pluginDir,
  installedCache: bundle,
  installedCacheExists: fs.existsSync(bundle),
  profile: profileDir,
  tools: row.tools,
  installed: row.installed,
};
if (args.json === 'true') console.log(JSON.stringify(out, null, 2));
else {
  console.log(`插件：${out.id}@${out.version}`);
  console.log(`requestId：${out.requestId}`);
  console.log(`zip：${out.zip}`);
  console.log(`zip 存在：${out.zipExists}`);
  console.log(`SHA-256：${out.sha256 || '(zip 不存在)'}`);
  console.log(`生成目录：${out.generatedDir}`);
  console.log(`安装缓存：${out.installedCache}（${out.installedCacheExists ? '存在' : '不存在'}）`);
  console.log(`profile：${out.profile}`);
  console.log(`工具：${(out.tools || []).join(', ') || '(无)'}`);
  console.log('迁移时复制 zip 即可；不要复制安装缓存/profile。');
}
