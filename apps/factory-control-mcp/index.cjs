#!/usr/bin/env node
'use strict';

/**
 * apps/factory-control-mcp/index.cjs —— factory-control MCP 薄壳
 *
 * 把本地控制面（127.0.0.1:8780）暴露为 MCP 工具，供 DSH 的 factory-agent Skill 调用。
 * 环境变量：CONTROL_PLANE_URL（默认 http://127.0.0.1:8780）、CONTROL_PLANE_TOKEN（必填）。
 *
 * 边界：本进程只做"协议适配 + HTTP 转发"，不包含业务逻辑、不直接读写数据库。
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const config = require(path.join(ROOT, 'packages', 'config'));

const SERVER_NAME = 'factory-control';
const SERVER_VERSION = '0.1.0';
const BASE = String(process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:8780').replace(/\/+$/, '');
const TOKEN = String(process.env.CONTROL_PLANE_TOKEN || '').trim();
if (!TOKEN) {
  console.error('[factory-control] 缺少 CONTROL_PLANE_TOKEN（安装器/控制面 init 生成）');
  process.exit(1);
}

async function call(method, pathname, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`控制面 ${res.status}：${(json && json.error && json.error.message) || text.slice(0, 200)}`);
  return json;
}
const toText = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

server.registerTool('create_request', {
  title: '创建插件需求单',
  description: '提交业务描述与参数，返回 requestId 与状态（可带 idempotency_key）',
  inputSchema: {
    brief: z.string().describe('业务描述（1–5000 字符）'),
    params: z.record(z.string(), z.any()).optional().describe('可选参数对象'),
    idempotency_key: z.string().optional().describe('幂等键（≤120）'),
  },
}, async ({ brief, params, idempotency_key }) => toText(await call('POST', '/requests', { brief, params }, idempotency_key ? { 'idempotency-key': idempotency_key } : {})));

server.registerTool('create_plugin', {
  title: '对话创建并导出 portable 插件',
  description: '一条工具完成：创建需求 → pipeline 生成/校验/导出 zip → 验收 → 可选安装。DSH 根据用户自然语言工作流编写 implSource（ESM export execute(args)），用户不需要手写代码。',
  inputSchema: {
    brief: z.string().min(1).max(5000).describe('用户的工作流描述'),
    pluginId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).describe('kebab-case 插件 id'),
    name: z.string().min(1).max(100).describe('插件显示名'),
    toolName: z.string().optional().describe('DSH 工具名，默认由 pluginId 转下划线'),
    description: z.string().optional().describe('工具描述'),
    fixture: z.string().optional().describe('可选 fixture 绝对路径；不传则用生成器示例数据'),
    implSource: z.string().max(200000).optional().describe('可选 ESM 源码，必须 export async function execute(args)；不传则生成 fixture 行数统计样例'),
    spec: z.record(z.string(), z.any()).optional().describe('可选 Plugin Spec（tools/parameters/permissions/acceptance）；推荐优先使用'),
    files: z.array(z.object({ path: z.string(), content: z.string().max(200000) })).optional().describe('多文件：lib/*、tests/*、fixtures/*'),
    install: z.boolean().optional().default(true).describe('生成后是否安装到当前 DSH profile'),
    profile: z.string().optional().describe('DSH profile，默认环境 DSH_PROFILE 或 desktop'),
  },
}, async ({ brief, pluginId, name, toolName, description, fixture, implSource, spec, files, install, profile }) => {
  const created = await call('POST', '/requests', {
    brief,
    params: {
      pluginId, name, target: 'portable-host', toolName, description,
      ...(fixture ? { fixture } : {}),
      ...(implSource ? { implSource } : {}),
      ...(spec ? { spec } : {}),
      ...(files ? { files } : {}),
    },
  });
  const requestId = created.request.id;
  const pipeline = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'generator', 'pipeline.cjs'), '--request', requestId], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 600000,
    env: { ...process.env, CONTROL_PLANE_TOKEN: TOKEN, CONTROL_PLANE_URL: BASE },
  });
  const output = `${pipeline.stdout || ''}\n${pipeline.stderr || ''}`;
  if (pipeline.status !== 0) {
    let diagnostics = null;
    try {
      const f = path.join(config.FACTORY_DATA_ROOT, 'generator', 'runs', requestId, 'failure.json');
      if (fs.existsSync(f)) diagnostics = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch { /* ignore */ }
    return toText({
      ok: false, requestId, pluginId,
      error: output.slice(-1500),
      diagnostics,
      next: '根据 diagnostics 修复 spec/files 后重新调用 create_plugin；不要跳过测试',
    });
  }
  const match = output.match(/\{[\s\S]*\}\s*$/);
  if (!match) throw new Error(`pipeline 未返回 JSON：${output.slice(-800)}`);
  const summary = JSON.parse(match[0]);
  await call('POST', `/requests/${encodeURIComponent(requestId)}/accept`, {
    acceptedBy: 'dsh-agent', note: 'portable-host created via DSH natural language',
  });
  const staging = summary.evidence?.staging || '';
  let zip = staging ? path.join(config.FACTORY_DATA_ROOT, staging) : '';
  if (!zip || !fs.existsSync(zip)) {
    const dist = path.join(config.FACTORY_DATA_ROOT, 'generator', 'runs', requestId, 'dist');
    const found = fs.existsSync(dist) ? fs.readdirSync(dist).find((f) => f.endsWith('.zip')) : '';
    if (found) zip = path.join(dist, found);
  }
  let installed = false;
  let installOutput = '';
  if (install) {
    if (!zip || !fs.existsSync(zip)) throw new Error(`导出 zip 不存在：${zip || '(empty)'}`);
    const profileName = profile || process.env.DSH_PROFILE || 'desktop';
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dsh-factory.cjs'), 'install', zip, '--profile', profileName], {
      cwd: ROOT, encoding: 'utf8', timeout: 300000, env: { ...process.env },
    });
    installOutput = `${r.stdout || ''}${r.stderr || ''}`.slice(-1200);
    installed = r.status === 0;
    if (!installed) {
      return toText({ ok: false, requestId, pluginId, zip, pluginDir: summary.pluginDir, installed: false, error: installOutput });
    }
  }
  return toText({
    ok: true, requestId, pluginId, toolName: toolName || pluginId.replace(/-/g, '_'),
    zip, pluginDir: summary.pluginDir, installed, state: 'accepted',
    next: installed ? '重启 DSH 后工具可见（或等待 HMR）' : '用 dsh-factory 安装 zip，然后重启 DSH',
    installOutput: installOutput || undefined,
  });
});

