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

test('portable spec：多工具 handlers', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portable-multi-')), 'multi-demo');
  generatePortable({
    id: 'multi-demo', name: 'Multi Demo', out,
    spec: {
      description: 'Multi tool demo.',
      permissions: { filesystem: ['read'], network: [] },
      tools: [
        { name: 'sum_values', handler: 'sum', description: 'Sum values.', parameters: {} },
        { name: 'count_values', handler: 'count', description: 'Count values.', parameters: {} },
      ],
      acceptance: ['two tools'],
    },
    files: [
      { path: 'lib/handlers.js', content: "export const handlers = { async sum() { return { total: 30 } }, async count() { return { total: 2 } } }\n" },
      { path: 'tests/handlers.test.mjs', content: "import test from 'node:test'\nimport assert from 'node:assert'\nimport { handlers } from '../lib/handlers.js'\ntest('handlers', async () => { assert.equal((await handlers.sum()).total, 30); assert.equal((await handlers.count()).total, 2) })\n" },
    ],
  });
  const v = await validatePortable(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const index = fs.readFileSync(path.join(out, 'index.js'), 'utf8');
  assert.match(index, /handlers\["sum"\]/);
  assert.match(index, /name: "count_values"/);
});
