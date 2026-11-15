#!/usr/bin/env node
'use strict';
/** 停止本机工厂：先停插件，再停 start-factory 记录的控制面 PID */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'platform', 'factory', 'cli.cjs');
const PID_FILE = path.join(ROOT, 'data', 'control-plane', 'server.pid');

const r = spawnSync(process.execPath, [CLI, 'down'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
console.log((r.stdout || '').trim());
if (r.status !== 0) console.error((r.stderr || '').trim());

if (fs.existsSync(PID_FILE)) {
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (pid) { try { process.kill(pid); console.log(`[factory] 控制面已停止 pid=${pid}`); } catch {} }
  try { fs.rmSync(PID_FILE, { force: true }); } catch {}
}
console.log('[factory] 已停止。');
