// installer.test.mjs —— A 安装器生产级测试（临时目录，不触碰真实 DSH profile）
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../../packages/config');
const testArtifacts = require('../../packages/test-artifacts');
const ROOT = config.FACTORY_ROOT;
const INSTALLER = path.join(ROOT, 'apps', 'installer', 'installer.cjs');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-installer-')); }
function run(args, env = {}) {
  return spawnSync(process.execPath, [INSTALLER, ...args], {
    encoding: 'utf8', timeout: 120000, cwd: ROOT, env: { ...process.env, ...env },
  });
}
function paths(t) {
  return {
    dshRoot: path.join(t, 'dshskills'), patch: path.join(t, 'profile', 'cordis.patch.yml'),
    dataRoot: path.join(t, 'data'), registry: path.join(t, 'dshskills', 'registry.md'),
  };
}

test('setup.ps1 为 UTF-8 BOM（PS 5.1 要求）', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'apps', 'installer', 'setup.ps1'));
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('check：临时环境通过，且不写入任何文件', () => {
  const t = tmp();
  const p = paths(t);
  fs.mkdirSync(path.dirname(p.patch), { recursive: true });
  const before = fs.readdirSync(t, { recursive: true }).length;
  const r = run(['check', '--dsh-root', p.dshRoot, '--patch', p.patch, '--data-root', p.dataRoot]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\[check\] 通过/);
  assert.equal(fs.readdirSync(t, { recursive: true }).length, before, 'check 不应写文件');
});

