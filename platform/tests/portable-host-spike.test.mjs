import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(ROOT, 'spikes', 'portable-host');

test('portable-host spike 是标准 bundle 结构', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.match(fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'), /name: "@local\/portable-host-spike"/);
  const index = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
  assert.match(index, /export function apply/);
  assert.match(index, /ctx\.tools\.register/);
  assert.match(index, /name: 'portable_ping'/);
});
