#!/usr/bin/env node
'use strict';
/**
 * scripts/start-factory.cjs —— 一键启动控制面 + 全部插件服务
 * 用法：双击 start-factory.cmd，或 `npm start`
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CP = path.join(ROOT, 'apps', 'control-plane', 'server.cjs');
const CLI = path.join(ROOT, 'platform', 'factory', 'cli.cjs');
const PID_FILE = path.join(ROOT, 'data', 'control-plane', 'server.pid');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function health() {
  try {
    const r = await fetch('http://127.0.0.1:8780/health', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

(async () => {
  console.log('[factory] 启动中...');
  if (!(await health())) {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    const child = spawn(process.execPath, [CP], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
    let ok = false;
    for (let i = 0; i < 20; i += 1) { await sleep(500); if (await health()) { ok = true; break; } }
    if (!ok) { console.error('[factory] 控制面启动失败：8780 未就绪'); process.exit(1); }
    console.log('[factory] 控制面已启动 :8780');
  } else {
    console.log('[factory] 控制面已在运行 :8780');
  }

  const up = spawnSync(process.execPath, [CLI, 'up'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const lines = `${up.stdout || ''}\n${up.stderr || ''}`.trim().split(/\r?\n/).filter(Boolean);
  for (const line of lines) console.log(line);
  if (up.status !== 0) { console.error('[factory] 插件服务启动失败'); process.exit(1); }

  let plugins = 0;
  try { plugins = fs.readdirSync(path.join(ROOT, 'platform', 'manifests')).filter((f) => f.endsWith('.json')).length; } catch {}
  console.log('');
  console.log(`[factory] 就绪：${plugins} 个插件，控制面 http://127.0.0.1:8780`);
  console.log('[factory] 现在重开 DSH，直接对 AI 说你要做什么即可。');
})();
