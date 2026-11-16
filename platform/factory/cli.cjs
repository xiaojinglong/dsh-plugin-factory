#!/usr/bin/env node
'use strict';

/**
 * factory CLI v3 —— 插件工厂统一入口（替代手工 patch / junction / 冒烟 / 自检）
 *
 *   node factory/cli.mjs <command> [args]
 *
 * 命令：list | doctor | render | up [id] | down [id] | status | smoke <id> | test
 *      | secret <id> set KEY=VALUE... | secret <id> list | port | clean
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const config = require('../../packages/config');

const ROOT = config.FACTORY_ROOT;
const PLUGIN_DIR = config.MANIFEST_DIR;
const BUNDLE_MARKER_DIR = path.join(PLUGIN_DIR, '.bundles');
const RUN_DIR = config.RUN_DIR;
const PATCH = config.DSH_PATCH;
const DSH_TOOLS = config.DSH_TOOLS;
const DSH_SKILLS = config.DSH_SKILLS;

function bundleManaged(id) {
  return fs.existsSync(path.join(BUNDLE_MARKER_DIR, `${id}.json`));
}

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m' };
let fails = 0;
let warns = 0;
const ok = (m) => console.log(`${C.green}[OK]${C.reset}   ${m}`);
const bad = (m) => { fails += 1; console.log(`${C.red}[FAIL]${C.reset} ${m}`); };
const warn = (m) => { warns += 1; console.log(`${C.yellow}[WARN]${C.reset} ${m}`); };
const info = (m) => console.log(`${C.cyan}${m}${C.reset}`);

/* ------------------------------ manifests ------------------------------ */
/** 读取原始 manifest（保持仓库相对路径，用于写回/生成 patch/registry） */
function rawManifests() {
  if (!fs.existsSync(PLUGIN_DIR)) return [];
  return fs.readdirSync(PLUGIN_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: path.join(PLUGIN_DIR, f), ...JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, f), 'utf8')) }));
}
/** 读取并解析为绝对路径（用于运行/校验，不修改磁盘） */
function manifests() {
  return rawManifests().map((m) => config.resolveManifest(m));
}
function writeRegistry(list) {
  const rows = list.sort((a, b) => a.port - b.port);
  const lines = [
    '# 插件登记表（Plugin Registry）', '',
    '> 本文件由 `factory render` 从 platform/manifests/*.json 自动生成，请勿手改。', '',
    '| 业务标识 | 中文名 | 类型 | Skill 目录 | MCP 目录 | serverName | taskType | 端口 | 执行层服务 | 状态 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const m of rows) {
    lines.push(`| ${m.id} | ${m.name} | ${m.type}${m.runtime?.write ? '（写操作）' : ''} | skills/${m.id} | tools/${m.id}-mcp | ${m.serverName} | ${m.taskType} | ${m.port} | ${m.service.dir} | ${m.legacy ? 'legacy' : '已迁移'} |`);
  }
  lines.push('', '## 端口分配', '', '| 端口 | 占用插件 |', '|---|---|');
  for (const m of rows) lines.push(`| ${m.port} | ${m.id} |`);
  lines.push('', '## 复用约定（v3）', '', '1. 共享 runtime：plugin/service/server.js 只调用 `platform/factory/bootstrap`；运行时/任务引擎/鉴权/写操作治理/指标/日志只有一份。', '2. 单一事实源：`platform/manifests/<id>.json` → 本表与 patch 由 CLI 生成。', '3. 凭证：DPAPI 加密存于 `platform/secrets/<id>.enc`，服务启动时注入 env。', '4. 报告统一用 `factory-kit/report-kit.mjs`。');
  fs.mkdirSync(path.dirname(config.DSH_REGISTRY), { recursive: true });
  fs.writeFileSync(config.DSH_REGISTRY, lines.join('\n') + '\n', 'utf8');
}

