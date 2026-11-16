import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { withChecksum, verifyPlugin, findPlugin, sha256File } = require('../../packages/catalog');

test('catalog：校验和、查找与篡改检测', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-test-'));
  const zip = path.join(dir, 'demo.zip');
  fs.writeFileSync(zip, 'zip-content');
  const entry = withChecksum({ id: 'demo', version: '0.1.0', zip });
  assert.equal(entry.sha256, sha256File(zip));
  assert.equal(verifyPlugin(entry).ok, true);
  assert.equal(findPlugin({ plugins: [entry] }, 'demo').version, '0.1.0');
  fs.writeFileSync(zip, 'tampered');
  assert.equal(verifyPlugin(entry).ok, false);
});
