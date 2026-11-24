import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'dsh-factory.cjs');

function run(args, dataRoot) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, FACTORY_DATA_ROOT: dataRoot },
  });
}

test('rollback --dry-run 选择上一个已安装版本', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-rollback-'));
  const zip1 = path.join(dataRoot, 'v1.zip');
  const zip2 = path.join(dataRoot, 'v2.zip');
  fs.writeFileSync(zip1, 'v1');
  fs.writeFileSync(zip2, 'v2');
  fs.mkdirSync(path.join(dataRoot, 'registry'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'registry', 'plugins.json'), JSON.stringify({
    plugins: [
      { id: 'demo', version: '1.0.0', zip: zip1, installed: true },
      { id: 'demo', version: '2.0.0', zip: zip2, installed: true },
    ],
  }));
  const r = run(['rollback', 'demo', '--dry-run'], dataRoot);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.version, '1.0.0');
  assert.equal(out.zip, zip1);
});

test('rollback 无历史版本时给出可读错误', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-rollback-empty-'));
  fs.mkdirSync(path.join(dataRoot, 'registry'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'registry', 'plugins.json'), JSON.stringify({ plugins: [] }));
  const r = run(['rollback', 'missing', '--dry-run'], dataRoot);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /没有可回滚/);
});
