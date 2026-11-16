// export-mcp-bundle.test.mjs —— bundle 包结构/唯一 serverName 校验
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('export-mcp-bundle：单插件生成标准 MCP bundle', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-bundle-')), 'git-flow-audit');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'export-mcp-bundle.cjs'), '--id', 'git-flow-audit', '--server-name', 'git-flow-audit-test', '--out', out], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const pkg = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  const patch = fs.readFileSync(path.join(out, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /serverName: "git-flow-audit-test"/);
  assert.match(patch, /@deepseek-ai\/dsh-mcp-client/);
  assert.ok(fs.existsSync(path.join(out, 'locale', 'en.json')));
  assert.ok(fs.existsSync(path.join(out, 'icon.svg')));
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
});
