#!/usr/bin/env node
'use strict';
/**
 * scripts/dsh-factory.cjs —— 一条命令安装 portable bundle
 * 用法：
 *   node scripts/dsh-factory.cjs install <zip|目录|npm-spec> [--profile desktop]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');

const args = {};
const positional = [];
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i].startsWith('--')) {
    const k = process.argv[i].slice(2);
    const v = process.argv[i + 1];
    if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
  } else positional.push(process.argv[i]);
}
const cmd = positional[0] || 'install';
let targetArg = positional[1];
const profile = args.profile || 'desktop';
if (cmd === 'rollback') {
  const registry = require(path.join(__dirname, '..', 'packages', 'plugin-registry.js'));
  const id = positional[1];
  if (!id) {
    console.error('用法：node scripts/dsh-factory.cjs rollback <plugin-id> [--version x.y.z] [--profile desktop] [--dry-run]');
    process.exit(1);
  }
  const target = registry.previous(id, args.version);
  if (!target) {
    console.error(`[dsh-factory] 没有可回滚的已安装版本：${id}${args.version ? `@${args.version}` : ''}`);
    process.exit(1);
  }
  targetArg = target.zip;
  if (args['dry-run'] === 'true') {
    console.log(JSON.stringify({ ok: true, dryRun: true, id, version: target.version, zip: target.zip }, null, 2));
    process.exit(0);
  }
}
if ((cmd !== 'install' && cmd !== 'rollback') || !targetArg) {
  console.error('用法：node scripts/dsh-factory.cjs install <zip|目录|npm-spec> [--profile desktop]');
  console.error('      node scripts/dsh-factory.cjs rollback <plugin-id> [--version x.y.z] [--profile desktop] [--dry-run]');
  process.exit(1);
}

function quote(s) { return `"${String(s)}"`; }
function dshBin() {
  if (process.env.DSH_CLI) return process.env.DSH_CLI;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const p = path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
    if (fs.existsSync(p)) return p;
  }
  return 'dsh';
}
function runDsh(dshArgs) {
  const dsh = dshBin();
  if (process.platform === 'win32' && /\.cmd$/i.test(dsh)) {
    const line = [quote(dsh), ...dshArgs.map(quote)].join(' ');
    const r = spawnSync(line, { shell: true, encoding: 'utf8', timeout: 300000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || r.error?.message || '' };
  }
  const r = spawnSync(dsh, dshArgs, { encoding: 'utf8', timeout: 300000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || r.error?.message || '' };
}
function findPackageDir(root) {
  if (fs.existsSync(path.join(root, 'package.json'))) return root;
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name);
    if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'package.json'))) return p;
  }
  return null;
}
function resolveTarget(input) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { target: input, extracted: null };
  if (!/\.zip$/i.test(abs)) return { target: abs, extracted: null };
  const cache = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'dsh-factory', 'bundles', path.basename(abs, '.zip'));
  fs.rmSync(cache, { recursive: true, force: true });
  fs.mkdirSync(cache, { recursive: true });
  new AdmZip(abs).extractAllTo(cache, true);
  const dir = findPackageDir(cache);
  if (!dir) throw new Error('zip 内找不到 package.json');
  return { target: dir, extracted: dir };
}
function readPkg(dir) {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) throw new Error(`不是 bundle 目录：${dir}`);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!pkg.dsh?.bundle?.patch) throw new Error('package.json 缺少 dsh.bundle.patch');
  return pkg;
}

function profileFile(profileName) {
  return path.join(process.env.USERPROFILE || os.homedir(), '.dsh', 'profiles', profileName, 'package.json');
}

function profileData(profileName) {
  const file = profileFile(profileName);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function profileDependency(profileName, pkgName) {
  const data = profileData(profileName);
  return data?.dependencies?.[pkgName] || null;
}

function installedVersion(profileName, pkgName) {
  const spec = profileDependency(profileName, pkgName);
  if (!spec || !spec.startsWith('link:')) return null;
  try {
    const dir = path.resolve(path.dirname(profileFile(profileName)), spec.slice('link:'.length));
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null;
  } catch { return null; }
}

function assertProfileHealthy(profileName) {
  const file = profileFile(profileName);
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const deps = data.dependencies || {};
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== 'string' || !spec.startsWith('link:')) continue;
    const target = path.resolve(path.dirname(file), spec.slice('link:'.length));
    if (!fs.existsSync(target)) {
      throw new Error(`profile 依赖损坏：${name} -> ${target} 不存在。先移除该 bundle（plugin_manager remove_bundle "${name}"）再安装。`);
    }
  }
}

function profileComposed(profileName, pkgName) {
  if (!pkgName) return false;
  try {
    const file = profileFile(profileName);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return !!(data.dependencies || {})[pkgName] && (data.dsh?.profile?.bundles || []).includes(pkgName);
  } catch { return false; }
}

try {
  assertProfileHealthy(profile);
  const resolved = resolveTarget(targetArg);
  const pkg = fs.existsSync(resolved.target) && fs.statSync(resolved.target).isDirectory() ? readPkg(resolved.target) : null;
  console.log(`[dsh-factory] profile=${profile} target=${resolved.target}`);
  if (pkg?.name) {
    const oldSpec = profileDependency(profile, pkg.name);
    const oldVersion = installedVersion(profile, pkg.name);
    const changed = oldSpec && (oldVersion !== (pkg.version || '0.1.0') || oldSpec !== `link:${path.resolve(resolved.target).replace(/\\/g, '/')}`);
    if (changed) {
      console.log(`[dsh-factory] 升级 ${pkg.name}: ${oldVersion || '?'} -> ${pkg.version || '0.1.0'}，先移除旧 link`);
      const removed = runDsh(['plugin', '--profile', profile, 'remove', pkg.name]);
      if (removed.status !== 0) {
        console.error((removed.stderr || removed.stdout).slice(-1200));
        throw new Error(`移除旧版本失败（exit=${removed.status}）`);
      }
    }
  }
  const install = runDsh(['plugin', '--profile', profile, 'add', '-w', resolved.target]);
  if (install.status !== 0) {
    console.error((install.stderr || install.stdout).slice(-1500));
    throw new Error(`dsh plugin add 失败（exit=${install.status}）`);
  }
  console.log((install.stdout || '').trim().split('\n').slice(-4).join('\n'));
  const hit = profileComposed(profile, pkg?.name);
  if (pkg?.name) {
    try {
      const registry = require(path.join(__dirname, '..', 'packages', 'plugin-registry.js'));
      const id = pkg.name.replace(/^dsh-plugin-/, '');
      const zipPath = /\.zip$/i.test(String(targetArg)) ? path.resolve(targetArg) : null;
      registry.record({
        id, version: pkg.version || '0.1.0', requestId: null, zip: zipPath,
        pluginDir: resolved.target, tools: [], installed: true,
      });
    } catch (e) {
      console.error(`[dsh-factory] 写入注册表失败（不影响安装）：${e.message}`);
    }
  }
  console.log(JSON.stringify({ ok: true, profile, target: resolved.target, package: pkg?.name || null, extracted: resolved.extracted, composed: !!hit }, null, 2));
  console.log('[dsh-factory] 完成。请重开 DSH 使 bundle 生效。');
} catch (err) {
  console.error(`[dsh-factory] ${err.message}`);
  process.exit(1);
}
