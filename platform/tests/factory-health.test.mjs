import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createControlPlane } = require(path.join(ROOT, 'apps', 'control-plane', 'server.cjs'));

test('factory-health：控制面在线时退出码 0', { timeout: 60000 }, async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-health-'));
  const cp = createControlPlane({ dataRoot, token: 'test-token' });
  const { port } = await cp.start({ port: 0 });
  try {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'factory-health.cjs'), '--json'], {
      cwd: ROOT,
      env: {
        ...process.env,
        FACTORY_DATA_ROOT: dataRoot,
        CONTROL_PLANE_URL: `http://127.0.0.1:${port}`,
        CONTROL_PLANE_TOKEN: 'test-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(-1); }, 15000);
      child.on('close', (c) => { clearTimeout(timer); resolve(c); });
    });
    assert.equal(code, 0, `${stdout}\n${stderr}`);
    const out = JSON.parse(stdout);
    assert.equal(out.ok, true);
    assert.equal(out.controlPlane, 'up');
    assert.deepEqual(out.alerts, []);
  } finally {
    await cp.stop().catch(() => {});
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
