#!/usr/bin/env node
'use strict';

/**
 * apps/installer/plugin-install.cjs —— M4 生成插件安装器（accept 后）
 *
 * 命令：
 *   node plugin-install.cjs install --source <pluginDir> --root <factoryRoot> [--force] [--no-smoke]
 *   node plugin-install.cjs uninstall --id <id> --root <factoryRoot>
 *   node plugin-install.cjs rollback  --id <id> --root <factoryRoot>
 *
 * 目录约定（root 下）：
 *   plugins/<id>/                插件（service/report/fixtures…）
 *   deployment/tools/<id>-mcp/   MCP 薄壳
 *   deployment/skills/<id>/      SKILL
 *   platform/manifests/<id>.json 工厂 manifest（相对路径）
 *   platform/manifests/.installed/<id>.json 安装状态/备份索引
 *
 * 门禁：只安装已通过 staging 的生成目录；默认 smoke（health + 401/200）；失败自动回滚。
 * 边界：不修改 DSH profile；不安装到非空 id（除非 --force，旧目录会备份）。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { validatePluginSpec } = require('../../packages/sdk');

const ROOT = path.resolve(__dirname, '..', '..');

function fail(msg) { const e = new Error(msg); e.code = 'INSTALL'; throw e; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function rel(root, p) { return path.relative(root, p).split(path.sep).join('/'); }
function stateDir(manifestsDir) { return path.join(manifestsDir, '.installed'); }
function stateFile(manifestsDir, id) { return path.join(stateDir(manifestsDir), `${id}.json`); }

function validateSource(sourceDir) {
  const pluginFile = path.join(sourceDir, 'plugin.json');
  const manifestFile = path.join(sourceDir, 'manifest.json');
  if (!fs.existsSync(pluginFile)) fail(`缺少 plugin.json：${pluginFile}`);
  if (!fs.existsSync(manifestFile)) fail(`缺少 manifest.json：${manifestFile}`);
  const spec = readJson(pluginFile);
  const v = validatePluginSpec(spec);
  if (!v.ok) fail(`plugin.json 校验失败：${v.errors.join('; ')}`);
  for (const relPath of ['service/server.js', 'service/runner.js', 'gen-report.mjs', 'fixtures/data.json']) {
    if (!fs.existsSync(path.join(sourceDir, relPath))) fail(`缺少文件：${relPath}`);
  }
  return { spec, manifest: readJson(manifestFile) };
}

function smoke(serviceDir, token, factoryRoot) {
  return new Promise((resolve) => {
    const port = 18000 + Math.floor(Math.random() * 2000);
    const child = spawn(process.execPath, ['server.js'], {
      cwd: serviceDir,
      env: { ...process.env, PORT: String(port), FACTORY_ROOT: factoryRoot },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    const done = (result) => { try { child.kill(); } catch { /* ignore */ } resolve({ ...result, port, stderr: stderr.slice(0, 800) }); };
    const deadline = Date.now() + 12000;
    const tick = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) {
          const h = await r.json();
          const noAuth = await fetch(`http://127.0.0.1:${port}/jobs`, { signal: AbortSignal.timeout(1000) });
          const withAuth = await fetch(`http://127.0.0.1:${port}/jobs`, {
            headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000),
          });
          return done({ ok: h.ok === true && noAuth.status === 401 && withAuth.status === 200, health: h, noAuth: noAuth.status, withAuth: withAuth.status });
        }
      } catch { /* retry */ }
      if (Date.now() > deadline) return done({ ok: false, reason: 'health timeout', stderr });
      return setTimeout(tick, 200);
    };
    tick();
  });
}

