#!/usr/bin/env node
'use strict';
/**
 * scripts/bundle-mode.cjs —— 将插件标记为 bundle-managed；render 不再写它的 patch
 * 用法：
 *   node scripts/bundle-mode.cjs enable --id <id>   # 先安装 bundle，再执行
 *   node scripts/bundle-mode.cjs disable --id <id>  # 卸载 bundle 后恢复 patch
 *   node scripts/bundle-mode.cjs status
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFESTS = path.join(ROOT, 'platform', 'manifests');
const MARKERS = path.join(MANIFESTS, '.bundles');
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
const cmd = process.argv[2];
const id = args.id;

function repair() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'installer', 'installer.cjs'), 'repair'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) process.exit(r.status || 1);
}

if (cmd === 'status') {
  if (!fs.existsSync(MARKERS)) { console.log('bundle-managed: 0'); process.exit(0); }
  const files = fs.readdirSync(MARKERS).filter((f) => f.endsWith('.json'));
  console.log(`bundle-managed: ${files.length}`);
  for (const f of files) console.log(f.replace(/\.json$/, ''));
  process.exit(0);
}

if (!id || !['enable', 'disable'].includes(cmd)) {
  console.error('用法：bundle-mode enable|disable --id <id> | bundle-mode status');
  process.exit(1);
}
const manifest = path.join(MANIFESTS, `${id}.json`);
if (!fs.existsSync(manifest)) { console.error(`找不到 manifest：${manifest}`); process.exit(1); }
fs.mkdirSync(MARKERS, { recursive: true });
const marker = path.join(MARKERS, `${id}.json`);

if (cmd === 'enable') {
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  fs.writeFileSync(marker, JSON.stringify({
    id, bundleName: `@local/${id}-mcp-bundle`, serverName: `${id}-bundle`,
    managedAt: new Date().toISOString(), note: 'DSH plugin manager owns MCP registration; installer render skips this plugin',
  }, null, 2) + '\n', 'utf8');
  console.log(`[bundle-mode] ${id} 已标记为 bundle-managed；开始移除旧 patch 条目`);
  repair();
  console.log(`[bundle-mode] 完成。请确认 DSH 中只有 bundle 工具（mcp__${id}-bundle__*），不要再保留 mcp__${id}__*。`);
} else {
  if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });
  console.log(`[bundle-mode] ${id} 已恢复 patch 管理；开始重新注入`);
  repair();
  console.log('[bundle-mode] 完成。请卸载对应 bundle，避免重复工具。');
}
