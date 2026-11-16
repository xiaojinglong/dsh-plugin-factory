#!/usr/bin/env node
'use strict';
/**
 * install.cjs —— 新用户一条命令安装
 * 用法：node install.cjs（或双击 install.cmd / npm run setup）
 * 选项：--check 只检查；--skip-deps；--no-browser；--no-start；--profile <name>
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname);
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
const profile = String(args.profile || process.env.FACTORY_DSH_PROFILE || 'desktop');
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profileDir = path.join(dshHome, 'profiles', profile);
const checkOnly = args.check === 'true';
const forceInstall = args['force-install'] === 'true';
const withPlugins = args['with-plugins'] === 'true';

function log(msg) { console.log(msg); }
function fail(msg) { console.error(`\n[install] 失败：${msg}`); process.exit(1); }
function run(step, cmd, cmdArgs, opts = {}) {
  log(`\n== ${step} ==`);
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', timeout: 900000, ...opts });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) fail(`${step}：${r.error.message}`);
  if (r.status !== 0) fail(`${step} 退出码 ${r.status}`);
  return r;
}

// 1) 环境检查
const major = Number(String(process.versions.node).split('.')[0]);
log(`[install] Node ${process.versions.node}`);
if (major < 24) fail('需要 Node.js >= 24；请安装 Node 24 后重试');
if (!fs.existsSync(profileDir)) {
  const profiles = fs.existsSync(path.join(dshHome, 'profiles'))
    ? fs.readdirSync(path.join(dshHome, 'profiles')).filter((d) => fs.statSync(path.join(dshHome, 'profiles', d)).isDirectory())
    : [];
  fail(`找不到 DSH profile：${profileDir}\n已发现 profile：${profiles.join(', ') || '无'}\n请先安装 DSH，或用 --profile <name> 指定`);
}
log(`[install] DSH profile：${profileDir}`);
const installerState = path.join(ROOT, 'data', 'installer', 'state.json');
const patchFile = path.join(profileDir, 'cordis.patch.yml');
const installed = fs.existsSync(installerState) && fs.existsSync(patchFile);
if ((checkOnly || installed) && !forceInstall) {
  log(installed ? '\n[install] 已安装：跳过 npm/Playwright/安装器/自启，只做检测' : '\n[install] 未安装：只做环境检查');
  run('检查 DSH 环境', process.execPath, [path.join(ROOT, 'apps', 'installer', 'installer.cjs'), 'check', '--profile', profile]);
  if (installed) {
    run('静态自检', process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'doctor']);
    log('[install] 检测完成，未重新安装。');
    log('[install] 平滑启动/重启：start-factory.cmd');
    log('[install] 需要 30 个测试插件：start-factory.cmd --with-plugins');
  } else {
    log('[install] 检查通过（未安装/未启动）。移除 --check 执行完整安装。');
  }
  process.exit(0);
}
if (forceInstall) log('\n[install] --force-install：强制走完整安装');

// 2) 依赖
const fastify = path.join(ROOT, 'node_modules', 'fastify', 'package.json');
if (args['skip-deps'] !== 'true' && (!fs.existsSync(fastify) || args['force-deps'] === 'true')) {
  const npmCli = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((p) => fs.existsSync(p));
  if (npmCli) run('安装依赖', process.execPath, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  else run('安装依赖', 'npm.cmd', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { shell: true });
} else {
  log('\n== 依赖已存在，跳过 npm ci ==');
}

// 3) 浏览器（可选；失败不阻塞核心安装）
if (args['no-browser'] !== 'true') {
  const pw = path.join(ROOT, 'node_modules', 'playwright', 'cli.js');
  if (fs.existsSync(pw)) {
    const r = spawnSync(process.execPath, [pw, 'install', 'chromium'], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
    if (r.status === 0) log('\n[install] Playwright Chromium 就绪');
    else log('\n[install] 警告：Chromium 安装失败（浏览器类插件不可用，可稍后重跑：node node_modules/playwright/cli.js install chromium）');
  } else {
    log('\n[install] 警告：未找到 Playwright，跳过浏览器安装');
  }
}

// 4) DSH 集成
run('检查 DSH 环境', process.execPath, [path.join(ROOT, 'apps', 'installer', 'installer.cjs'), 'check', '--profile', profile]);
run('安装/修复 DSH 集成', process.execPath, [path.join(ROOT, 'apps', 'installer', 'installer.cjs'), 'install', '--profile', profile]);

// 5) 启动
if (args['no-start'] !== 'true') {
  const startArgs = [path.join(ROOT, 'scripts', 'start-factory.cjs')];
  if (withPlugins) startArgs.push('--with-plugins');
  run('启动控制面' + (withPlugins ? '与测试插件' : '（不启动 30 个测试插件）'), process.execPath, startArgs);
  run('静态自检', process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'doctor']);
  if (withPlugins) run('健康检查', process.execPath, [path.join(ROOT, 'platform', 'factory', 'cli.cjs'), 'doctor', '--health']);
}

// 6) 登录自启（可用 --no-autostart 跳过）
if (args['no-autostart'] !== 'true') {
  run('安装登录自启', process.execPath, [path.join(ROOT, 'scripts', 'install-autostart.cjs')]);
}

log('\n[install] 完成。');
log('下一步：重开一次 DSH，然后直接对 AI 说你要做什么。');
log('默认只启动控制面，不启动 30 个测试插件。');
log('需要测试插件：start-factory.cmd --with-plugins');
log('日常启动：start-factory.cmd；停止：stop-factory.cmd');
