#!/usr/bin/env node
'use strict';

/**
 * scripts/ops-schedule.cjs —— 生成运维计划任务（Windows schtasks + cron 文本）
 * 用法：node scripts/ops-schedule.cjs [--out <dir>] [--data-root <dir>] [--token-file <file>] [--webhook <url>]
 * 产出：ops-schedule.json / crontab.txt / ops-tasks.ps1（不直接注册任务，需 owner 审核后执行）。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function schedulePlan(opts = {}) {
  const dataRoot = opts.dataRoot || path.join(ROOT, 'data');
  const tokenFile = opts.tokenFile || path.join(dataRoot, 'control-plane', 'token');
  const webhook = opts.webhook || '';
  const node = process.execPath;
  const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
  const hc = `${q(node)} ${q(path.join(ROOT, 'scripts', 'health-check.cjs'))} --token-file ${q(tokenFile)}${webhook ? ` --webhook ${q(webhook)}` : ''}`;
  const bk = `${q(node)} ${q(path.join(ROOT, 'scripts', 'ops-backup.cjs'))} --token-file ${q(tokenFile)}`;
  const drill = `${q(node)} ${q(path.join(ROOT, 'scripts', 'pilot-drill.cjs'))}`;
  return {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    dataRoot,
    tasks: [
      { name: 'factory-health-check', cadence: '*/5 * * * *', windows: '每 5 分钟', command: hc, description: '巡检 health/metrics，失败走 webhook' },
      { name: 'factory-backup', cadence: '0 2 * * *', windows: '每日 02:00', command: bk, description: '控制面 SQLite 备份' },
      { name: 'factory-pilot-drill', cadence: '0 4 * * 1', windows: '每周一 04:00', command: drill, description: '试点演练（临时数据根）' },
    ],
  };
}

function writeSchedule(opts = {}) {
  const outDir = path.resolve(opts.outDir || path.join(ROOT, 'ops'));
  const plan = schedulePlan(opts);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ops-schedule.json'), JSON.stringify(plan, null, 2) + '\n', 'utf8');
  const cron = plan.tasks.map((t) => `# ${t.description}\n${t.cadence} ${t.command}`).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'crontab.txt'), cron, 'utf8');
  const ps = plan.tasks.map((t) => {
    const winCadence = t.name.endsWith('health-check') ? '/SC MINUTE /MO 5' : t.name.endsWith('backup') ? '/SC DAILY /ST 02:00' : '/SC WEEKLY /D MON /ST 04:00';
    return `schtasks /Create /F /TN "${t.name}" ${winCadence} /TR "${t.command.replace(/"/g, '\\"')}"`;
  }).join('\n');
  fs.writeFileSync(path.join(outDir, 'ops-tasks.ps1'), `# 由 ops-schedule 生成；执行前请 owner 审核\n${ps}\n`, 'utf8');
  return { ok: true, outDir, plan, files: ['ops-schedule.json', 'crontab.txt', 'ops-tasks.ps1'] };
}

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[a.slice(2)] = next; i += 1; } else args[a.slice(2)] = 'true';
  }
  try {
    const r = writeSchedule({ outDir: args.out, dataRoot: args['data-root'], tokenFile: args['token-file'], webhook: args.webhook });
    console.log(JSON.stringify(r, null, 2));
  } catch (err) {
    console.error(`[ops-schedule] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { schedulePlan, writeSchedule };
