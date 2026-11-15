#!/usr/bin/env node
'use strict';

/**
 * concise-analysis MCP 薄壳（通用骨架 + config.json 配置驱动）
 *
 * 职责边界（后续切换后端/数据源只改本文件，上层 Skill 不变）：
 * 1) 与外部独立服务通信（HTTP / 队列 / 任务系统）；
 * 2) 提交任务、轮询任务状态；
 * 3) 读取/解析产出文件（xlsx / csv / json）；
 * 4) 返回结构化数据给上层 Skill。
 *
 * 配置：同目录 config.json（环境变量可覆盖：MCP_SERVICE_BASE_URL / MCP_SERVICE_TOKEN /
 * MCP_POLL_INTERVAL_MS / MCP_POLL_TIMEOUT_MS）。
 *
 * 禁止：不写业务页面操作逻辑；不写死服务地址、账号、业务字段。
 */

const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const XLSX = require('xlsx');

const SERVER_NAME = 'opt-keyword-gap-mcp';
const SERVER_VERSION = '0.1.0';
const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  service: {
    baseUrl: '',
    token: '',
    authHeader: 'authorization',
    authScheme: 'Bearer',
    headers: {},
    timeoutMs: 30000,
  },
  polling: { intervalMs: 3000, timeoutMs: 10 * 60 * 1000 },
  endpoints: {
    submit: { method: 'POST', path: '/jobs' },
    status: { method: 'GET', path: '/jobs/{taskId}' },
    result: { method: 'GET', path: '/jobs/{taskId}/result' },
    verifyQr: { method: 'GET', path: '/jobs/{taskId}/verify' },
  },
  submitBody: { taskKey: 'task', paramsKey: '' },
  statusMap: {
    queued: 'queued',
    waiting_verify: 'waiting_verify',
    running: 'running',
    done: 'succeeded',
    failed: 'failed',
  },
};

/** 读取 config.json，并用环境变量覆盖（环境变量优先） */
function loadConfig() {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    if (fsSync.existsSync(CONFIG_FILE)) {
      const fileCfg = JSON.parse(fsSync.readFileSync(CONFIG_FILE, 'utf8'));
      mergeDeep(cfg, fileCfg);
    }
  } catch (err) {
    throw new Error(`config.json 解析失败：${err.message}`);
  }
  if (process.env.MCP_SERVICE_BASE_URL) cfg.service.baseUrl = process.env.MCP_SERVICE_BASE_URL;
  if (process.env.MCP_SERVICE_TOKEN) cfg.service.token = process.env.MCP_SERVICE_TOKEN;
  if (process.env.MCP_POLL_INTERVAL_MS) cfg.polling.intervalMs = Number(process.env.MCP_POLL_INTERVAL_MS);
  if (process.env.MCP_POLL_TIMEOUT_MS) cfg.polling.timeoutMs = Number(process.env.MCP_POLL_TIMEOUT_MS);
  return cfg;
}

