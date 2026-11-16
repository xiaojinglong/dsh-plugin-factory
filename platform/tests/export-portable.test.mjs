import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('export-plugin：导出 portable bundle 且无禁止项', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-export-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'export-plugin.cjs'), '--id', 'excel-status-mark', '--out', out], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  assert.ok(fs.existsSync(json.zip));
  assert.ok(fs.existsSync(`${json.zip}.sha256`));
  const scan = JSON.parse(fs.readFileSync(json.scan, 'utf8'));
  assert.equal(scan.ok, true, JSON.stringify(scan.findings));
  fs.rmSync(out, { recursive: true, force: true });
});
