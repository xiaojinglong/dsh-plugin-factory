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
