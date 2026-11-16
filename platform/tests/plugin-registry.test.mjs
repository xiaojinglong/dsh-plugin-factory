import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

test('plugin registry：记录版本与安装状态', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-registry-'));
  const old = process.env.FACTORY_DATA_ROOT;
  process.env.FACTORY_DATA_ROOT = data;
  const require = createRequire(import.meta.url);
  delete require.cache[require.resolve('../../packages/config')];
  delete require.cache[require.resolve('../../packages/plugin-registry')];
  const registry = require('../../packages/plugin-registry');
  registry.record({ id: 'demo', version: '0.1.0', requestId: 'req_1', tools: ['demo_tool'], installed: false, zip: 'x.zip' });
  registry.record({ id: 'demo', version: '0.1.1', requestId: 'req_2', tools: ['demo_tool'], installed: true, zip: 'y.zip' });
  assert.equal(registry.history('demo').length, 2);
  assert.equal(registry.latest('demo').version, '0.1.1');
  assert.ok(fs.existsSync(path.join(data, 'registry', 'plugins.json')));
  if (old === undefined) delete process.env.FACTORY_DATA_ROOT; else process.env.FACTORY_DATA_ROOT = old;
});
