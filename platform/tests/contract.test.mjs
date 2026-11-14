// contract.test.mjs —— 插件契约测试：manifest / 路径 / 配置 / patch / skill
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/www/dsh-plugin-factory';
const MAN = path.join(ROOT, 'platform', 'manifests');
const PATCH = path.join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
const manifests = fs.readdirSync(MAN).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(MAN, f), 'utf8')));

test('插件清单非空且字段齐全', () => {
  assert.ok(manifests.length >= 8);
  for (const m of manifests) {
    for (const k of ['id', 'name', 'type', 'version', 'port', 'taskType', 'serverName', 'service', 'mcp', 'skill']) {
      assert.ok(k in m, `${m.id} 缺 ${k}`);
    }
    assert.match(m.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

test('端口 / taskType / serverName / id 全局唯一', () => {
  const uniq = (arr) => new Set(arr).size === arr.length;
  assert.ok(uniq(manifests.map((m) => m.port)), '端口重复');
  assert.ok(uniq(manifests.map((m) => m.taskType)), 'taskType 重复');
  assert.ok(uniq(manifests.map((m) => m.serverName)), 'serverName 重复');
  assert.ok(uniq(manifests.map((m) => m.id)), 'id 重复');
});

test('服务入口 / runner / MCP / SKILL 路径存在', () => {
  for (const m of manifests) {
    assert.ok(fs.existsSync(m.service.dir), `${m.id} service.dir 不存在`);
    assert.ok(fs.existsSync(path.join(m.service.dir, m.service.entry)), `${m.id} entry 不存在`);
    if (m.service.runner) assert.ok(fs.existsSync(path.join(m.service.dir, m.service.runner)), `${m.id} runner 不存在`);
    assert.ok(fs.existsSync(path.join(m.mcp.dir, 'index.js')), `${m.id} MCP index 不存在`);
    assert.ok(fs.existsSync(path.join(m.mcp.dir, 'config.json')), `${m.id} MCP config 不存在`);
    assert.ok(fs.existsSync(path.join(m.skill.dir, 'SKILL.md')), `${m.id} SKILL 不存在`);
  }
});

test('MCP config 端口与 manifest 一致', () => {
  for (const m of manifests) {
    const cfg = JSON.parse(fs.readFileSync(path.join(m.mcp.dir, 'config.json'), 'utf8'));
    const port = Number(new URL(cfg.service.baseUrl).port);
    assert.equal(port, m.port, `${m.id} baseUrl 端口不一致`);
  }
});

test('patch 包含全部非 legacy 插件条目', () => {
  const text = fs.readFileSync(PATCH, 'utf8');
  for (const m of manifests.filter((x) => !x.legacy)) {
    assert.ok(text.includes(`- id: mcp-${m.id}`), `${m.id} 缺 patch 条目`);
    assert.ok(text.includes(`"http://127.0.0.1:${m.port}"`), `${m.id} 缺端口`);
  }
});

test('SKILL frontmatter name 与 id 一致且含关键章节', () => {
  for (const m of manifests) {
    const t = fs.readFileSync(path.join(m.skill.dir, 'SKILL.md'), 'utf8');
    assert.equal((t.match(/^name:\s*(\S+)/m) || [])[1], m.id, `${m.id} name 不一致`);
    assert.match(t, /^description:\s*\S+/m, `${m.id} 缺 description`);
  }
});

test('非 legacy 插件使用共享 runtime bootstrap', () => {
  for (const m of manifests.filter((x) => !x.legacy)) {
    const boot = fs.readFileSync(path.join(m.service.dir, m.service.entry), 'utf8');
    assert.ok(boot.includes('platform/factory/bootstrap'), `${m.id} 未使用共享 runtime`);
  }
});
