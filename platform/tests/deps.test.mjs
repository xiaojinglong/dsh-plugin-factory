// deps.test.mjs —— M1 依赖/浏览器环境检查
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkDeps } = require('../../scripts/deps-check.cjs');

test('deps-check：当前仓库依赖/Playwright 通过', () => {
  const r = checkDeps();
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.ok(r.checks.some((c) => c.name === 'node>=24' && c.ok));
  assert.ok(r.checks.some((c) => c.name === 'playwright:chromium' && c.ok));
  assert.ok(r.checks.filter((c) => c.name.startsWith('module:')).every((c) => c.ok));
});
