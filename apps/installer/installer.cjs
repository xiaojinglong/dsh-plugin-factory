#!/usr/bin/env node
'use strict';

/**
 * apps/installer/installer.cjs —— A 单机版安装器（生产级骨架）
 *
 * 命令：check | install [--dry-run] | uninstall | rollback
 * 选项：--dsh-root <dir> --profile <name> --patch <file> --data-root <dir>
 *
 * 安全原则：
 *   - 只操作 DSH profile / dshskills / 安装状态，不删除插件数据；
 *   - 修改前备份 patch/registry；失败可 rollback；
 *   - 幂等：重复 install 不重复注入；
 *   - 默认不触碰用户真实 profile（由 --dsh-root/--patch 显式指定，测试用临时目录）。
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const config = require('../../packages/config');

const ROOT = config.FACTORY_ROOT;
const DEPLOY = path.join(ROOT, 'deployment');
const CLI = path.join(ROOT, 'platform', 'factory', 'cli.cjs');
const MANIFEST_DIR = path.join(ROOT, 'platform', 'manifests');

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i += 1; } else args[key] = 'true';
    } else args._.push(a);
  }
  return args;
}

function options(args) {
  const dataRoot = path.resolve(args['data-root'] || process.env.FACTORY_DATA_ROOT || path.join(ROOT, 'data'));
  const dshRoot = path.resolve(args['dsh-root'] || process.env.FACTORY_DSH_ROOT || path.resolve(ROOT, '..', 'dshskills'));
  const profile = String(args.profile || process.env.FACTORY_DSH_PROFILE || 'desktop');
  const patch = path.resolve(args.patch || process.env.FACTORY_DSH_PATCH || path.join(os.homedir(), '.dsh', 'profiles', profile, 'cordis.patch.yml'));
  return {
    dataRoot, dshRoot, profile, patch,
    tools: path.join(dshRoot, 'tools'),
    skills: path.join(dshRoot, 'skills'),
    registry: path.join(dshRoot, 'registry.md'),
    stateFile: path.join(dataRoot, 'installer', 'state.json'),
    backupsRoot: path.join(dataRoot, 'installer', 'backups'),
  };
}

function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}
function symlinkType() { return process.platform === 'win32' ? 'junction' : 'dir'; }
function linkTarget(p) {
  try { return path.resolve(fs.readlinkSync(p)); } catch { return ''; }
}
function readManifests() {
  return fs.readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, f), 'utf8')));
}
function nonLegacy() { return readManifests().filter((m) => !m.legacy); }

function checkPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function check(opts) {
  const checks = [];
  const add = (name, level, ok, detail) => checks.push({ name, level, ok, detail });
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('node>=24', 'error', nodeMajor >= 24, `node ${process.versions.node}`);
  add('deployment 目录', 'error', fs.existsSync(DEPLOY), DEPLOY);
  const manifests = readManifests();
  add('manifest 可读', 'error', manifests.length > 0, `${manifests.length} 个`);
  add('核心依赖 fastify', 'error', (() => { try { require.resolve('fastify', { paths: [ROOT] }); return true; } catch { return false; } })(), '根 node_modules');
  add('Playwright 依赖', 'warn', (() => { try { require.resolve('playwright', { paths: [ROOT] }); return true; } catch { return false; } })(), '浏览器类插件需要');

  const patchDir = path.dirname(opts.patch);
  add('patch 目录可写', 'error', (() => { try { fs.accessSync(patchDir, fs.constants.W_OK); return true; } catch { return false; } })(), patchDir);

  // dshRoot 状态
  if (fs.existsSync(opts.dshRoot)) {
    if (isSymlink(opts.dshRoot)) {
      const t = linkTarget(opts.dshRoot);
      add('dshskills 链接', 'warn', t === path.resolve(DEPLOY), `${opts.dshRoot} -> ${t}`);
    } else {
      add('dshskills 目录', 'error', fs.statSync(opts.dshRoot).isDirectory(), opts.dshRoot);
      add('dshskills/tools', 'warn', fs.existsSync(opts.tools), opts.tools);
      add('dshskills/skills', 'warn', fs.existsSync(opts.skills), opts.skills);
    }
  } else {
    add('dshskills 不存在（将创建）', 'warn', true, opts.dshRoot);
  }

  // MCP 依赖（共享 node_modules）
  const sharedMcpModules = path.join(DEPLOY, 'tools', 'ads-list-mcp', 'node_modules');
  add('MCP node_modules', 'warn', fs.existsSync(sharedMcpModules), sharedMcpModules);

  // 端口：被占用不视为错误（可能已安装运行中），仅提示
  const busy = [];
  for (const m of manifests) {
    if (await checkPort(Number(m.port))) continue;
    busy.push(m.port);
  }
  add('插件端口', 'warn', busy.length === 0, busy.length ? `占用：${busy.join(',')}（可能已运行）` : '全部空闲');

  const errors = checks.filter((c) => c.level === 'error' && !c.ok);
  return { ok: errors.length === 0, checks, opts };
}

function printCheck(res) {
  for (const c of res.checks) {
    const tag = c.ok ? 'OK  ' : (c.level === 'error' ? 'FAIL' : 'WARN');
    console.log(`[${tag}] ${c.name}${c.detail ? `：${c.detail}` : ''}`);
  }
  console.log(`[check] ${res.ok ? '通过' : '失败'}（error ${res.checks.filter((c) => c.level === 'error' && !c.ok).length} / warn ${res.checks.filter((c) => !c.ok && c.level === 'warn').length}）`);
}

function backupFile(file, dir, name) {
  if (!fs.existsSync(file)) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, name));
  return true;
}

function verifyPatch(patchFile, manifests) {
  const text = fs.readFileSync(patchFile, 'utf8');
  for (const m of manifests) {
    if (!text.includes(`- id: mcp-${m.id}`)) throw new Error(`patch 缺少条目 mcp-${m.id}`);
    if (!text.includes(`"http://127.0.0.1:${m.port}"`)) throw new Error(`patch 缺少端口 ${m.port}`);
    if (m.runtime && m.runtime.serviceToken && !text.includes(m.runtime.serviceToken)) throw new Error(`patch 缺少 ${m.id} token`);
  }
}

async function install(opts, dryRun) {
  const res = await check(opts);
  printCheck(res);
  if (!res.ok) throw new Error('环境检查未通过');
  const manifests = nonLegacy();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(opts.backupsRoot, stamp);
  const prev = fs.existsSync(opts.stateFile) ? JSON.parse(fs.readFileSync(opts.stateFile, 'utf8')) : null;

  const state = {
    version: 1,
    createdAt: prev ? prev.createdAt : new Date().toISOString(),
    root: ROOT,
    dshRoot: opts.dshRoot,
    patch: opts.patch,
    profile: opts.profile,
    // 重装/升级：保留首次安装的备份与 created 记录，确保 uninstall 能恢复原始状态
    backupDir: prev ? prev.backupDir : backupDir,
    hadPatch: prev ? prev.hadPatch : fs.existsSync(opts.patch),
    hadRegistry: prev ? prev.hadRegistry : fs.existsSync(opts.registry),
    created: prev ? prev.created : { dshRoot: false, tools: false, skills: false },
  };

  if (!dryRun) {
    fs.mkdirSync(state.backupDir, { recursive: true });
    if (!prev) {
      backupFile(opts.patch, state.backupDir, 'cordis.patch.yml');
      backupFile(opts.registry, state.backupDir, 'registry.md');
    }

    // dshRoot
    if (!fs.existsSync(opts.dshRoot)) {
      fs.mkdirSync(path.dirname(opts.dshRoot), { recursive: true });
      fs.symlinkSync(DEPLOY, opts.dshRoot, symlinkType());
      state.created.dshRoot = true;
    } else if (!isSymlink(opts.dshRoot)) {
      if (!fs.existsSync(opts.tools)) { fs.symlinkSync(path.join(DEPLOY, 'tools'), opts.tools, symlinkType()); state.created.tools = true; }
      if (!fs.existsSync(opts.skills)) { fs.symlinkSync(path.join(DEPLOY, 'skills'), opts.skills, symlinkType()); state.created.skills = true; }
    } else if (linkTarget(opts.dshRoot) !== path.resolve(DEPLOY)) {
      throw new Error(`已存在的 dshskills 链接指向 ${linkTarget(opts.dshRoot)}，拒绝覆盖`);
    }

    // 生成/更新 patch 与 registry（复用 factory render，单一事实源）
    const env = {
      ...process.env,
      FACTORY_ROOT: ROOT,
      FACTORY_DATA_ROOT: opts.dataRoot,
      FACTORY_DSH_PROFILE: opts.profile,
      FACTORY_DSH_PATCH: opts.patch,
      FACTORY_DSH_TOOLS: opts.tools,
      FACTORY_DSH_SKILLS: opts.skills,
      FACTORY_DSH_REGISTRY: opts.registry,
    };
    const r = spawnSync(process.execPath, [CLI, 'render'], { cwd: ROOT, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`render 失败：${(r.stderr || r.stdout || '').slice(0, 500)}`);
    verifyPatch(opts.patch, manifests);
    fs.mkdirSync(path.dirname(opts.stateFile), { recursive: true });
    fs.writeFileSync(opts.stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  console.log(`[install] ${dryRun ? 'dry-run：未写入' : '完成'}；dshskills=${opts.dshRoot}；patch=${opts.patch}；备份=${state.backupDir}`);
  return state;
}

function restoreBackup(state, names) {
  for (const [name, target] of names) {
    const src = path.join(state.backupDir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, target);
  }
}

function uninstall(opts) {
  if (!fs.existsSync(opts.stateFile)) throw new Error(`未找到安装状态：${opts.stateFile}`);
  const state = JSON.parse(fs.readFileSync(opts.stateFile, 'utf8'));
  if (state.patch) {
    if (state.hadPatch) restoreBackup(state, [['cordis.patch.yml', opts.patch]]);
    else if (fs.existsSync(opts.patch)) fs.unlinkSync(opts.patch);
  }
  if (state.hadRegistry) restoreBackup(state, [['registry.md', opts.registry]]);
  else if (fs.existsSync(opts.registry)) fs.unlinkSync(opts.registry);

  for (const [flag, p] of [['tools', opts.tools], ['skills', opts.skills], ['dshRoot', opts.dshRoot]]) {
    if (state.created && state.created[flag] && isSymlink(p)) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
  fs.unlinkSync(opts.stateFile);
  console.log(`[uninstall] 已恢复 DSH 配置；备份保留在 ${state.backupDir}；插件数据未删除`);
}

function rollback(opts) {
  if (!fs.existsSync(opts.stateFile)) throw new Error(`未找到安装状态：${opts.stateFile}`);
  const state = JSON.parse(fs.readFileSync(opts.stateFile, 'utf8'));
  if (state.hadPatch) restoreBackup(state, [['cordis.patch.yml', opts.patch]]);
  console.log(`[rollback] 已从 ${state.backupDir} 恢复 patch`);
}

async function main() {
  const args = parse(process.argv.slice(2));
  const cmd = args._[0] || 'check';
  const opts = options(args);
  if (cmd === 'check') { printCheck(await check(opts)); return; }
  if (cmd === 'install') { await install(opts, args['dry-run'] === 'true'); return; }
  if (cmd === 'uninstall') { uninstall(opts); return; }
  if (cmd === 'rollback') { rollback(opts); return; }
  throw new Error(`未知命令：${cmd}（支持 check/install/uninstall/rollback）`);
}

main().catch((err) => { console.error(`[installer] ${err.message}`); process.exit(1); });

module.exports = { check, install, uninstall, rollback, options, parse, verifyPatch };
