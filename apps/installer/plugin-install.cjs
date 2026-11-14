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
const { spawn } = require('node:child_process');
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

async function install(opts) {
  const source = path.resolve(opts.source || '');
  if (!opts.source) fail('install 需要 --source');
  const root = path.resolve(opts.root || ROOT);
  const manifestsDir = path.resolve(opts.manifests || path.join(root, 'platform', 'manifests'));
  const pluginsDir = path.resolve(opts.plugins || path.join(root, 'plugins'));
  const deploymentDir = path.resolve(opts.deployment || path.join(root, 'deployment'));
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
    if (cmd === 'install') console.log(JSON.stringify(await install({ ...args, source: args.source, force: args.force === 'true', smoke: args['no-smoke'] !== 'true' }), null, 2));
    else if (cmd === 'uninstall' || cmd === 'rollback') console.log(JSON.stringify(uninstall(args), null, 2));
    else { console.log('用法：install --source <dir> --root <factoryRoot> [--force] [--no-smoke] | uninstall/rollback --id <id> --root <root>'); process.exit(1); }
  } catch (err) {
    console.error(`[plugin-install] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { install, uninstall, validateSource, smoke };
