#!/usr/bin/env node
'use strict';

/**
 * apps/generator/generator.cjs —— M3 生成流水线（fixture 垂直切片）
 *
 * 命令：
 *   node apps/generator/generator.cjs generate --id <id> --name <中文名> [--type api] [--port 0] [--out dir] [--fixture file] [--force]
 *   node apps/generator/generator.cjs validate --dir <dir> [--port 0]
 *   node apps/generator/generator.cjs staging  --id <id> --name <名称> [...]   # generate + validate
 *
 * 生成内容：plugin.json + manifest.json + service + mcp + skill + report + fixtures + evidence。
 * 边界：M3 先做"可运行模板 + 校验/预演"；真实业务数据源与 AI 业务实现尚未接入。
 */

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const sandbox = require('./sandbox.cjs');
const config = require('../../packages/config');
const { validatePluginSpec, slugRegex } = require('../../packages/sdk');
const { applyBusinessRunner } = require('./business.cjs');

const ROOT = config.FACTORY_ROOT;
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'plugin');
const DEFAULT_OUT_ROOT = path.join(config.FACTORY_DATA_ROOT, 'generator', 'staging');
const MCP_SHELL = path.join(ROOT, 'deployment', 'tools', 'listing-list-mcp', 'index.js');
const FREE_PORT_START = 20000;

function log(msg) { console.log(`[generator] ${msg}`); }
function fail(msg) { throw new Error(msg); }
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fill(text, vars) { return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] === undefined ? `{{${k}}}` : String(vars[k]))); }
function readTemplate(rel, vars) { return fill(fs.readFileSync(path.join(TEMPLATE_DIR, rel), 'utf8'), vars); }
function writeTemplate(rel, dest, vars) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, readTemplate(rel, vars), 'utf8');
}
function nodeCheck(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => { err += c; });
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.slice(0, 500) }));
  });
}

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[k] = next; i += 1; } else args[k] = 'true';
    } else args._.push(a);
  }
  return args;
}

function assertSafeOut(out) {
  const abs = path.resolve(out);
  if (abs === path.resolve(ROOT)) fail('拒绝生成到仓库根目录');
  if (abs === path.resolve(config.FACTORY_DATA_ROOT) || abs === path.resolve(ROOT, 'platform') || abs === path.resolve(ROOT, 'plugins')) {
    fail(`拒绝生成到受保护目录：${abs}`);
  }
  return abs;
}

