// release.test.mjs —— 发布包（npm tarball + SHA-256）冒烟
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { packageRelease, SENSITIVE } = require('../../scripts/package-release.cjs');

test('release：npm pack 产出 tarball + sha256，且不含敏感路径', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-rel-'));
  const r = packageRelease({ outDir });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(r.path));
  assert.match(r.sha256, /^[a-f0-9]{64}$/);
  assert.ok(r.files > 100);
  const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'release.json'), 'utf8'));
  assert.equal(meta.sha256, r.sha256);
  assert.ok(!SENSITIVE.some((re) => re.test('templates/plugin/service/.env.tmpl')), '.env 模板不应被当作敏感文件');
  assert.ok(SENSITIVE.some((re) => re.test('service/.env')), '.env 应被拦截');
  assert.ok(SENSITIVE.some((re) => re.test('platform/secrets/a.enc')), 'secrets 应被拦截');
});
