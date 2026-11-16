import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDING = path.join(HERE, '..', 'recordings', 'flow.json');
const REPLAY_PS1 = path.join(HERE, 'desktop-replay.ps1');

export function loadRecording() {
  return JSON.parse(fs.readFileSync(RECORDING, 'utf8'));
}

export async function replayRecording(options = {}) {
  return runPowerShell(REPLAY_PS1, ['-In', RECORDING, '-Speed', String(options.speed || 1)], options);
}

export function runPowerShell(scriptPath, args = [], options = {}) {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(ps, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
      windowsHide: true, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('PowerShell timeout')); }, options.timeoutMs || 180000);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`PowerShell exit=${code}: ${(out + err).slice(-500)}`));
    });
  });
}
