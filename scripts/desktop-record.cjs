'use strict';
// scripts/desktop-record.cjs —— 录制鼠标/键盘事件到 JSON
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateRecording, saveRecording } = require('../packages/recording');

const ROOT = path.resolve(__dirname, '..');
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
const seconds = Math.max(1, Math.min(300, Number(args.seconds) || 20));
const name = String(args.name || `recording-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`);
const out = path.resolve(args.out || path.join(ROOT, 'data', 'recordings', `${name}.json`));
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const script = path.join(__dirname, 'desktop-record.ps1');
fs.mkdirSync(path.dirname(out), { recursive: true });
console.log(`[record] 开始录制 ${seconds}s；结束后写入 ${out}`);
const r = spawnSync(ps, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-DurationSeconds', String(seconds), '-Out', out, '-Name', name], {
  encoding: 'utf8', timeout: (seconds + 30) * 1000, windowsHide: true,
});
if (r.status !== 0) {
  console.error(`${r.stdout || ''}${r.stderr || ''}`.slice(-1500));
  process.exit(1);
}
const raw = fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, '');
const recording = JSON.parse(raw);
const v = validateRecording(recording);
if (!v.ok) {
  console.error(`录制文件非法：${v.errors.join('; ')}`);
  process.exit(1);
}
saveRecording(out, recording);
console.log(JSON.stringify({ ok: true, file: out, events: recording.events.length, window: recording.window }, null, 2));
