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
const targetArg = positional[1];
const profile = args.profile || 'desktop';
if (cmd !== 'install' || !targetArg) {
  console.error('用法：node scripts/dsh-factory.cjs install <zip|目录|npm-spec> [--profile desktop]');
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
  const install = runDsh(['plugin', '--profile', profile, 'add', '-w', resolved.target]);
  if (install.status !== 0) {
    console.error((install.stderr || install.stdout).slice(-1500));
    throw new Error(`dsh plugin add 失败（exit=${install.status}）`);
  }
  console.log((install.stdout || '').trim().split('\n').slice(-4).join('\n'));
  const hit = profileComposed(profile, pkg?.name);
  console.log(JSON.stringify({ ok: true, profile, target: resolved.target, package: pkg?.name || null, extracted: resolved.extracted, composed: !!hit }, null, 2));
  console.log('[dsh-factory] 完成。请重开 DSH 使 bundle 生效。');
} catch (err) {
  console.error(`[dsh-factory] ${err.message}`);
  process.exit(1);
}