async function generate(opts) {
  if (!slugRegex.test(String(opts.id || ''))) fail('id 必须是 kebab-case');
  if (!opts.name) fail('缺少 --name');
  const type = opts.type || 'api';
  if (!['api', 'browser', 'file'].includes(type)) fail(`未知 type：${type}`);
  const id = opts.id;
  const taskType = id.replace(/-/g, '_');
  const port = Number(opts.port) > 0 ? Number(opts.port) : await freePort();
  const out = assertSafeOut(opts.out || path.join(DEFAULT_OUT_ROOT, id));
  if (fs.existsSync(out) && !opts.force) fail(`输出目录已存在：${out}（如需覆盖加 --force）`);
  if (fs.existsSync(out) && opts.force) fs.rmSync(out, { recursive: true, force: true });

  const version = opts.version || '0.1.0';
  const outputs = Array.isArray(opts.outputs) && opts.outputs.length ? opts.outputs : ['dataset', 'report'];
  const needReport = outputs.includes('report');
  const effect = opts.effect || 'read';
  const spec = {
    id, version, name: String(opts.name), type, effect, outputs, runtimeRange: '^3.2',
    owner: String(opts.owner || 'local'), taskType,
    paramsSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } }, additionalProperties: false },
    outputSchema: { type: 'object' },
    permissions: { write: ['write', 'message', 'file', 'mixed'].includes(effect), network: [], browser: type === 'browser' },
    service: { entry: 'server.js', runner: 'runner.js' },
    mcp: { serverName: id },
    skill: { name: id },
    report: needReport ? { generator: 'gen-report.mjs' } : {},
  };
  const v = validatePluginSpec(spec);
  if (!v.ok) fail(`plugin.json 校验失败：${v.errors.join('; ')}`);

  const serviceToken = crypto.randomBytes(16).toString('hex');
  const manifest = {
    id, name: spec.name, type, version, port, taskType, serverName: id,
    service: {
      dir: path.join(out, 'service'), entry: 'server.js', runner: 'runner.js',
      dataDir: path.join(out, 'service', 'data'), startCmd: ['node', ['server.js']],
    },
    runtime: { write: ['write', 'message', 'mixed'].includes(effect), retentionDays: 1, token: true, toolTimeoutMs: 60000, serviceToken },
    mcp: { dir: path.join(out, 'mcp') },
    skill: { dir: path.join(out, 'skills', id) },
    report: needReport ? { generator: path.join(out, 'gen-report.mjs'), output: path.join(out, 'report', `${id}-report.html`) } : null,
    secrets: [],
    legacy: false,
  };

  fs.mkdirSync(out, { recursive: true });
  if (needReport) fs.mkdirSync(path.join(out, 'report'), { recursive: true });
  fs.writeFileSync(path.join(out, 'plugin.json'), JSON.stringify(spec, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const vars = { id, name: spec.name, taskType, port, version };
  writeTemplate('service/server.js.tmpl', path.join(out, 'service', 'server.js'), vars);
  writeTemplate('service/runner.js.tmpl', path.join(out, 'service', 'runner.js'), vars);
  let runnerKind = 'fixture';
  let runnerWarnings = [];
  if (opts.runnerFile || opts.runnerSource) {
    const source = opts.runnerFile
      ? fs.readFileSync(path.resolve(opts.runnerFile), 'utf8')
      : String(opts.runnerSource);
    const applied = applyBusinessRunner(out, source);
    runnerKind = 'custom';
    runnerWarnings = applied.warnings;
  }
  writeTemplate('service/.env.tmpl', path.join(out, 'service', '.env'), vars);
  writeTemplate('mcp/config.json.tmpl', path.join(out, 'mcp', 'config.json'), vars);
  writeTemplate('mcp/package.json.tmpl', path.join(out, 'mcp', 'package.json'), vars);
  writeTemplate('mcp/smoke.cjs.tmpl', path.join(out, 'mcp', 'smoke.cjs'), vars);
  writeTemplate('skills/SKILL.md.tmpl', path.join(out, 'skills', id, 'SKILL.md'), vars);
  if (needReport) {
    writeTemplate('report/gen-report.mjs.tmpl', path.join(out, 'gen-report.mjs'), vars);
    if (opts.reportFile) {
      const reportSource = fs.readFileSync(path.resolve(opts.reportFile), 'utf8');
      fs.writeFileSync(path.join(out, 'gen-report.mjs'), reportSource, 'utf8');
    }
  }

  const mcpShell = fs.readFileSync(MCP_SHELL, 'utf8').replace(/const SERVER_NAME = '[^']+';/, `const SERVER_NAME = '${id}-mcp';`);
  if (!/const SERVER_NAME = '/.test(mcpShell)) fail('MCP 薄壳复制失败：未找到 SERVER_NAME');
  fs.writeFileSync(path.join(out, 'mcp', 'index.js'), mcpShell, 'utf8');

  const fixtureFile = opts.fixture ? path.resolve(opts.fixture) : '';
  if (fixtureFile) {
    if (!fs.existsSync(fixtureFile)) fail(`fixture 不存在：${fixtureFile}`);
    fs.mkdirSync(path.join(out, 'fixtures'), { recursive: true });
    fs.copyFileSync(fixtureFile, path.join(out, 'fixtures', 'data.json'));
  } else {
    fs.mkdirSync(path.join(out, 'fixtures'), { recursive: true });
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `FIX-${String(i + 1).padStart(3, '0')}`, name: `示例行 ${i + 1}`, value: (i + 1) * 10 }));
    fs.writeFileSync(path.join(out, 'fixtures', 'data.json'), JSON.stringify({ rows }, null, 2) + '\n', 'utf8');
  }

  const syntaxFiles = ['service/server.js', 'service/runner.js', 'mcp/index.js', 'mcp/smoke.cjs'];
  if (needReport) syntaxFiles.push('gen-report.mjs');
  const checks = [];
  for (const rel of syntaxFiles) {
    const r = await nodeCheck(path.join(out, rel));
    checks.push({ name: `syntax:${rel}`, ok: r.ok, error: r.error || '' });
    if (!r.ok) fail(`语法检查失败 ${rel}：${r.error}`);
  }
  checks.push({ name: 'schema:plugin.json', ok: true });
  fs.mkdirSync(path.join(out, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(out, 'evidence', 'generation.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), template: 'm3-fixture-v1', runnerKind, runnerWarnings, spec, manifest, checks,
  }, null, 2) + '\n', 'utf8');
  log(`generated ${id} → ${out} (port ${port})`);
  return { out, spec, manifest, checks };
}

