// release-install.test.mjs —— M5 从发布包安装（校验+安全解包）
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { packageRelease } = require('../../scripts/package-release.cjs');
const { installFromRelease, assertSafeEntries } = require('../../scripts/install-from-release.cjs');

test('install-from-release：校验后解包到目标目录；不安全路径拒绝', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-rel-inst-'));
  packageRelease({ outDir: dist });
  const target = path.join(dist, 'installed');
  const r = installFromRelease({ releaseDir: dist, to: target });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(target, 'package.json')));
  assert.ok(fs.existsSync(path.join(target, 'apps', 'control-plane', 'server.cjs')));
  assert.match(r.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => assertSafeEntries(['/etc/passwd']), /不安全/);
  assert.throws(() => assertSafeEntries(['../../evil']), /不安全/);
});
