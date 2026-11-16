'use strict';
// scripts/catalog-install.cjs —— 从本地/URL 目录选择插件，校验 SHA-256 后安装
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { findPlugin } = require('../packages/catalog');

const ROOT = path.resolve(__dirname, '..');
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
const id = String(args.id || '');
const source = String(args.catalog || path.join(ROOT, 'catalog', 'plugins.json'));
const isUrl = /^https?:\/\//i.test(source);
if (!id) {
  console.error('用法：node scripts/catalog-install.cjs --id <plugin> [--catalog <file|url>] [--dry-run]');
  process.exit(2);
}
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
async function loadCatalog() {
  if (isUrl) {
    const r = await fetch(source, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`目录 HTTP ${r.status}`);
    return r.json();
  }
  if (!fs.existsSync(source)) throw new Error(`目录不存在：${source}（先运行 npm run catalog）`);
  return JSON.parse(fs.readFileSync(source, 'utf8'));
}
(async () => {
  let tmp = '';
  try {
    const catalog = await loadCatalog();
    const entry = findPlugin(catalog, id);
    if (!entry) throw new Error(`插件不在目录中：${id}`);
    let zip = entry.zip;
    let buffer = null;
    if (isUrl) {
      const zipUrl = new URL(zip, source).href;
      const r = await fetch(zipUrl, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`zip HTTP ${r.status}`);
      buffer = Buffer.from(await r.arrayBuffer());
      if (entry.sha256 && sha(buffer) !== entry.sha256) throw new Error('SHA-256 校验失败');
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-catalog-'));
      zip = path.join(tmp, `${id}-${entry.version}.zip`);
      fs.writeFileSync(zip, buffer);
    } else if (!fs.existsSync(zip)) {
      throw new Error(`zip 不存在：${zip}`);
    } else if (entry.sha256 && sha(fs.readFileSync(zip)) !== entry.sha256) {
      throw new Error('SHA-256 校验失败');
    }
    const result = { ok: true, id, version: entry.version, zip, source, sha256: entry.sha256, dryRun: args['dry-run'] === 'true' };
    if (result.dryRun) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const profile = String(args.profile || process.env.DSH_PROFILE || 'desktop');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dsh-factory.cjs'), 'install', zip, '--profile', profile], {
      cwd: ROOT, encoding: 'utf8', timeout: 300000, env: { ...process.env },
    });
    result.installed = r.status === 0;
    result.output = `${r.stdout || ''}${r.stderr || ''}`.slice(-1000);
    console.log(JSON.stringify(result, null, 2));
    if (!result.installed) process.exitCode = 1;
  } catch (e) {
    console.error(JSON.stringify({ ok: false, id, source, error: e.message }, null, 2));
    process.exitCode = 1;
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
