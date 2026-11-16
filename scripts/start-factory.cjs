#!/usr/bin/env node
'use strict';
/**
 * scripts/start-factory.cjs —— 平滑启动/重启工厂
 * 默认：只启动控制面，不启动 30 个测试插件。
 * 用法：
 *   node scripts/start-factory.cjs                 # 控制面（重启）
 *   node scripts/start-factory.cjs --with-plugins  # 控制面 + 30 个测试插件
 *   node scripts/start-factory.cjs --no-restart    # 只在未运行时启动
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CP = path.join(ROOT, 'apps', 'control-plane', 'server.cjs');
const CLI = path.join(ROOT, 'platform', 'factory', 'cli.cjs');
const PID_FILE = path.join(ROOT, 'data', 'control-plane', 'server.pid');

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
const withPlugins = args['with-plugins'] === 'true' || args.all === 'true';
const noRestart = args['no-restart'] === 'true';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function health() {
  try {
    const r = await fetch('http://127.0.0.1:8780/health', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}
function readPid() {
  try { return Number(fs.readFileSync(PID_FILE, 'utf8').trim()) || 0; } catch { return 0; }
}
async function stopControl() {
  let pid = readPid();
  if (!pid && !(await health())) return;
  if (pid) {
    try { process.kill(pid); console.log(`[factory] 停止旧控制面 pid=${pid}`); } catch { /* ignore */ }
  }
  for (let i = 0; i < 30; i += 1) {
    await sleep(300);
    if (!(await health())) break;
  }
  if (await health()) {
    if (process.platform === 'win32' && pid) {
      spawnSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
      for (let i = 0; i < 20; i += 1) { await sleep(250); if (!(await health())) break; }
    }
  }
  if (await health()) {
    console.error('[factory] 控制面仍在运行，拒绝重复启动');
    process.exit(1);
  }
  try { fs.rmSync(PID_FILE, { force: true }); } catch { /* ignore */ }
}
function stopPlugins() {
  const r = spawnSync(process.execPath, [CLI, 'down'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) {
    console.error('[factory] 停止测试插件失败');
    console.error(`${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/).slice(-5).join('\n'));
    return false;
  }
  return true;
}
async function startControl() {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  const child = spawn(process.execPath, [CP], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    if (await health()) {
      console.log(`[factory] 控制面已启动 :8780 pid=${child.pid}`);
      return true;
    }
  }
  console.error('[factory] 控制面启动失败：8780 未就绪');
  return false;
}
function backup() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ops-backup.cjs')], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (r.status === 0) {
    try {
      const info = JSON.parse((r.stdout || '').trim().split(/\r?\n/).pop());
      console.log(`[factory] 已备份控制面：${info.path}`);
    } catch { console.log('[factory] 控制面备份完成'); }
  } else console.log('[factory] 警告：控制面备份失败（不影响启动）');
}

(async () => {
  console.log(`[factory] 平滑重启${withPlugins ? '（控制面 + 测试插件）' : '（仅控制面）'}`);
  if (withPlugins) stopPlugins();
  else stopPlugins(); // 默认也停掉旧的 30 个测试插件，避免加载它们

  if (!noRestart) await stopControl();
  if (!(await health())) {
    if (!(await startControl())) process.exit(1);
  } else {
    console.log('[factory] 控制面已在运行（--no-restart）');
  }

  backup();

  if (withPlugins) {
    const up = spawnSync(process.execPath, [CLI, 'up'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    const lines = `${up.stdout || ''}\n${up.stderr || ''}`.trim().split(/\r?\n/).filter(Boolean);
    for (const line of lines) console.log(line);
    if (up.status !== 0) { console.error('[factory] 测试插件启动失败'); process.exit(1); }
    console.log('[factory] 就绪：控制面 + 30 个测试插件');
  } else {
    console.log('[factory] 就绪：控制面 http://127.0.0.1:8780');
    console.log('[factory] 30 个测试插件未启动；需要时使用 start-factory.cmd --with-plugins');
  }
  console.log('[factory] 现在重开 DSH，对 AI 说你要做什么即可。');
})();