function saveManifest(m) {
  fs.writeFileSync(path.join(PLUGIN_DIR, `${m.id}.json`), JSON.stringify(m, null, 2) + '\n', 'utf8');
}

/* ------------------------------ http helpers ------------------------------ */
async function health(port, timeoutMs = 3000) {
  const http = require('node:http');
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { const j = JSON.parse(data); resolve(j.ok === true ? j : null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带/不带 token 请求一个路径，只取 HTTP 状态码（用于鉴权自检） */
function httpStatus(port, pathname, token, timeoutMs = 3000) {
  const http = require('node:http');
  return new Promise((resolve) => {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const req = http.get({ host: '127.0.0.1', port, path: pathname, headers, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
  });
}

/* ------------------------------ patch render ------------------------------ */
function stripMcpBlocks(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (/^-\s*insert:\s*$/.test(line)) { skipping = false; out.push({ line, block: [] }); continue; }
    if (out.length && out[out.length - 1].block && /^\s{2,}/.test(line)) { out[out.length - 1].block.push(line); }
    else out.push({ line });
  }
  // 简化：按行重建，遇到 mcp- 块整段删除
  const result = [];
  let skipBlock = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#\s*.*mcp-|^#\s*.*（.*插件.*）/.test(line) && i + 1 < lines.length && /^-\s*insert:/.test(lines[i + 1])) {
      // 注释行 + insert 块：判断块内是否 mcp-
      const block = [];
      let j = i + 1;
      block.push(lines[j]);
      j += 1;
      while (j < lines.length && (/^\s{2,}/.test(lines[j]) || lines[j] === '')) { block.push(lines[j]); j += 1; }
      if (block.join('\n').includes('- id: mcp-')) { skipBlock = true; i = j; continue; }
    }
    if (/^-\s*insert:/.test(line)) {
      const block = [line];
      let j = i + 1;
      while (j < lines.length && (/^\s{2,}/.test(lines[j]) || lines[j] === '')) { block.push(lines[j]); j += 1; }
      if (block.join('\n').includes('- id: mcp-')) { skipBlock = true; i = j; continue; }
    }
    result.push(line);
  }
  // 清理历史 render 追加的"插件注释行"（形如 `# <id>（API，v3.0.0）`），避免每次 render 重复累积
  const kept = result.filter((line) => !/^#\s*[a-z0-9-]+（[^）]*v\d+\.\d+\.\d+[^）]*）\s*$/.test(line));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
function renderPatch() {
  const all = rawManifests().filter((m) => !m.legacy);
  const list = all.filter((m) => !bundleManaged(m.id));
  // YAML 双引号内反斜杠是转义符；Windows 路径必须用正斜杠，否则 DSH 解析失败并重置 patch
  const dshToolsYaml = DSH_TOOLS.replace(/\\/g, '/');
  let text = fs.existsSync(PATCH) ? fs.readFileSync(PATCH, 'utf8') : '';
  text = stripMcpBlocks(text);
  const blocks = list.sort((a, b) => a.port - b.port).map((m) => `# ${m.id}（${m.type === 'api' ? 'API' : m.type === 'browser' ? '浏览器' : m.type}${m.runtime?.write ? '·写操作' : ''}，v${m.version}）
- insert:
    - id: mcp-${m.id}
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: ${m.serverName}
        transport: stdio
        command: node
        toolCallTimeoutMs: ${m.runtime?.toolTimeoutMs || 900000}
        args: ["${dshToolsYaml}/${m.id}-mcp/index.js"]
        cwd: "${dshToolsYaml}/${m.id}-mcp"
        env:
          MCP_SERVICE_BASE_URL: "http://127.0.0.1:${m.port}"
${m.runtime?.serviceToken ? `          MCP_SERVICE_TOKEN: "${m.runtime.serviceToken}"\n` : ''}`);
  const next = `${text}\n${blocks.join('\n')}`;
  fs.mkdirSync(path.dirname(PATCH), { recursive: true });
  if (fs.existsSync(PATCH)) fs.copyFileSync(PATCH, `${PATCH}.bak.${Date.now()}`);
  fs.writeFileSync(PATCH, next, 'utf8');
  writeRegistry(all);
  ok(`patch 与 registry 已由 manifest 重新生成（${list.length} 个 MCP 条目，${all.length - list.length} 个 bundle-managed）`);
}

/* ------------------------------ doctor ------------------------------ */
function checkManifest(m) {
  const need = ['id', 'name', 'type', 'version', 'port', 'taskType', 'serverName', 'service', 'mcp', 'skill'];
  for (const k of need) if (!(k in m)) bad(`${m.id || m.file}：manifest 缺字段 ${k}`);
  if (!fs.existsSync(m.service?.dir || '')) bad(`${m.id}：service.dir 不存在`);
  if (m.service?.entry && !fs.existsSync(path.join(m.service.dir, m.service.entry))) bad(`${m.id}：service.entry 不存在`);
  const runner = m.service?.runner ? path.join(m.service.dir, m.service.runner) : '';
  if (runner && !fs.existsSync(runner)) bad(`${m.id}：runner 不存在 ${runner}`);
  if (m.legacy) { warn(`${m.id}：legacy 插件（未迁移共享 runtime）`); }
  const mcpIndex = path.join(DSH_TOOLS, `${m.id}-mcp`, 'index.js');
  const mcpCfg = path.join(DSH_TOOLS, `${m.id}-mcp`, 'config.json');
  if (!fs.existsSync(mcpIndex)) bad(`${m.id}：MCP index.js 不存在`);
  else { try { execFileSync('node', ['--check', mcpIndex], { stdio: 'pipe' }); } catch { bad(`${m.id}：MCP index.js 语法错误`); } }
  if (!fs.existsSync(mcpCfg)) bad(`${m.id}：MCP config.json 不存在`);
  else {
    try {
      const cfg = JSON.parse(fs.readFileSync(mcpCfg, 'utf8'));
      const port = Number(new URL(cfg.service.baseUrl).port);
      if (port !== m.port) bad(`${m.id}：config.baseUrl 端口 ${port} 与 manifest ${m.port} 不一致`);
    } catch { bad(`${m.id}：MCP config.json 解析失败`); }
  }
  const skill = path.join(DSH_SKILLS, m.id, 'SKILL.md');
  if (!fs.existsSync(skill)) bad(`${m.id}：SKILL.md 不存在`);
  else {
    const t = fs.readFileSync(skill, 'utf8');
    const nm = (t.match(/^name:\s*(\S+)/m) || [])[1];
    if (nm !== m.id) bad(`${m.id}：SKILL name=${nm} 与 id 不一致`);
    if (!/^description:\s*\S+/m.test(t)) bad(`${m.id}：SKILL 缺 description`);
    const sections = [[/适用场景/, '适用场景'], [/编排|流程/, '编排流程'], [/异常/, '异常处理'], [/待确认/, '待确认']];
    for (const [re, label] of sections) {
      if (!re.test(t)) warn(`${m.id}：SKILL 缺章节「${label}」`);
    }
  }
  if (m.report && !fs.existsSync(m.report.output)) warn(`${m.id}：报告未生成 ${m.report.output}`);
  if (m.report?.generator && !fs.existsSync(m.report.generator)) bad(`${m.id}：报告生成器不存在 ${m.report.generator}`);
  if (m.secrets && m.secrets.length) {
    const enc = path.join(ROOT, 'platform', 'secrets', `${m.id}.enc`);
    if (!fs.existsSync(enc)) warn(`${m.id}：未加密存储凭证（secrets/${m.id}.enc 缺失）`);
  }
  if (m.runtime?.token && !m.runtime?.serviceToken && !fs.existsSync(path.join(ROOT, 'platform', 'secrets', `${m.id}.enc`))) warn(`${m.id}：开启鉴权但 manifest 无 serviceToken 且无凭据`);
}

async function doctor(withHealth) {
  const list = manifests();
  info(`=== 插件清单（${list.length}） ===`);
  const ids = new Set(); const ports = new Map(); const tasks = new Map(); const servers = new Map();
  for (const m of list) {
    if (ids.has(m.id)) bad(`id 重复：${m.id}`); else ids.add(m.id);
    if (ports.has(m.port)) bad(`端口冲突：${m.port}（${ports.get(m.port)} / ${m.id}）`); else ports.set(m.port, m.id);
    if (tasks.has(m.taskType)) bad(`taskType 重复：${m.taskType}`); else tasks.set(m.taskType, m.id);
    if (servers.has(m.serverName)) bad(`serverName 重复：${m.serverName}`); else servers.set(m.serverName, m.id);
    checkManifest(m);
  }
  // patch 一致性（bundle-managed 插件由 DSH plugin manager 注册，不要求 patch 条目）
  if (fs.existsSync(PATCH)) {
    const text = fs.readFileSync(PATCH, 'utf8');
    for (const m of list.filter((x) => !x.legacy)) {
      if (bundleManaged(m.id)) {
        info(`${m.id}：bundle-managed（跳过 patch 校验）`);
        continue;
      }
      if (!text.includes(`- id: mcp-${m.id}`)) bad(`patch 缺条目 mcp-${m.id}（运行 factory render）`);
      if (!text.includes(`"http://127.0.0.1:${m.port}"`)) bad(`patch 缺端口 ${m.port}`);
      if (m.runtime?.serviceToken && !text.includes(m.runtime.serviceToken)) bad(`${m.id}：patch 中 MCP_SERVICE_TOKEN 与 manifest 不一致（运行 factory render）`);
    }
  } else bad(`patch 文件不存在：${PATCH}`);
  // 健康
  if (withHealth) {
    for (const m of list) {
      const h = await health(m.port);
      if (!h) bad(`${m.id}：:${m.port} 不健康`);
      else if (!m.legacy && h.id !== m.id) bad(`${m.id}：健康检查返回 id=${h.id}`);
      // 鉴权自检：无 token 必须 401，带 manifest token 必须 200（防止 token 未注入运行时）
      if (!m.legacy && m.runtime?.token) {
        const noToken = await httpStatus(m.port, '/jobs?limit=1');
        if (noToken !== 401) bad(`${m.id}：鉴权未生效（无 token 访问 /jobs 返回 ${noToken || '连接失败'}，期望 401）`);
        if (m.runtime.serviceToken) {
          const withToken = await httpStatus(m.port, '/jobs?limit=1', m.runtime.serviceToken);
          if (withToken !== 200) bad(`${m.id}：携带 manifest token 访问 /jobs 返回 ${withToken || '连接失败'}，期望 200`);
        }
      }
    }
  }
  // 运行时单一来源
  const rtVersions = new Set();
  for (const m of list.filter((x) => !x.legacy)) {
    const boot = m.service?.dir && m.service?.entry ? path.join(m.service.dir, m.service.entry) : '';
    if (boot && fs.existsSync(boot)) {
      const t = fs.readFileSync(boot, 'utf8');
      const usesBoot = /platform[\\/]factory[\\/]bootstrap/.test(t)
        || /'platform',\s*'factory',\s*'bootstrap'/.test(t);
      if (!usesBoot) warn(`${m.id}：未使用共享 runtime（bootstrap）`);
      else rtVersions.add((t.match(/manifest\.version|v(\d+\.\d+\.\d+)/) || [])[0] || 'v3');
    }
  }
  info('\n=== 结果 ===');
  if (fails === 0) console.log(`${C.green}全部通过${C.reset}（warn ${warns}）`);
  else console.log(`${C.red}${fails} 项失败${C.reset}（warn ${warns}）`);
  process.exit(fails ? 1 : 0);
}

/* ------------------------------ processes ------------------------------ */
function pidFile(id) { return path.join(RUN_DIR, `${id}.pid`); }
function isAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function up(onlyId) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const list = manifests().filter((m) => (!onlyId || m.id === onlyId));
  for (const m of list) {
    const starter = m.service?.starter;
    const cmd = m.service?.startCmd || (m.service?.entry ? ['node', [m.service.entry]] : null);
    if (!cmd) { warn(`${m.id}：未配置启动命令`); continue; }
    if (await health(m.port)) { ok(`${m.id} 已在运行 :${m.port}`); continue; }
    const logDir = path.join(m.service.dir, 'data', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const out = fs.openSync(path.join(logDir, 'service.out.log'), 'a');
    const err = fs.openSync(path.join(logDir, 'service.err.log'), 'a');
    const child = spawn(cmd[0], cmd[1], { cwd: m.service.dir, detached: true, stdio: ['ignore', out, err], windowsHide: true });
    child.unref();
    fs.writeFileSync(pidFile(m.id), String(child.pid), 'utf8');
    let h = null;
    for (let i = 0; i < 20 && !h; i += 1) { await sleep(500); h = await health(m.port); }
    if (h) ok(`${m.id} 启动成功 :${m.port} pid=${child.pid}`); else bad(`${m.id} 启动失败（查看 data/logs）`);
  }
}
function down(onlyId) {
  const list = manifests().filter((m) => !onlyId || m.id === onlyId);
  for (const m of list) {
    const f = pidFile(m.id);
    let pid = 0;
    try { pid = Number(fs.readFileSync(f, 'utf8').trim()); } catch { /* ignore */ }
    if (!pid || !isAlive(pid)) { warn(`${m.id}：未运行`); try { fs.unlinkSync(f); } catch {} continue; }
    try { process.kill(pid); ok(`${m.id} 已停止 pid=${pid}`); } catch (e) { bad(`${m.id} 停止失败：${e.message}`); }
    try { fs.unlinkSync(f); } catch {}
  }
}
async function status() {
  for (const m of manifests()) {
    const h = await health(m.port);
    const s = h ? `${C.green}UP${C.reset} pid=${(() => { try { return fs.readFileSync(pidFile(m.id), 'utf8').trim(); } catch { return '-'; } })()}` : `${C.red}DOWN${C.reset}`;
    console.log(`${m.id.padEnd(20)} :${String(m.port).padEnd(5)} ${s}`);
  }
}

/* ------------------------------ smoke / tests ------------------------------ */
function smoke(id) {
  const dir = path.join(DSH_TOOLS, `${id}-mcp`);
  const f = path.join(dir, 'smoke.cjs');
  if (!fs.existsSync(f)) { bad(`${id}：smoke.cjs 不存在`); process.exit(1); }
  const man = manifests().find((m) => m.id === id) || {};
  const env = { ...process.env };
  if (man.runtime && man.runtime.serviceToken) env.MCP_SERVICE_TOKEN = man.runtime.serviceToken;
  console.log(execFileSync('node', ['smoke.cjs'], { cwd: dir, encoding: 'utf8', env }));
  ok(`${id} 冒烟通过`);
}
function test() {
  const dir = path.join(ROOT, 'platform', 'tests');
  // 流式输出，CI 失败时能看到具体用例（不再被 execFileSync 截断）
  execFileSync('node', ['--test', ...fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(dir, f))], { stdio: 'inherit' });
}
function clean() {
  for (const m of manifests()) {
    const jobsDir = path.join(m.service.dir, 'data', 'jobs');
    if (!fs.existsSync(jobsDir)) continue;
    let removed = 0;
    for (const e of fs.readdirSync(jobsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(jobsDir, e.name);
      const st = fs.statSync(p);
      if (st.mtimeMs < Date.now() - (m.runtime?.retentionDays || 7) * 86400000) { fs.rmSync(p, { recursive: true, force: true }); removed += 1; }
    }
    if (removed) ok(`${m.id}：清理 ${removed} 个过期任务目录`);
  }
}

/* ------------------------------ secrets ------------------------------ */
function secretCmd(args) {
  const { encryptPlain, decrypt, exists } = require(path.join(ROOT, 'platform', 'runtime', 'secrets.js'));
  const [id, action, ...rest] = args;
  if (!id || !action) { bad('用法：secret <id> set KEY=VALUE | list | rm <KEY>'); process.exit(1); }
  const cur = exists(id) ? decrypt(id) : {};
  if (action === 'set') {
    for (const kv of rest) { const i = kv.indexOf('='); if (i < 0) continue; cur[kv.slice(0, i)] = kv.slice(i + 1); }
    encryptPlain(id, JSON.stringify(cur));
    ok(`${id}：凭证已加密保存（${Object.keys(cur).join(',')}）`);
  } else if (action === 'list') {
    console.log(Object.keys(cur).join('\n') || '（空）');
  } else if (action === 'rm') {
    for (const k of rest) delete cur[k];
    encryptPlain(id, JSON.stringify(cur));
    ok(`${id}：已删除 ${rest.join(',')}`);
  } else bad(`未知 secret 动作：${action}`);
}

/* ------------------------------ port ------------------------------ */
function freePort(start = 8790) {
  let p = start;
  while (p < 8899) {
    try { execFileSync('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue) -ne $null`], { encoding: 'utf8' }); } catch { /* ignore */ }
    const busy = (() => { try { return execFileSync('powershell', ['-NoProfile', '-Command', `if (Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue) { 'busy' } else { 'free' }`], { encoding: 'utf8' }).trim() === 'busy'; } catch { return true; } })();
    if (!busy) { console.log(p); return; }
    p += 1;
  }
  bad('无空闲端口');
}

async function watch(intervalSec = 15) {
  info(`watch 模式：每 ${intervalSec}s 检查一次，服务 down 自动重启（Ctrl+C 退出）`);
  for (;;) {
    for (const m of manifests()) {
      const h = await health(m.port);
      if (!h) { warn(`${m.id} 掉线，自动重启`); await up(m.id); }
    }
    await sleep(intervalSec * 1000);
  }
}

/* ------------------------------ main ------------------------------ */
const [cmd, ...args] = process.argv.slice(2);
(async () => {
  switch (cmd) {
    case 'list': {
      for (const m of manifests()) console.log(`${m.id.padEnd(20)} ${String(m.type).padEnd(8)} :${String(m.port).padEnd(5)} ${m.taskType}${m.legacy ? '  (legacy)' : ''}`);
      break;
    }
    case 'doctor': await doctor(args.includes('--health')); break;
    case 'render': renderPatch(); break;
    case 'up': await up(args[0]); break;
    case 'down': down(args[0]); break;
    case 'status': await status(); break;
    case 'watch': await watch(Number(args[0]) || 15); break;
    case 'smoke': if (!args[0]) { bad('用法：smoke <id>'); process.exit(1); } smoke(args[0]); break;
    case 'test': test(); break;
    case 'clean': clean(); break;
    case 'secret': secretCmd(args); break;
    case 'port': freePort(Number(args[0]) || 8790); break;
    default:
      console.log(`factory v3 — 插件工厂 CLI

用法：node platform/factory/cli.mjs <command>

  list                列出插件（manifest）
  doctor [--health]   自检：manifest/路径/语法/配置/patch/报告/健康
  render              由 manifest 重新生成 patch（自动备份）
  up [id]             启动服务（后台，写 PID 文件）
  down [id]           停止服务
  status              查看各服务状态
  watch [秒]          守护模式：服务掉线自动拉起
  smoke <id>          MCP 五连冒烟
  test                运行平台测试（node --test）
  secret <id> set K=V / list / rm K   凭证加密（DPAPI）
  port [start]        查找空闲端口
  clean               清理过期任务目录`);
  }
})().catch((e) => { console.error('CLI 错误：', e); process.exit(1); });