function preflight(opts = {}) {
  if (!opts.source) fail('preflight 需要 --source');
  const source = path.resolve(opts.source);
  const root = path.resolve(opts.root || ROOT);
  const manifestsDir = path.resolve(opts.manifests || path.join(root, 'platform', 'manifests'));
  const pluginsDir = path.resolve(opts.plugins || path.join(root, 'plugins'));
  const deploymentDir = path.resolve(opts.deployment || path.join(root, 'deployment'));
  const { spec, manifest } = validateSource(source);
  const id = spec.id;
  const planned = {
    plugin: path.join(pluginsDir, id),
    tool: path.join(deploymentDir, 'tools', `${id}-mcp`),
    skill: path.join(deploymentDir, 'skills', id),
    manifest: path.join(manifestsDir, `${id}.json`),
  };
  const conflicts = Object.entries(planned).filter(([, p]) => fs.existsSync(p)).map(([k, p]) => ({ kind: k, path: p }));
  return {
    ok: !!opts.force || conflicts.length === 0,
    id, source, root, version: spec.version, port: manifest.port, conflicts, planned, force: !!opts.force,
  };
}

async function install(opts) {
  const source = path.resolve(opts.source || '');
  if (!opts.source) fail('install 需要 --source');
  const root = path.resolve(opts.root || ROOT);
  const manifestsDir = path.resolve(opts.manifests || path.join(root, 'platform', 'manifests'));
  const pluginsDir = path.resolve(opts.plugins || path.join(root, 'plugins'));
  const deploymentDir = path.resolve(opts.deployment || path.join(root, 'deployment'));
  const pre = preflight({ ...opts, root });
  if (opts.dryRun) return { ...pre, dryRun: true };
  if (!pre.ok) fail(`存在冲突：${pre.conflicts.map((c) => c.kind).join('/')}（如需覆盖加 --force）`);
  const { spec, manifest } = validateSource(source);
  const id = spec.id;
  const dest = path.join(pluginsDir, id);
  const toolDir = path.join(deploymentDir, 'tools', `${id}-mcp`);
  const skillDir = path.join(deploymentDir, 'skills', id);
  const manifestFile = path.join(manifestsDir, `${id}.json`);
  if (fs.existsSync(dest) && !opts.force) fail(`插件已存在：${dest}（如需覆盖加 --force）`);
  fs.mkdirSync(stateDir(manifestsDir), { recursive: true });

  const backups = [];
  const backupDir = (p) => {
    if (!fs.existsSync(p)) return '';
    const b = `${p}.bak-${ts()}`;
    fs.renameSync(p, b);
    backups.push({ original: p, backup: b });
    return b;
  };

  const installed = { id, installedAt: new Date().toISOString(), source, root, backups, dirs: {} };
  try {
    backupDir(dest);
    backupDir(toolDir);
    backupDir(skillDir);
    if (fs.existsSync(manifestFile)) {
      const b = path.join(stateDir(manifestsDir), `${id}.manifest.bak-${ts()}.json`);
      fs.copyFileSync(manifestFile, b);
      installed.manifestBackup = b;
    }

    fs.cpSync(source, dest, { recursive: true, force: true });
    fs.cpSync(path.join(source, 'mcp'), toolDir, { recursive: true, force: true });
    fs.cpSync(path.join(source, 'skills', id), skillDir, { recursive: true, force: true });

    const reportName = manifest.report?.output ? String(manifest.report.output).split(/[\\/]/).pop() : `${id}-report.html`;
    const absManifest = {
      ...manifest,
      service: { ...manifest.service, dir: path.join(dest, 'service'), dataDir: path.join(dest, 'service', 'data') },
      mcp: { ...manifest.mcp, dir: toolDir },
      skill: { ...manifest.skill, dir: skillDir },
      report: { ...manifest.report, generator: path.join(dest, 'gen-report.mjs'), output: path.join(dest, 'report', reportName) },
    };
    // 服务运行时读取安装目录下的 manifest.json（绝对路径）
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(absManifest, null, 2) + '\n', 'utf8');
    // 工厂注册用相对路径（FACTORY_ROOT 解析）
    const installedManifest = {
      ...absManifest,
      service: { ...absManifest.service, dir: rel(root, absManifest.service.dir), dataDir: rel(root, absManifest.service.dataDir) },
      mcp: { ...absManifest.mcp, dir: rel(root, absManifest.mcp.dir) },
      skill: { ...absManifest.skill, dir: rel(root, absManifest.skill.dir) },
      report: { ...absManifest.report, generator: rel(root, absManifest.report.generator), output: rel(root, absManifest.report.output) },
    };
    fs.writeFileSync(manifestFile, JSON.stringify(installedManifest, null, 2) + '\n', 'utf8');

    installed.dirs = { plugin: dest, tool: toolDir, skill: skillDir, manifest: manifestFile };
    if (opts.smoke !== false) {
      const smokeResult = await smoke(path.join(dest, 'service'), installedManifest.runtime?.serviceToken, root);
      installed.smoke = smokeResult;
      if (!smokeResult.ok) throw new Error(`smoke 失败：health/401/200 未通过（${smokeResult.reason || ''}）`);
    }
    if (opts.render) {
      const cli = path.join(root, 'platform', 'factory', 'cli.cjs');
      if (!fs.existsSync(cli)) throw new Error(`--render 需要工厂 CLI：${cli}`);
      const r = spawnSync(process.execPath, ['cli.cjs', 'render'], {
        cwd: path.dirname(cli), env: { ...process.env, FACTORY_ROOT: root }, encoding: 'utf8', timeout: 120000,
      });
      installed.render = { ok: r.status === 0, stdout: (r.stdout || '').slice(0, 2000), stderr: (r.stderr || '').slice(0, 2000) };
      if (r.status !== 0) throw new Error(`render 失败：${(r.stderr || r.stdout || '').slice(0, 500)}`);
    }
    fs.writeFileSync(stateFile(manifestsDir, id), JSON.stringify(installed, null, 2) + '\n', 'utf8');
    return { ok: true, ...installed };
  } catch (err) {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(toolDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(skillDir, { recursive: true, force: true }); } catch { /* ignore */ }
    for (const b of backups) {
      try { if (fs.existsSync(b.backup)) fs.renameSync(b.backup, b.original); } catch { /* ignore */ }
    }
    throw err;
  }
}

