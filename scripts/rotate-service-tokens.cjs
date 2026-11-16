#!/usr/bin/env node
'use strict';
/**
 * scripts/rotate-service-tokens.cjs —— 轮换插件本地服务 token
 * 用法：node scripts/rotate-service-tokens.cjs [--apply] [--id <id>]
 * 默认 dry-run；--apply 才改文件并重启。
 * 新 token 只写本地工作区，不提交 public 仓库。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const config = require(path.join(__dirname, '..', 'packages', 'config'));
const serviceTokens = require(path.join(__dirname, '..', 'packages', 'service-tokens'));

const ROOT = config.FACTORY_ROOT;
const MANIFESTS = config.MANIFEST_DIR;
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
const apply = args.apply === 'true';
const only = args.id;
const noRestart = args['no-restart'] === 'true';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(ROOT, 'data', 'security', 'token-rotation', stamp);

const files = fs.readdirSync(MANIFESTS).filter((f) => f.endsWith('.json')).sort()
  .map((f) => path.join(MANIFESTS, f))
  .filter((f) => !only || path.basename(f, '.json') === only);
if (!files.length) { console.error(`没有可轮换的 manifest：${only || MANIFESTS}`); process.exit(1); }

const plan = [];
for (const file of files) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!m.runtime?.serviceToken) continue;
  const installed = path.join(ROOT, 'plugins', m.id, 'manifest.json');
  plan.push({ id: m.id, platform: file, installed: fs.existsSync(installed) ? installed : null });
}
if (!plan.length) { console.log('没有带 serviceToken 的插件'); process.exit(0); }
console.log(JSON.stringify({ apply, count: plan.length, ids: plan.map((p) => p.id) }, null, 2));
if (!apply) process.exit(0);

fs.mkdirSync(backup, { recursive: true });
for (const p of plan) {
  const rel = path.relative(ROOT, p.platform);
  const dst = path.join(backup, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(p.platform, dst);
  if (p.installed) {
    const dst2 = path.join(backup, path.relative(ROOT, p.installed));
    fs.mkdirSync(path.dirname(dst2), { recursive: true });
    fs.copyFileSync(p.installed, dst2);
  }
}
if (fs.existsSync(serviceTokens.FILE)) {
  fs.mkdirSync(path.join(backup, 'overlay'), { recursive: true });
  fs.copyFileSync(serviceTokens.FILE, path.join(backup, 'overlay', 'service-tokens.json'));
}
if (fs.existsSync(config.DSH_PATCH)) {
  fs.mkdirSync(path.join(backup, 'profile'), { recursive: true });
  fs.copyFileSync(config.DSH_PATCH, path.join(backup, 'profile', 'cordis.patch.yml'));
}

const nextTokens = {};
for (const p of plan) nextTokens[p.id] = crypto.randomBytes(16).toString('hex');
serviceTokens.setMany(nextTokens);

function run(cmd, cmdArgs, timeout = 300000) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', timeout });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function repair() {
  const r = run(process.execPath, [path.join(ROOT, 'apps', 'installer', 'installer.cjs'), 'repair']);
  if (r.status !== 0) throw new Error(`repair 失败：${r.out.slice(-800)}`);
}
function restart() {
  const down = run(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'down', ...(only ? [only] : [])], 120000);
  if (down.status !== 0) throw new Error(`停止失败：${down.out.slice(-500)}`);
  return (async () => {
    const list = plan.map((p) => serviceTokens.apply(JSON.parse(fs.readFileSync(p.platform, 'utf8'))));
    for (let i = 0; i < 30; i += 1) {
      let upCount = 0;
      for (const m of list) {
        const h = await fetch(`http://127.0.0.1:${m.port}/health`, { signal: AbortSignal.timeout(800) }).catch(() => null);
        if (h && h.ok) upCount += 1;
      }
      if (upCount === 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const up = run(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'up', ...(only ? [only] : [])], 300000);
    if (up.status !== 0) throw new Error(`启动失败：${up.out.slice(-500)}`);
  })();
}
async function status(port, token) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/jobs?limit=1`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(3000) });
    return r.status;
  } catch { return 0; }
}
async function verify() {
  const bad = [];
  for (const p of plan) {
    const m = serviceTokens.apply(JSON.parse(fs.readFileSync(p.platform, 'utf8')));
    let healthy = false;
    let no = 0;
    let yes = 0;
    for (let i = 0; i < 20; i += 1) {
      const h = await fetch(`http://127.0.0.1:${m.port}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
      healthy = !!(h && h.ok);
      if (healthy) {
        no = await status(m.port, '');
        yes = await status(m.port, m.runtime.serviceToken);
        if (no === 401 && yes === 200) break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!healthy) bad.push(`${m.id}:health`);
    else if (no !== 401) bad.push(`${m.id}:no-token=${no}`);
    else if (yes !== 200) bad.push(`${m.id}:token=${yes}`);
  }
  return bad;
}

function restore() {
  for (const p of plan) {
    for (const file of [p.platform, p.installed].filter(Boolean)) {
      const src = path.join(backup, path.relative(ROOT, file));
      if (fs.existsSync(src)) fs.copyFileSync(src, file);
    }
  }
  const overlay = path.join(backup, 'overlay', 'service-tokens.json');
  if (fs.existsSync(overlay)) fs.copyFileSync(overlay, serviceTokens.FILE);
  const patch = path.join(backup, 'profile', 'cordis.patch.yml');
  if (fs.existsSync(patch)) fs.copyFileSync(patch, config.DSH_PATCH);
}

(async () => {
  try {
    repair();
    if (noRestart) {
      console.log(JSON.stringify({ ok: true, rotated: plan.length, backup: path.relative(ROOT, backup), restarted: false }, null, 2));
      console.log('[rotate] 已更新 token/patch；请统一停止/启动服务后运行 verify-service-tokens.cjs');
      return;
    }
    await restart();
    const bad = await verify();
    if (bad.length) throw new Error(`校验失败：${bad.join(', ')}`);
    console.log(JSON.stringify({ ok: true, rotated: plan.length, backup: path.relative(ROOT, backup) }, null, 2));
    console.log('[rotate] 新 token 仅在本地；不要提交 platform/manifests 或 plugins/*/manifest.json');
  } catch (err) {
    console.error(`[rotate] ${err.message}`);
    try { restore(); repair(); await restart(); } catch (e2) { console.error(`[rotate] 回滚失败：${e2.message}`); }
    process.exit(1);
  }
})();
