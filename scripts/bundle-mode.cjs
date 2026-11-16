#!/usr/bin/env node
'use strict';
/**
 * scripts/bundle-mode.cjs —— bundle-managed 生命周期（P3）
 * 用法：
 *   node scripts/bundle-mode.cjs enable --id <id>    # 服务预检 + marker + 移除旧 patch
 *   node scripts/bundle-mode.cjs disable --id <id>   # 恢复旧 patch
 *   node scripts/bundle-mode.cjs status [--json]
 *
 * 注意：bundle 本身必须先用 DSH plugin_manager / Plugins 安装；工厂 CLI 不能调宿主服务。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const config = require(path.join(ROOT, 'packages', 'config'));
const MANIFESTS = path.join(ROOT, 'platform', 'manifests');
const MARKERS = path.join(MANIFESTS, '.bundles');
const CLI = path.join(ROOT, 'platform', 'factory', 'cli.cjs');
const TOOLS = path.join(ROOT, 'deployment', 'tools');
const SKILLS = path.join(ROOT, 'deployment', 'skills');

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
  if (r.status !== 0) throw new Error(`installer repair 失败（exit=${r.status}）`);
}

async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch { return false; }
}

function startService() {
  const r = spawnSync(process.execPath, [CLI, 'up', id], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0) throw new Error(`服务启动失败：${(r.stderr || r.stdout || '').slice(-500)}`);
}

function preflight(m) {
  const tool = path.join(TOOLS, `${id}-mcp`, 'index.js');
  const skill = path.join(SKILLS, id, 'SKILL.md');
  const missing = [];
  if (!fs.existsSync(tool)) missing.push(tool);
  if (!fs.existsSync(skill)) missing.push(skill);
  if (missing.length) throw new Error(`部署文件缺失，请先运行 plugin-install install：\n${missing.join('\n')}`);
  const bundleName = `@local/${id}-mcp-bundle`;
  const profilePkg = path.join(path.dirname(config.DSH_PATCH), 'package.json');
  let installed = false;
  try {
    installed = !!(JSON.parse(fs.readFileSync(profilePkg, 'utf8')).dependencies || {})[bundleName];
  } catch { /* profile package missing */ }
  if (!installed) throw new Error(`bundle 未安装：${bundleName}；请先在 DSH Plugins/plugin_manager 安装，再执行 enable`);
}

if (cmd === 'status') {
  if (!fs.existsSync(MARKERS)) {
    if (args.json === 'true') console.log(JSON.stringify({ bundleManaged: [] }));
    else console.log('bundle-managed: 0');
    process.exit(0);
  }
  const files = fs.readdirSync(MARKERS).filter((f) => f.endsWith('.json'));
  if (args.json === 'true') {
    const rows = files.map((f) => JSON.parse(fs.readFileSync(path.join(MARKERS, f), 'utf8')));
    console.log(JSON.stringify({ bundleManaged: rows }, null, 2));
  } else {
    console.log(`bundle-managed: ${files.length}`);
    for (const f of files) console.log(f.replace(/\.json$/, ''));
  }
  process.exit(0);
}

if (!id || !['enable', 'disable'].includes(cmd)) {
  console.error('用法：bundle-mode enable|disable --id <id> | bundle-mode status [--json]');
  process.exit(1);
}
const manifest = path.join(MANIFESTS, `${id}.json`);
if (!fs.existsSync(manifest)) { console.error(`找不到 manifest：${manifest}`); process.exit(1); }
const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
fs.mkdirSync(MARKERS, { recursive: true });
const marker = path.join(MARKERS, `${id}.json`);

(async () => {
if (cmd === 'enable') {
  try {
    preflight(m);
    if (!(await health(m.port))) {
      console.log(`[bundle-mode] ${id} 服务未运行，启动…`);
      startService();
      if (!(await health(m.port))) throw new Error(`服务启动后仍不健康 :${m.port}`);
    }
    const previous = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null;
    fs.writeFileSync(marker, JSON.stringify({
      id, bundleName: `@local/${id}-mcp-bundle`, serverName: `${id}-bundle`,
      managedAt: new Date().toISOString(),
      note: 'DSH plugin manager owns MCP registration; installer render skips this plugin',
    }, null, 2) + '\n', 'utf8');
    try {
      repair();
      const patch = fs.readFileSync(config.DSH_PATCH, 'utf8');
      if (patch.includes(`- id: mcp-${id}\n`)) throw new Error('patch 仍包含旧条目');
    } catch (err) {
      if (previous === null) fs.rmSync(marker, { force: true });
      else fs.writeFileSync(marker, previous, 'utf8');
      try { repair(); } catch { /* best effort */ }
      throw err;
    }
    console.log(`[bundle-mode] 完成。工具应为 mcp__${id}-bundle__*；旧 mcp__${id}__* 不应存在。`);
  } catch (err) {
    console.error(`[bundle-mode] enable 失败：${err.message}`);
    process.exit(1);
  }
} else {
  try {
    const previous = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null;
    fs.rmSync(marker, { force: true });
    try {
      repair();
    } catch (err) {
      if (previous !== null) fs.writeFileSync(marker, previous, 'utf8');
      try { repair(); } catch { /* best effort */ }
      throw err;
    }
    console.log('[bundle-mode] 已恢复 patch；请卸载对应 bundle，避免重复工具。');
  } catch (err) {
    console.error(`[bundle-mode] disable 失败：${err.message}`);
    process.exit(1);
  }
}
})().catch((err) => {
  console.error(`[bundle-mode] 失败：${err.message}`);
  process.exit(1);
});
