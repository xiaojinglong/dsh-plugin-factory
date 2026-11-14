// plugin-install.test.mjs —— M4 生成插件安装/卸载/回滚（临时工厂根）
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generate } = require('../../apps/generator/generator.cjs');
const { install, uninstall, validateSource } = require('../../apps/installer/plugin-install.cjs');

async function makeSource(id = 'install-demo') {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-inst-src-'));
  const fixture = path.join(t, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ rows: [{ k: 1 }, { k: 2 }] }), 'utf8');
  const out = path.join(t, 'plugin');
  await generate({ id, name: '安装演示', type: 'api', fixture, out, port: 0 });
  return out;
}
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-inst-root-'));
  for (const d of ['plugins', 'deployment/tools', 'deployment/skills', 'platform/manifests']) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
}

test('install：复制插件/MCP/SKILL、写相对 manifest、状态可审计', async () => {
  const source = await makeSource();
  const root = makeRoot();
  const r = await install({ source, root, smoke: false });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(root, 'plugins', 'install-demo', 'service', 'server.js')));
  assert.ok(fs.existsSync(path.join(root, 'deployment', 'tools', 'install-demo-mcp', 'index.js')));
  assert.ok(fs.existsSync(path.join(root, 'deployment', 'skills', 'install-demo', 'SKILL.md')));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'platform', 'manifests', 'install-demo.json'), 'utf8'));
  assert.equal(manifest.service.dir, 'plugins/install-demo/service');
  assert.equal(manifest.mcp.dir, 'deployment/tools/install-demo-mcp');
  assert.equal(manifest.skill.dir, 'deployment/skills/install-demo');
  const runtimeManifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins', 'install-demo', 'manifest.json'), 'utf8'));
  assert.ok(path.isAbsolute(runtimeManifest.service.dir));
  assert.ok(runtimeManifest.service.dataDir.startsWith(runtimeManifest.service.dir));
  assert.ok(fs.existsSync(path.join(root, 'platform', 'manifests', '.installed', 'install-demo.json')));

  const u = uninstall({ id: 'install-demo', root });
  assert.equal(u.ok, true);
  assert.ok(!fs.existsSync(path.join(root, 'plugins', 'install-demo')));
  assert.ok(!fs.existsSync(path.join(root, 'platform', 'manifests', 'install-demo.json')));
  assert.ok(!fs.existsSync(path.join(root, 'deployment', 'tools', 'install-demo-mcp')));
});

test('install：默认拒绝覆盖；--force 备份，uninstall 恢复旧目录', async () => {
  const source = await makeSource();
  const root = makeRoot();
  await install({ source, root, smoke: false });
  await assert.rejects(() => install({ source, root, smoke: false }), /已存在/);
  await install({ source, root, smoke: false, force: true });
  const backups = fs.readdirSync(path.join(root, 'plugins')).filter((n) => n.startsWith('install-demo.bak-'));
  assert.ok(backups.length >= 1, 'force 应保留旧目录备份');
  uninstall({ id: 'install-demo', root });
  assert.ok(fs.existsSync(path.join(root, 'plugins', 'install-demo', 'service', 'server.js')), 'uninstall 应恢复旧目录');
});

test('install：缺文件/非法源被拒绝', async () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-inst-bad-'));
  assert.throws(() => validateSource(bad), /缺少 plugin.json/);
  await assert.rejects(() => install({ source: bad, root: makeRoot(), smoke: false }), /缺少 plugin.json/);
});
