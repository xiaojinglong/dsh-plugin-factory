import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { generatePortable, validatePortable } = require(path.join(ROOT, 'apps', 'generator', 'portable.cjs'));

test('portable-host 生成器：标准 bundle + 校验通过', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-gen-')), 'demo-portable');
  generatePortable({
    id: 'demo-portable', name: 'Demo Portable', out,
    fixture: path.join(ROOT, 'scenarios', 'api-status-mark', 'fixture.json'),
    description: 'Demo generated portable plugin',
  });
  assert.ok(fs.existsSync(path.join(out, 'package.json')));
  assert.ok(fs.existsSync(path.join(out, 'cordis.patch.yml')));
  assert.ok(fs.existsSync(path.join(out, 'skills', 'demo-portable', 'SKILL.md')));
  const v = await validatePortable(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const pkg = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-plugin-demo-portable');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.match(fs.readFileSync(path.join(out, 'index.js'), 'utf8'), /ctx\.skills\.register/);
  assert.match(fs.readFileSync(path.join(out, 'cordis.patch.yml'), 'utf8'), /dsh-plugin-demo-portable/);
});
