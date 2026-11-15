#!/usr/bin/env node
'use strict';

/**
 * scripts/deps-check.cjs —— 依赖/浏览器运行环境检查（M1）
 * 用法：node scripts/deps-check.cjs [--root <repo>] [--fix]
 * 只读检查；--fix 只打印修复命令，不自动执行（避免在会话中改动依赖）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');

function checkDeps(opts = {}) {
  const root = path.resolve(opts.root || ROOT);
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const major = Number(process.versions.node.split('.')[0]);
  add('node>=24', major >= 24, process.version);
  add('package-lock.json', fs.existsSync(path.join(root, 'package-lock.json')), '');
  const req = createRequire(path.join(root, 'package.json'));
  for (const mod of ['fastify', 'playwright', '@modelcontextprotocol/sdk', 'zod']) {
    const pkg = path.join(root, 'node_modules', ...mod.split('/'), 'package.json');
    add(`module:${mod}`, fs.existsSync(pkg), pkg);
  }
  for (const rel of ['apps/control-plane/server.cjs', 'apps/generator/generator.cjs', 'apps/factory-control-mcp/index.cjs', 'templates/plugin/service/server.js.tmpl']) {
    add(`file:${rel}`, fs.existsSync(path.join(root, rel)), rel);
  }
  try {
    const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
    const exe = chromium.executablePath();
    add('playwright:chromium', !!exe && fs.existsSync(exe), exe || '未找到浏览器');
  } catch (err) {
    add('playwright:chromium', false, String(err.message).slice(0, 160));
  }
  return {
    ok: checks.every((c) => c.ok), root, node: process.version, checks,
    fixes: ['npm ci --ignore-scripts --no-audit --no-fund', 'npx playwright install chromium'],
  };
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--root');
  const report = checkDeps({ root: i >= 0 ? args[i + 1] : undefined });
  console.log(JSON.stringify(report, null, 2));
  if (args.includes('--fix')) {
    console.log('\n[fix] 请手动执行：');
    for (const f of report.fixes) console.log(`  ${f}`);
  }
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { checkDeps };