async function health(port, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(200);
  }
  return null;
}
async function jpost(port, p, body, token) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function jget(port, p, token) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function validateDir(dir, opts = {}) {
  const out = path.resolve(dir);
  const errors = [];
  const checks = [];
  const add = (name, ok, detail = '') => { checks.push({ name, ok, detail }); if (!ok) errors.push(`${name}：${detail}`); };
  const pluginFile = path.join(out, 'plugin.json');
  const manifestFile = path.join(out, 'manifest.json');
  if (!fs.existsSync(pluginFile) || !fs.existsSync(manifestFile)) {
    return { ok: false, errors: ['缺少 plugin.json / manifest.json'], checks: [{ name: 'files', ok: false }] };
  }
  const spec = JSON.parse(fs.readFileSync(pluginFile, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const v = validatePluginSpec(spec);
  add('schema:plugin.json', v.ok, v.errors.join('; '));
  for (const [name, rel] of [['service/server.js', 'service/server.js'], ['service/runner.js', 'service/runner.js'], ['mcp/index.js', 'mcp/index.js'], ['mcp/config.json', 'mcp/config.json'], ['skill', path.join('skills', spec.id, 'SKILL.md')], ['fixture', 'fixtures/data.json']]) {
    add(`exists:${name}`, fs.existsSync(path.join(out, rel)), rel);
  }
  const outputs = Array.isArray(spec.outputs) && spec.outputs.length ? spec.outputs : ['dataset', 'report'];
  if (outputs.includes('report')) add('exists:report', fs.existsSync(path.join(out, 'gen-report.mjs')), 'gen-report.mjs');
  const mcpCfg = fs.existsSync(path.join(out, 'mcp', 'config.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'mcp', 'config.json'), 'utf8')) : null;
  add('mcp:port', !!mcpCfg && Number(new URL(mcpCfg.service.baseUrl).port) === manifest.port, `manifest=${manifest.port}`);
  const skill = fs.existsSync(path.join(out, 'skills', spec.id, 'SKILL.md')) ? fs.readFileSync(path.join(out, 'skills', spec.id, 'SKILL.md'), 'utf8') : '';
  add('skill:name', (skill.match(/^name:\s*(\S+)/m) || [])[1] === spec.id, spec.id);
  for (const rel of ['service/server.js', 'service/runner.js', 'mcp/index.js', 'mcp/smoke.cjs']) {
    if (!fs.existsSync(path.join(out, rel))) continue;
    const r = await nodeCheck(path.join(out, rel));
    add(`syntax:${rel}`, r.ok, r.error || '');
  }
  if (outputs.includes('report') && fs.existsSync(path.join(out, 'gen-report.mjs'))) {
    const r = await nodeCheck(path.join(out, 'gen-report.mjs'));
    add('syntax:gen-report.mjs', r.ok, r.error || '');
  }
  if (errors.length) {
    fs.mkdirSync(path.join(out, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(out, 'evidence', 'validation.json'), JSON.stringify({ validatedAt: new Date().toISOString(), ok: false, checks, errors }, null, 2) + '\n', 'utf8');
    return { ok: false, errors, checks };
  }

  if (opts.staticOnly) {
    fs.mkdirSync(path.join(out, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(out, 'evidence', 'validation-static.json'), JSON.stringify({ validatedAt: new Date().toISOString(), ok: true, checks, errors: [] }, null, 2) + '\n', 'utf8');
    log(`validate(static) ${spec.id}: PASS`);
    return { ok: true, errors: [], checks, staticOnly: true };
  }

  // 预演：启动生成服务 → health → submit → done → result → dataset
  const port = Number(opts.port) > 0 ? Number(opts.port) : await freePort();
  const serviceDir = path.join(out, 'service');
  const useSandbox = sandbox.supportsPermissionModel() && process.env.FACTORY_SANDBOX !== '0';
  const serviceEnv = {
    ...process.env, PORT: String(port), FACTORY_ROOT: ROOT,
    // 沙箱内不探测 legacy DSH 路径（config 会在模块加载时 existsSync）
    FACTORY_DSH_TOOLS: path.join(ROOT, 'deployment', 'tools'),
    FACTORY_DSH_SKILLS: path.join(ROOT, 'deployment', 'skills'),
    FACTORY_DSH_REGISTRY: path.join(ROOT, 'deployment', 'registry.md'),
    FACTORY_DSH_PATCH: path.join(ROOT, 'data', '.sandbox-placeholder.yml'),
  };
  const child = useSandbox
    ? sandbox.spawnSandboxed(['server.js'], {
      cwd: serviceDir, env: serviceEnv,
      readDirs: [ROOT, out], writeDirs: [out], stdio: ['ignore', 'ignore', 'pipe'],
    })
    : spawn(process.execPath, ['server.js'], {
      cwd: serviceDir, env: serviceEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  add('sandbox:service', useSandbox, useSandbox ? 'node --permission（只读仓库/staging，只写 staging）' : '不支持或已禁用');
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  let datasetPath = '';
  let rowsCount = 0;
  try {
    const h = await health(port);
    add('staging:health', !!h && h.ok === true, h ? `id=${h.id}` : stderr.slice(0, 300));
    if (!h) throw new Error('生成服务未通过 health');
    const token = manifest.runtime.serviceToken;
    const stagingParams = { limit: 2 };
    if (['write', 'message', 'mixed'].includes(spec.effect)) stagingParams.dry_run = true;
    const sub = await jpost(port, '/jobs', { params: stagingParams }, token);
    add('staging:submit', sub.status === 202, `status=${sub.status}`);
    if (sub.status !== 202) throw new Error(`submit 失败：${sub.status}`);
    let final = null;
    for (let i = 0; i < 80; i += 1) {
      await sleep(100);
      const s = await jget(port, `/jobs/${sub.body.jobId}`, token);
      if (['done', 'failed', 'cancelled'].includes(s.body.status)) { final = s.body; break; }
    }
    add('staging:done', final && final.status === 'done', final ? `status=${final.status} ${final.error || ''}` : 'timeout');
    if (!final || final.status !== 'done') throw new Error('生成任务未 done');
    const res = await jget(port, `/jobs/${sub.body.jobId}/result`, token);
    add('staging:result', res.status === 200 && !!res.body.main, `status=${res.status}`);
    if (res.status !== 200) throw new Error('result 获取失败');
    datasetPath = res.body.main.path;
    const ds = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    rowsCount = (ds.pages || []).flatMap((p) => p.rows || []).length;
    add('staging:dataset', ds.task === spec.taskType && rowsCount > 0, `task=${ds.task} rows=${rowsCount}`);

    const reportScript = path.join(out, 'gen-report.mjs');
    const reportFile = path.join(out, 'report', `${spec.id}-report.html`);
    if (outputs.includes('report') && fs.existsSync(reportScript)) {
      const reportArgs = sandbox.buildArgs({ readDirs: [ROOT, out], writeDirs: [out], scriptArgs: [reportScript, datasetPath] });
      const rep = spawnSync(process.execPath, reportArgs, {
        cwd: out, env: { ...process.env, FACTORY_ROOT: ROOT }, encoding: 'utf8', timeout: 30000,
      });
      add('sandbox:report', sandbox.supportsPermissionModel() && process.env.FACTORY_SANDBOX !== '0', 'node --permission');
      add('staging:report', rep.status === 0 && fs.existsSync(reportFile) && fs.statSync(reportFile).size > 0,
        rep.status === 0 ? reportFile : `exit=${rep.status} ${(rep.stderr || '').slice(0, 300)}`);
    } else if (outputs.includes('report')) {
      add('staging:report', false, '缺 gen-report.mjs');
    }
  } catch (err) {
    errors.push(`staging：${err.message}`);
  } finally {
    try { child.kill(); } catch { /* ignore */ }
    await sleep(300);
  }
  const ok = errors.length === 0;
  fs.mkdirSync(path.join(out, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(out, 'evidence', 'validation.json'), JSON.stringify({
    validatedAt: new Date().toISOString(), ok, spec, manifest, checks, errors, datasetPath,
    reportPath: path.join(out, 'report', `${spec.id}-report.html`), rows: rowsCount, stderr: stderr.slice(0, 2000),
  }, null, 2) + '\n', 'utf8');
  log(`validate ${spec.id}: ${ok ? 'PASS' : 'FAIL'} (${rowsCount} rows)`);
  return { ok, errors, checks, datasetPath, rows: rowsCount };
}

async function main() {
  const args = parse(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  if (cmd === 'generate') {
    const r = await generate(args);
    console.log(JSON.stringify({ ok: true, out: r.out, spec: r.spec.id, port: r.manifest.port }, null, 2));
    return;
  }
  if (cmd === 'validate') {
    if (!args.dir) fail('用法：validate --dir <dir>');
    const r = await validateDir(args.dir, { port: args.port });
    console.log(JSON.stringify({ ok: r.ok, errors: r.errors, rows: r.rows, checks: r.checks }, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd === 'staging') {
    const r = await generate(args);
    const v = await validateDir(r.out, { port: args.port });
    console.log(JSON.stringify({ ok: v.ok, out: r.out, errors: v.errors, rows: v.rows }, null, 2));
    process.exit(v.ok ? 0 : 1);
  }
  console.log('用法：\n  generate --id <id> --name <名称> [--type api|browser|file] [--port 0] [--out dir] [--fixture file] [--force]\n  validate --dir <dir>\n  staging  --id <id> --name <名称>');
}

if (require.main === module) main().catch((err) => { console.error(`[generator] ${err.message}`); process.exit(1); });

module.exports = { generate, validateDir, fill };
