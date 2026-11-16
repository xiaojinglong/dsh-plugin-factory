import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('公开包元数据与禁止项检查', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-package.cjs')], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'portable-plugins', 'excel-status-mark', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-plugin-excel-status-mark');
  assert.equal(pkg.private, false);
  assert.ok(pkg.files.includes('README.md'));
});