function mergeDeep(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = target[key] && typeof target[key] === 'object' ? target[key] : {};
      mergeDeep(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

let cachedConfig = null;
function getConfig() {
  if (!cachedConfig) cachedConfig = loadConfig();
  return cachedConfig;
}

/** 把 /jobs/{taskId} 这类模板替换成真实路径 */
function fillPath(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(vars[key] ?? ''));
}

function buildUrl(cfg, pathname) {
  if (!cfg.service.baseUrl) throw new Error('config.json 未配置 service.baseUrl');
  return new URL(pathname, cfg.service.baseUrl).toString();
}

/** 统一调用外部服务（地址/鉴权/超时全部来自 config.json） */
async function externalRequest(cfg, endpoint, { pathVars = {}, body, query } = {}) {
  const method = String(endpoint.method || 'GET').toUpperCase();
  const pathname = fillPath(endpoint.path, pathVars);
  const url = new URL(buildUrl(cfg, pathname));
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));

  const headers = { 'content-type': 'application/json', ...(cfg.service.headers || {}) };
  if (cfg.service.token) {
    headers[cfg.service.authHeader || 'authorization'] = cfg.service.authScheme
      ? `${cfg.service.authScheme} ${cfg.service.token}`
      : cfg.service.token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(cfg.service.timeoutMs) || 30000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`外部服务 ${res.status}：${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

/** 外部状态 → 统一状态（映射表来自 config.json → statusMap） */
function mapTaskStatus(cfg, raw) {
  const key = String(raw || '').toLowerCase();
  return (cfg.statusMap && cfg.statusMap[key]) || 'unknown';
}

/** 轮询直到终态（succeeded / failed / waiting_verify 会立即返回） */
async function pollTask(cfg, taskId) {
  const deadline = Date.now() + (Number(cfg.polling.timeoutMs) || 600000);
  while (Date.now() < deadline) {
    const data = await externalRequest(cfg, cfg.endpoints.status, { pathVars: { taskId } });
    const status = mapTaskStatus(cfg, data.status);
    if (status === 'succeeded' || status === 'failed' || status === 'waiting_verify') {
      return { ...data, status };
    }
    await new Promise((resolve) => setTimeout(resolve, Number(cfg.polling.intervalMs) || 3000));
  }
  throw new Error(`轮询超时（${cfg.polling.timeoutMs}ms）`);
}

function toText(data) {
  return {
    content: [
      { type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) },
    ],
  };
}

/** 通用产出文件解析：xlsx / csv / json（不绑定业务字段） */
async function parseResultFile(filePath, sheet) {
  const abs = path.resolve(String(filePath));
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.json') {
    const raw = await fs.readFile(abs, 'utf8');
    return { ok: true, type: 'json', file: abs, data: JSON.parse(raw) };
  }
  if (ext === '.csv') {
    const raw = await fs.readFile(abs, 'utf8');
    return { ok: true, type: 'csv', file: abs, text: raw };
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.readFile(abs);
    const sheetName = sheet && wb.Sheets[sheet] ? String(sheet) : wb.SheetNames[0];
    return {
      ok: true,
      type: 'xlsx',
      file: abs,
      sheets: wb.SheetNames,
      sheet: sheetName,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' }),
    };
  }
  return { ok: false, error: `不支持的文件类型：${ext || '(无扩展名)'}` };
}

function buildSubmitBody(cfg, taskType, params) {
  const body = {};
  if (cfg.submitBody.taskKey) body[cfg.submitBody.taskKey] = taskType;
  if (cfg.submitBody.paramsKey) body[cfg.submitBody.paramsKey] = params || {};
  else Object.assign(body, params || {});
  return body;
}

async function main() {
  const cfg = getConfig();
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // 提交任务
  server.registerTool(
    'submit_task',
    {
      title: '提交任务',
      description: '向外部服务提交业务任务；返回 taskId 供后续轮询',
      inputSchema: {
        taskType: z.string().describe('业务任务类型标识'),
        params: z.record(z.string(), z.any()).optional().describe('任务参数（JSON 对象）'),
      },
    },
    async ({ taskType, params }) => {
      const data = await externalRequest(cfg, cfg.endpoints.submit, {
        body: buildSubmitBody(cfg, taskType, params),
      });
      const taskId = data && (data.taskId || data.jobId || (data.data && (data.data.taskId || data.data.jobId)));
      if (!taskId) throw new Error(`外部服务未返回 taskId/jobId：${JSON.stringify(data).slice(0, 300)}`);
      return toText({ ok: true, taskId });
    }
  );

  // 查询任务状态
  server.registerTool(
    'get_task_status',
    {
      title: '查询任务状态',
      description: '按 taskId 查询外部任务状态并映射为统一状态',
      inputSchema: { taskId: z.string().describe('外部服务返回的任务 ID') },
    },
    async ({ taskId }) => {
      const data = await externalRequest(cfg, cfg.endpoints.status, { pathVars: { taskId } });
      const status = mapTaskStatus(cfg, data.status);
      const result = { ok: true, taskId, status, progress: data.progress, error: data.error };
      if (status === 'waiting_verify' && cfg.endpoints.verifyQr) {
        result.verifyUrl = buildUrl(cfg, fillPath(cfg.endpoints.verifyQr.path, { taskId }));
        result.hint = '需要人工处理（扫码/验证码），处理后可再次查询状态';
      }
      return toText(result);
    }
  );

  // 获取任务结果
  server.registerTool(
    'get_task_result',
    {
      title: '获取任务结果',
      description: '按 taskId 取最终结构化结果',
      inputSchema: { taskId: z.string().describe('外部服务返回的任务 ID') },
    },
    async ({ taskId }) => {
      const data = await externalRequest(cfg, cfg.endpoints.result, { pathVars: { taskId } });
      return toText({ ok: true, taskId, result: data });
    }
  );

  // 轮询直到终态（可选工具：需要 MCP 侧等待时使用）
  server.registerTool(
    'wait_task',
    {
      title: '等待任务完成',
      description: '轮询任务直到 succeeded/failed/waiting_verify（受 config.json 轮询参数控制）',
      inputSchema: { taskId: z.string().describe('外部服务返回的任务 ID') },
    },
    async ({ taskId }) => toText({ ok: true, ...(await pollTask(cfg, taskId)) })
  );

  // 通用：读取并解析产出文件（xlsx/csv/json）
  server.registerTool(
    'read_result_file',
    {
      title: '读取产出文件',
      description: '读取并解析本地产出文件，返回结构化数据（xlsx/csv/json）',
      inputSchema: {
        filePath: z.string().describe('产出文件绝对路径'),
        sheet: z.string().optional().describe('xlsx 工作表名，缺省用第一个'),
      },
    },
    async ({ filePath, sheet }) => toText(await parseResultFile(filePath, sheet))
  );

  await server.connect(new StdioServerTransport());
}

module.exports = {
  loadConfig,
  getConfig,
  mapTaskStatus,
  fillPath,
  buildUrl,
  externalRequest,
  pollTask,
  parseResultFile,
  buildSubmitBody,
  main,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`[${SERVER_NAME}] 启动失败：`, err);
    process.exit(1);
  });
}
