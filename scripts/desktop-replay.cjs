'use strict';
// scripts/desktop-replay.cjs —— 回放录制文件（先校验，再执行）
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadRecording } = require('../packages/recording');

const ROOT = path.resolve(__dirname, '..');
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
const file = args.file ? path.resolve(args.file) : '';
if (!file || !fs.existsSync(file)) {
  console.error('用法：node scripts/desktop-replay.cjs --file data/recordings/x.json [--speed 1] [--dry-run]');
  process.exit(2);
}
const recording = loadRecording(file);
if (args['dry-run'] === 'true') {
  console.log(JSON.stringify({ ok: true, dryRun: true, file, events: recording.events.length, durationMs: recording.durationMs }, null, 2));
  process.exit(0);
}
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const script = path.join(__dirname, 'desktop-replay.ps1');
const r = spawnSync(ps, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-In', file, '-Speed', String(args.speed || 1)], {
  encoding: 'utf8', timeout: 10 * 60 * 1000, windowsHide: true,
});
if (r.status !== 0) {
  console.error(`${r.stdout || ''}${r.stderr || ''}`.slice(-1500));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, file, events: recording.events.length, output: (r.stdout || '').trim() }, null, 2));
