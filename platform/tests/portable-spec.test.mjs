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

test('portable spec：多文件 + 权限 + 测试通过', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-spec-')), 'sum-demo');
  generatePortable({
    id: 'sum-demo', name: 'Sum Demo', out,
    spec: {
      description: 'Sum values from a JSON fixture.',
      effect: 'read',
      permissions: { filesystem: ['read'], network: [] },
      tools: [{ name: 'sum_demo', description: 'Sum values.', parameters: { input_path: { type: 'string', required: false } } }],
      acceptance: ['returns total'],
    },
    files: [
      { path: 'lib/impl.js', content: "import fs from 'node:fs'\nimport path from 'node:path'\nimport { fileURLToPath } from 'node:url'\nconst F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data.json')\nexport async function execute(args = {}) {\n  const d = JSON.parse(fs.readFileSync(args.input_path || F, 'utf8'))\n  const rows = Array.isArray(d) ? d : d.rows\n  return { total: rows.reduce((s, r) => s + Number(r.value || 0), 0) }\n}\n" },
      { path: 'tests/impl.test.mjs', content: "import test from 'node:test'\nimport assert from 'node:assert'\nimport { execute } from '../lib/impl.js'\ntest('sum', async () => { const r = await execute({}); assert.equal(r.total, 30) })\n" },
    ],
  });
  const v = await validatePortable(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.ok(v.checks.some((c) => c.n === 'tests:node' && c.ok));
});

test('portable spec：拒绝越界文件路径', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-spec-bad-')), 'bad');
  assert.throws(() => generatePortable({
    id: 'bad-demo', name: 'Bad', out,
    spec: { tools: [{ name: 'bad_demo' }] },
    files: [{ path: '../escape.js', content: '' }],
  }), /非法文件路径/);
});
