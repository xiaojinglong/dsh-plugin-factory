// render-patch.test.mjs —— 回归：render 的 YAML 路径必须是正斜杠（否则 DSH 解析失败）
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../../packages/config');
const ROOT = config.FACTORY_ROOT;

test('render：Windows 路径写成正斜杠，YAML 可被 DSH 解析', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-render-'));
  const patch = path.join(t, 'cordis.patch.yml');
  const tools = path.join(ROOT, 'deployment', 'tools');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'render'], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, FACTORY_DSH_PATCH: patch, FACTORY_DSH_TOOLS: tools, FACTORY_DSH_REGISTRY: path.join(t, 'registry.md') },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = fs.readFileSync(patch, 'utf8');
  assert.match(text, /args: \["[A-Za-z]:\/[^"]*\/tools\/[^"]+"/);
  assert.ok(!/args: \["[A-Za-z]:\\/.test(text), 'YAML 双引号内不得出现 Windows 反斜杠路径');
  assert.ok(!/cwd: "[A-Za-z]:\\/.test(text), 'YAML 双引号内不得出现 Windows 反斜杠路径');
  assert.match(text, /serverName: /);
});