test('install：注入 patch/registry、建立 dshskills 链接、幂等', () => {
  const t = tmp();
  const p = paths(t);
  fs.mkdirSync(p.dshRoot, { recursive: true });
  fs.mkdirSync(path.dirname(p.patch), { recursive: true });
  fs.writeFileSync(p.patch, '# original patch\n', 'utf8');

  const r1 = run(['install', '--dsh-root', p.dshRoot, '--patch', p.patch, '--data-root', p.dataRoot]);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const patch1 = fs.readFileSync(p.patch, 'utf8');
  assert.match(patch1, /# original patch/);
  assert.doesNotMatch(patch1, /- id: mcp-bulk-sync/);
  const businessCount = fs.readdirSync(path.join(ROOT, 'platform', 'manifests'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifests', f), 'utf8')))
    .filter((m) => !m.legacy && !testArtifacts.isTestArtifact(m.id)).length;
  assert.equal((patch1.match(/- id: mcp-/g) || []).length, businessCount + 1, '业务条目 + 1 个 factory-control');
  assert.match(patch1, /- id: mcp-factory-control/);
  assert.match(patch1, /serverName: factory-control/);
  const cpToken = fs.readFileSync(path.join(p.dataRoot, 'control-plane', 'token'), 'utf8').trim();
  assert.ok(cpToken.length >= 32);
  assert.ok(patch1.includes(`CONTROL_PLANE_TOKEN: "${cpToken}"`), 'patch 应携带控制面 token');
  assert.ok(fs.existsSync(p.registry), 'registry 应生成');
  assert.ok(fs.existsSync(path.join(p.dataRoot, 'installer', 'state.json')), 'state 应生成');
  assert.ok(fs.lstatSync(path.join(p.dshRoot, 'tools')).isSymbolicLink(), 'tools 应为链接');
  assert.ok(fs.lstatSync(path.join(p.dshRoot, 'skills')).isSymbolicLink(), 'skills 应为链接');

  // 幂等：再次安装不重复注入
  const r2 = run(['install', '--dsh-root', p.dshRoot, '--patch', p.patch, '--data-root', p.dataRoot]);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const patch2 = fs.readFileSync(p.patch, 'utf8');
  assert.equal((patch2.match(/- id: mcp-/g) || []).length, businessCount + 1, '重复安装不应重复条目');
  assert.equal((patch2.match(/managed by apps\/installer/g) || []).length, 1, 'managed block 不应重复');

  // uninstall：恢复原始 patch、清理链接与状态
  const r3 = run(['uninstall', '--dsh-root', p.dshRoot, '--patch', p.patch, '--data-root', p.dataRoot]);
  assert.equal(r3.status, 0, r3.stdout + r3.stderr);
  assert.equal(fs.readFileSync(p.patch, 'utf8'), '# original patch\n', 'uninstall 应恢复原 patch');
  assert.ok(!fs.existsSync(path.join(p.dataRoot, 'installer', 'state.json')), 'state 应删除');
  assert.ok(!fs.existsSync(path.join(p.dshRoot, 'tools')), 'tools 链接应删除');
  assert.ok(!fs.existsSync(path.join(p.dshRoot, 'skills')), 'skills 链接应删除');
});

test('uninstall 无安装状态时给出可读错误', () => {
  const t = tmp();
  const p = paths(t);
  const r = run(['uninstall', '--dsh-root', p.dshRoot, '--patch', p.patch, '--data-root', p.dataRoot]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /未找到安装状态/);
});

test('dry-run：不写 patch、不写 state', () => {
  const t = tmp();
  const p = paths(t);
  fs.mkdirSync(p.dshRoot, { recursive: true });
  fs.mkdirSync(path.dirname(p.patch), { recursive: true });
  fs.writeFileSync(p.patch, '# original patch\n', 'utf8');
  const r = run(['install', '--dry-run', '--dsh-root', p.dshRoot, '--patch', p.patch, '--data-root', p.dataRoot]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(p.patch, 'utf8'), '# original patch\n');
  assert.ok(!fs.existsSync(path.join(p.dataRoot, 'installer', 'state.json')));
  assert.ok(!fs.existsSync(path.join(p.dataRoot, 'control-plane', 'token')), 'dry-run 不应生成 token');
});

test('rollback：从首次安装备份恢复 patch', () => {
  const t = tmp();
  const p = paths(t);
  fs.mkdirSync(p.dshRoot, { recursive: true });
  fs.mkdirSync(path.dirname(p.patch), { recursive: true });
  fs.writeFileSync(p.patch, '# original patch\n', 'utf8');
  const install = run(['install', '--dsh-root', p.dshRoot, '--patch', p.patch, '--data-root', p.dataRoot]);
  assert.equal(install.status, 0, install.stdout + install.stderr);
  assert.match(fs.readFileSync(p.patch, 'utf8'), /- id: mcp-/);
  const r = run(['rollback', '--dsh-root', p.dshRoot, '--patch', p.patch, '--data-root', p.dataRoot]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(p.patch, 'utf8'), '# original patch\n');
});

test('repair：补齐被删除的 factory-control 注入（幂等）；无状态时报错', () => {
  const t = tmp();
  const p = paths(t);
  fs.mkdirSync(p.dshRoot, { recursive: true });
  fs.mkdirSync(path.dirname(p.patch), { recursive: true });
  fs.writeFileSync(p.patch, '# original patch\n', 'utf8');
  const base = ['--dsh-root', p.dshRoot, '--patch', p.patch, '--data-root', p.dataRoot];
  assert.equal(run(['install', ...base]).status, 0);

  // 破坏：删除 managed block
  const text = fs.readFileSync(p.patch, 'utf8');
  const start = text.indexOf('# >>> factory-control');
  const end = text.indexOf('# <<< factory-control <<<');
  assert.ok(start >= 0 && end > start);
  fs.writeFileSync(p.patch, text.slice(0, start) + text.slice(end + '# <<< factory-control <<<'.length), 'utf8');
  assert.ok(!fs.readFileSync(p.patch, 'utf8').includes('serverName: factory-control'));

  const r1 = run(['repair', ...base]);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const repaired = fs.readFileSync(p.patch, 'utf8');
  assert.match(repaired, /serverName: factory-control/);
  assert.equal((repaired.match(/managed by apps\/installer/g) || []).length, 1, 'repair 不应重复注入');
  assert.equal(run(['repair', ...base]).status, 0, 'repair 应幂等');

  fs.unlinkSync(path.join(p.dataRoot, 'installer', 'state.json'));
  const r2 = run(['repair', ...base]);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /请先执行 install/);
});
