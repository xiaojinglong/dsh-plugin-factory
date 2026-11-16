'use strict';
// scripts/verify-clean-install.cjs —— 用临时 DSH 根目录模拟干净机器安装
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-clean-install-'));
const dshRoot = path.join(tmp, 'dsh');
const dataRoot = path.join(tmp, 'data');
const patch = path.join(dshRoot, 'profiles', 'desktop', 'cordis.patch.yml');
fs.mkdirSync(path.dirname(patch), { recursive: true });
fs.writeFileSync(patch, '# clean install\n', 'utf8');

function run(args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'installer', 'installer.cjs'), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000,
  });
  if (r.status !== 0) throw new Error(`installer ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
  return r;
}

const result = { ok: false, tmp, checks: [] };
try {
  run(['install', '--dsh-root', dshRoot, '--patch', patch, '--data-root', dataRoot]);
  const text = fs.readFileSync(patch, 'utf8');
  result.checks.push({ n: 'patch:factory-control', ok: text.includes('- id: mcp-factory-control') });
  result.checks.push({ n: 'patch:no-test-plugins', ok: !text.includes('- id: mcp-bulk-sync') && !text.includes('- id: mcp-page-audit') });
  result.checks.push({ n: 'state:written', ok: fs.existsSync(path.join(dataRoot, 'installer', 'state.json')) });
  result.checks.push({ n: 'registry:created', ok: fs.existsSync(path.join(dshRoot, 'registry.md')) });
  result.checks.push({ n: 'scripts:cmd', ok: ['install.cmd', 'start-factory.cmd', 'stop-factory.cmd'].every((f) => fs.existsSync(path.join(ROOT, f))) });
  result.checks.push({ n: 'scripts:sh', ok: ['install.sh', 'start-factory.sh', 'stop-factory.sh'].every((f) => fs.existsSync(path.join(ROOT, f))) });
  // 幂等：再安装一次，不重复 factory-control
  run(['install', '--dsh-root', dshRoot, '--patch', patch, '--data-root', dataRoot]);
  const text2 = fs.readFileSync(patch, 'utf8');
  result.checks.push({ n: 'install:idempotent', ok: (text2.match(/- id: mcp-factory-control/g) || []).length === 1 });
  result.ok = result.checks.every((c) => c.ok);
} catch (e) {
  result.error = e.message;
} finally {
  console.log(JSON.stringify(result, null, 2));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!result.ok) process.exitCode = 1;
}