function compareVersion(a, b) {
  const pa = String(a || '0').split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function installedState(opts, id) {
  const root = path.resolve(opts.root || ROOT);
  const manifestsDir = path.resolve(opts.manifests || path.join(root, 'platform', 'manifests'));
  const sf = stateFile(manifestsDir, id);
  if (!fs.existsSync(sf)) fail(`未找到安装状态：${sf}`);
  return { root, manifestsDir, state: readJson(sf) };
}

async function upgrade(opts) {
  if (!opts.source) fail('upgrade 需要 --source');
  const sourceSpec = validateSource(path.resolve(opts.source)).spec;
  const { root, state } = installedState(opts, sourceSpec.id);
  const current = readJson(path.join(state.dirs.plugin, 'plugin.json')).version;
  if (!opts.force && compareVersion(sourceSpec.version, current) <= 0) {
    fail(`源版本 ${sourceSpec.version} 不高于已安装 ${current}（如需降级/重装加 --force）`);
  }
  const result = await install({ ...opts, root, force: true });
  return { ...result, upgradedFrom: current, upgradedTo: sourceSpec.version };
}

function listInstalled(opts = {}) {
  const root = path.resolve(opts.root || ROOT);
  const manifestsDir = path.resolve(opts.manifests || path.join(root, 'platform', 'manifests'));
  const dir = stateDir(manifestsDir);
  if (!fs.existsSync(dir)) return { ok: true, installed: [] };
  const installed = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('.manifest.bak')).map((f) => {
    const s = readJson(path.join(dir, f));
    return { id: s.id, installedAt: s.installedAt, source: s.source, dirs: s.dirs, smoke: s.smoke?.ok, render: s.render?.ok };
  });
  return { ok: true, installed };
}