server.registerTool('get_request', {
  title: '查询需求单',
  description: '按 requestId 查询状态/步骤/证据',
  inputSchema: { requestId: z.string() },
}, async ({ requestId }) => toText(await call('GET', `/requests/${encodeURIComponent(requestId)}`)));

server.registerTool('list_requests', {
  title: '需求单列表',
  description: '按状态/数量查询需求单',
  inputSchema: {
    state: z.string().optional().describe('submitted/probe/generate/validate/staging/accept/installed/failed'),
    limit: z.number().int().min(1).max(100).optional(),
  },
}, async ({ state, limit }) => {
  const qs = new URLSearchParams();
  if (state) qs.set('state', state);
  if (limit) qs.set('limit', String(limit));
  return toText(await call('GET', `/requests${qs.toString() ? `?${qs}` : ''}`));
});

server.registerTool('accept_request', {
  title: '业务验收需求单',
  description: '仅 staging 状态可验收；记录 acceptedBy/note 并进入 accept 状态（安装前置门禁）',
  inputSchema: {
    requestId: z.string(),
    acceptedBy: z.string().describe('业务验收人（必填）'),
    note: z.string().optional().describe('验收备注/口径确认（≤1000）'),
  },
}, async ({ requestId, acceptedBy, note }) => toText(await call('POST', `/requests/${encodeURIComponent(requestId)}/accept`, { acceptedBy, note })));

server.registerTool('write_runner', {
  title: '提交业务 runner',
  description: '提交 service/runner.js 源码（≤200KB）；控制面做静态禁止项检查并写入需求单 params.runnerFile',
  inputSchema: {
    requestId: z.string(),
    source: z.string().describe('runner.js 源码（必须导出 runJob）'),
  },
}, async ({ requestId, source }) => toText(await call('POST', `/requests/${encodeURIComponent(requestId)}/runner`, { source })));

server.registerTool('run_step', {
  title: '推进/记录需求步骤',
  description: '记录 probe/generate/validate/staging/accept/install 的 running/succeeded/failed，或 note 证据',
  inputSchema: {
    requestId: z.string(),
    step: z.enum(['probe', 'generate', 'validate', 'staging', 'accept', 'install', 'note']),
    status: z.enum(['running', 'succeeded', 'failed']),
    evidence: z.string().optional().describe('证据描述/文件相对路径（≤4000）'),
    error: z.string().optional().describe('失败原因（failed 必填，≤1000）'),
  },
}, async ({ requestId, step, status, evidence, error }) => toText(await call('POST', `/requests/${encodeURIComponent(requestId)}/steps`, { step, status, evidence, error })));

server.registerTool('list_plugins', {
  title: '插件目录',
  description: '列出工厂已登记的插件（不含 token/路径）',
  inputSchema: {},
}, async () => toText(await call('GET', '/plugins')));

server.registerTool('get_metrics', {
  title: '控制面指标',
  description: '需求单/审计统计与运行时长',
  inputSchema: {},
}, async () => toText(await call('GET', '/metrics')));

server.registerTool('backup_state', {
  title: '备份控制面状态',
  description: 'VACUUM INTO 备份 SQLite 到数据根 backups/',
  inputSchema: { fileName: z.string().optional().describe('安全的 .db 文件名') },
}, async ({ fileName }) => toText(await call('POST', '/admin/backup', { fileName })));

async function main() {
  await server.connect(new StdioServerTransport());
}

module.exports = { SERVER_NAME, call, main };

if (require.main === module) {
  main().catch((err) => { console.error(`[${SERVER_NAME}] 启动失败：`, err); process.exit(1); });
}
