import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('dsh-factory 无参数时输出用法并非零退出', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dsh-factory.cjs')], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /install <zip/);
});
