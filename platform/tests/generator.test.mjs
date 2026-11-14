// generator.test.mjs —— M3 SDK + 生成/校验垂直切片
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validatePluginSpec } = require('../../packages/sdk');
const { generate, validateDir } = require('../../apps/generator/generator.cjs');

function baseSpec(over = {}) {
  return {
    id: 'demo-fixture', version: '0.1.0', name: '演示插件', type: 'api',
    runtimeRange: '^3.2', owner: 'local', taskType: 'demo_fixture',
    paramsSchema: {}, outputSchema: {}, permissions: { write: false, network: [], browser: false },
    service: { entry: 'server.js', runner: 'runner.js' },
    mcp: { serverName: 'demo-fixture' }, skill: { name: 'demo-fixture' }, report: { generator: 'gen-report.mjs' },
    ...over,
  };
}

test('SDK：合法 plugin.json 通过；非法 id/taskType/type 被拒绝', () => {
  assert.equal(validatePluginSpec(baseSpec()).ok, true);
  assert.equal(validatePluginSpec(baseSpec({ id: 'Bad_ID' })).ok, false);
  assert.equal(validatePluginSpec(baseSpec({ taskType: 'Bad-Task' })).ok, false);
  assert.equal(validatePluginSpec(baseSpec({ type: 'unknown' })).ok, false);
  assert.equal(validatePluginSpec(baseSpec({ extra: 1 })).ok, false);
});

test('生成器：生成 fixture 插件 → 结构/语法校验 → 起服务预演', async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-gen-'));
  const out = path.join(t, 'demo-fixture');
  const gen = await generate({ id: 'demo-fixture', name: '演示插件', type: 'api', out, port: 0 });
  assert.equal(gen.spec.id, 'demo-fixture');
  assert.ok(fs.existsSync(path.join(out, 'plugin.json')));
  assert.ok(fs.existsSync(path.join(out, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(out, 'mcp', 'index.js')));
  assert.ok(fs.existsSync(path.join(out, 'report', 'gen-report.mjs')) === false, 'report 生成器应在插件根目录');
  assert.ok(fs.existsSync(path.join(out, 'gen-report.mjs')));
  assert.ok(fs.existsSync(path.join(out, 'evidence', 'generation.json')));

  const v = await validateDir(out);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.rows, 2);
  assert.ok(fs.existsSync(path.join(out, 'evidence', 'validation.json')));
  const validation = JSON.parse(fs.readFileSync(path.join(out, 'evidence', 'validation.json'), 'utf8'));
  assert.equal(validation.ok, true);
  assert.ok(validation.datasetPath && fs.existsSync(validation.datasetPath));
});

test('生成器：默认拒绝覆盖已有目录，--force 可覆盖', async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-gen2-'));
  const out = path.join(t, 'demo-fixture');
  await generate({ id: 'demo-fixture', name: '演示插件', out, port: 0 });
  await assert.rejects(() => generate({ id: 'demo-fixture', name: '演示插件', out, port: 0 }), /输出目录已存在/);
  await generate({ id: 'demo-fixture', name: '演示插件', out, port: 0, force: true });
  assert.ok(fs.existsSync(path.join(out, 'plugin.json')));
});
