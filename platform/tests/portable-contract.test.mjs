import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('portable contract 包含关键约束', () => {
  const text = fs.readFileSync('docs/53-portable-plugin-contract.md', 'utf8');
  for (const word of ['FACTORY_ROOT', 'dsh.bundle.patch', 'DSH_PLUGIN_DATA_DIR', 'T1', 'T2']) {
    assert.ok(text.includes(word), word);
  }
});
