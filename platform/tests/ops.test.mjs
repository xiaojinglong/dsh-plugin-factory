// ops.test.mjs —— M6 运维计划任务 + 备份 CLI
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createControlPlane } = require('../../apps/control-plane/server.cjs');
const { backup } = require('../../scripts/ops-backup.cjs');
const { pruneBackups } = require('../../scripts/ops-backup-prune.cjs');
const { schedulePlan, writeSchedule } = require('../../scripts/ops-schedule.cjs');

test('ops-backup：通过控制面 API 生成可读备份', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-ops-'));
  const token = 'ops-token';
  const cp = createControlPlane({ dataRoot, token });
  const { port } = await cp.start({ port: 0 });
  try {
    const r = await backup({ url: `http://127.0.0.1:${port}`, token, fileName: 'ops-test.db' });
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(r.path), r.path);
    assert.ok(fs.statSync(r.path).size > 0);
  } finally {
    await cp.stop();
  }
});

test('ops-schedule：生成 health/backup/drill 任务与 Windows/cron 文件', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-sched-'));
  const plan = schedulePlan({ dataRoot: path.join(outDir, 'data') });
  assert.equal(plan.tasks.length, 3);
  assert.deepEqual(plan.tasks.map((t) => t.name).sort(), ['factory-backup', 'factory-health-check', 'factory-pilot-drill']);
  const r = writeSchedule({ outDir, dataRoot: path.join(outDir, 'data') });
  assert.equal(r.ok, true);
  for (const f of ['ops-schedule.json', 'crontab.txt', 'ops-tasks.ps1']) assert.ok(fs.existsSync(path.join(outDir, f)), f);
  const cron = fs.readFileSync(path.join(outDir, 'crontab.txt'), 'utf8');
  assert.match(cron, /health-check/);
  assert.match(cron, /ops-backup/);
  assert.match(cron, /pilot-drill/);
});

test('ops-backup-prune：默认 dry-run，--apply 只保留最新 N 份', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-bak-'));
  const dir = path.join(dataRoot, 'control-plane', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 3; i += 1) {
    const p = path.join(dir, `b${i}.db`);
    fs.writeFileSync(p, `backup-${i}`, 'utf8');
    const t = new Date(Date.now() - (3 - i) * 60000);
    fs.utimesSync(p, t, t);
  }
  const dry = pruneBackups({ dataRoot, keep: 1 });
  assert.equal(dry.deleted.length, 2);
  assert.equal(dry.dryRun, true);
  assert.equal(fs.readdirSync(dir).length, 3, 'dry-run 不应删除');
  const applied = pruneBackups({ dataRoot, keep: 1, dryRun: false });
  assert.equal(applied.deleted.length, 2);
  assert.deepEqual(fs.readdirSync(dir), ['b2.db']);
});