function verify(opts) {
  const id = String(opts.id || '').trim();
  if (!id) fail('verify 需要 --id');
  const { root, state } = installedState(opts, id);
  const checks = [];
  for (const key of ['plugin', 'tool', 'skill', 'manifest']) {
    const p = state.dirs?.[key];
    checks.push({ name: key, ok: !!p && fs.existsSync(p), path: p || '' });
  }
  const pluginJson = path.join(state.dirs.plugin, 'plugin.json');
  checks.push({ name: 'plugin.json', ok: fs.existsSync(pluginJson), path: pluginJson });
  const manifestFile = state.dirs.manifest;
  let manifest = null;
  try { manifest = readJson(manifestFile); checks.push({ name: 'manifest.json', ok: true, path: manifestFile }); } catch { checks.push({ name: 'manifest.json', ok: false, path: manifestFile }); }
  const server = path.join(state.dirs.plugin, 'service', 'server.js');
  checks.push({ name: 'service/server.js', ok: fs.existsSync(server), path: server });
  const ok = checks.every((c) => c.ok);
  return { ok, id, root, checks, version: manifest?.version || '', errors: checks.filter((c) => !c.ok).map((c) => c.name) };
}

function uninstall(opts) {
  const id = String(opts.id || '').trim();
  if (!id) fail('uninstall 需要 --id');
  const root = path.resolve(opts.root || ROOT);
  const manifestsDir = path.resolve(opts.manifests || path.join(root, 'platform', 'manifests'));
  const sf = stateFile(manifestsDir, id);
  if (!fs.existsSync(sf)) fail(`未找到安装状态：${sf}`);
  const state = readJson(sf);
  for (const key of ['plugin', 'tool', 'skill']) {
    const p = state.dirs?.[key];
    if (p) fs.rmSync(p, { recursive: true, force: true });
  }
  if (state.dirs?.manifest) fs.rmSync(state.dirs.manifest, { force: true });
  for (const b of state.backups || []) {
    if (fs.existsSync(b.backup)) fs.renameSync(b.backup, b.original);
  }
  if (state.manifestBackup && fs.existsSync(state.manifestBackup)) {
    fs.copyFileSync(state.manifestBackup, path.join(manifestsDir, `${id}.json`));
  }
  fs.rmSync(sf, { force: true });
  return { ok: true, id, uninstalledAt: new Date().toISOString() };
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[a.slice(2)] = next; i += 1; } else args[a.slice(2)] = 'true';
  }
  const cmd = args._ || process.argv[2];
  try {
    if (cmd === 'install') console.log(JSON.stringify(await install({ ...args, source: args.source, force: args.force === 'true', smoke: args['no-smoke'] !== 'true', render: args.render === 'true', dryRun: args['dry-run'] === 'true' }), null, 2));
    else if (cmd === 'check') console.log(JSON.stringify(preflight(args), null, 2));
    else if (cmd === 'upgrade') console.log(JSON.stringify(await upgrade({ ...args, source: args.source, force: args.force === 'true', smoke: args['no-smoke'] !== 'true', render: args.render === 'true' }), null, 2));
    else if (cmd === 'uninstall' || cmd === 'rollback') console.log(JSON.stringify(uninstall(args), null, 2));
    else if (cmd === 'list') console.log(JSON.stringify(listInstalled(args), null, 2));
    else if (cmd === 'verify') console.log(JSON.stringify(verify(args), null, 2));
    else { console.log('用法：install/upgrade --source <dir> --root <root> [--force] [--no-smoke] [--render] | uninstall/rollback/verify --id <id> | list'); process.exit(1); }
  } catch (err) {
    console.error(`[plugin-install] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { install, upgrade, uninstall, listInstalled, verify, preflight, compareVersion, validateSource, smoke };
