'use strict';

/**
 * util.js —— 通用工具层
 * 职责：加载配置、目录初始化、安全文件名、路径拼接、图片读写、时间格式化、重试封装。
 * 不含任何业务逻辑，也不依赖 Playwright，可被 server / job / crawler 任意引用。
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/* ------------------------------------------------------------------ */
/* 1. 环境变量加载                                                      */
/* ------------------------------------------------------------------ */

/** 从项目根目录加载 .env（Node 20.12+ 提供 process.loadEnvFile，无需 dotenv 依赖） */
function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(envPath);
    } catch (err) {
      console.warn('[util] .env 解析失败，使用默认配置：', err.message);
    }
  } else {
    // 兼容老版本 Node 的极简解析（KEY=VALUE，忽略注释与空行）
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      const val = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

loadEnvFile();

/* ------------------------------------------------------------------ */
/* 2. 配置                                                             */
/* ------------------------------------------------------------------ */

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || 'data');

// TARGET_BASE_URL 为空时必然进入 DEMO_MODE（无目标站点无法跑真实流程）
const TARGET_BASE_URL = (process.env.TARGET_BASE_URL || '').trim();
const DEMO_MODE = !TARGET_BASE_URL || bool(process.env.DEMO_MODE, false);

const CONFIG = Object.freeze({
  // HTTP
  host: process.env.HOST || '127.0.0.1',
  port: num(process.env.PORT, 8790),

  // 浏览器
  headless: bool(process.env.HEADLESS, true),
  slowMo: Number(process.env.BROWSER_SLOWMO || 0),
  navTimeoutMs: num(process.env.NAV_TIMEOUT_MS, 45000),

  // 任务
  globalTimeoutMs: num(process.env.GLOBAL_TIMEOUT_MS, 300000),
  verifyTimeoutMs: num(process.env.VERIFY_TIMEOUT_MS, 300000),
  // 架构约束：页面自动化不支持并行，全局单 worker，强制为 1
  maxConcurrent: 1,

  // 目录
  dataDir: DATA_DIR,
  sessionName: process.env.SESSION_NAME || 'default',

  // 业务
  targetBaseUrl: TARGET_BASE_URL,
  demoSilentVerify: bool(process.env.DEMO_SIMULATE_VERIFY, false),
  // 演示模式：TARGET_BASE_URL 为空时自动开启
  demoMode: DEMO_MODE,
});

/** 固定目录布局 */
const PATHS = Object.freeze({
  jobsDir: path.join(DATA_DIR, 'jobs'),
  sessionsDir: path.join(DATA_DIR, 'sessions'),
  jobDir: (jobId) => path.join(DATA_DIR, 'jobs', String(jobId)),
  jobMeta: (jobId) => path.join(DATA_DIR, 'jobs', String(jobId), 'meta.json'),
  sessionFile: (name) => path.join(DATA_DIR, 'sessions', `${name || CONFIG.sessionName}.json`),
  /** 对外暴露的相对路径（相对 DATA_DIR），便于调用方拼装 */
  relative: (abs) => path.relative(DATA_DIR, abs).split(path.sep).join('/'),
});

/** 启动时确保 data/jobs、data/sessions 存在 */
async function ensureDirs() {
  await fsp.mkdir(PATHS.jobsDir, { recursive: true });
  await fsp.mkdir(PATHS.sessionsDir, { recursive: true });
}

/* ------------------------------------------------------------------ */
/* 3. 文件名与路径                                                      */
/* ------------------------------------------------------------------ */

/** 把任意业务名称转成安全文件名（去掉非法字符、限长、保留中文） */
function safeFileName(name, fallback = 'file', maxLen = 80) {
  let s = String(name ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_') // Windows 非法字符
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  if (!s) s = fallback;
  if (s.length > maxLen) {
    const ext = path.extname(s);
    s = s.slice(0, maxLen - ext.length) + ext;
  }
  return s;
}

/** 同名文件自动加序号：a.xlsx -> a(1).xlsx */
function uniqueFileName(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = fileName;
  let i = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}(${i++})${ext}`;
    if (i > 999) {
      candidate = `${base}-${Date.now()}${ext}`;
      break;
    }
  }
  return candidate;
}

/* ------------------------------------------------------------------ */
/* 4. 时间                                                             */
/* ------------------------------------------------------------------ */

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 2026-11-11 20:57:58 */
function formatTime(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d);
  return (
    `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ` +
    `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
  );
}

/** 便于做 jobId / 文件名的时间戳：20261111-205758 */
function timeStamp(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d);
  return (
    `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-` +
    `${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`
  );
}

function nowIso() {
  return new Date().toISOString();
}

/** 毫秒 -> "1分23秒" */
function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60}秒`;
  return `${Math.floor(m / 60)}时${m % 60}分`;
}

/* ------------------------------------------------------------------ */
/* 5. 文件 / 图片读写                                                   */
/* ------------------------------------------------------------------ */

async function readImageBuffer(fileOrBuffer) {
  if (Buffer.isBuffer(fileOrBuffer)) return fileOrBuffer;
  return fsp.readFile(fileOrBuffer);
}

async function writeImage(filePath, buffer) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, buffer);
  return filePath;
}

/** 按扩展名推断 image content-type */
function imageContentType(bufferOrName = '') {
  const name = typeof bufferOrName === 'string' ? bufferOrName.toLowerCase() : '';
  if (/\.jpe?g$/.test(name)) return 'image/jpeg';
  if (/\.webp$/.test(name)) return 'image/webp';
  if (/\.gif$/.test(name)) return 'image/gif';
  if (Buffer.isBuffer(bufferOrName)) {
    const b = bufferOrName;
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (b.length > 12 && b.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (b.length > 3 && b.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  }
  return 'image/png';
}

async function fileSize(p) {
  try {
    const st = await fsp.stat(p);
    return st.size;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* 6. 重试                                                             */
/* ------------------------------------------------------------------ */

/** 清理错误信息：去 ANSI 颜色、压缩多行 Call log，只保留对调用方有用的首行 */
function sanitizeError(err, maxLen = 300) {
  const raw = typeof err === 'string' ? err : err?.message || String(err ?? '未知错误');
  // eslint-disable-next-line no-control-regex
  const noAnsi = raw.replace(/\u001b\[[0-9;]*m/g, '');
  const firstLine = noAnsi.split('\n')[0].trim();
  return (firstLine.length > maxLen ? `${firstLine.slice(0, maxLen)}…` : firstLine) || '未知错误';
}

/**
 * 通用重试封装：仅用于网络抖动、页面偶发失败等场景。
 * 注意：页面内等待禁止使用固定 sleep，必须用元素断言/networkidle（见 crawler.js）。
 */
async function withRetry(fn, { retries = 2, delayMs = 500, label = 'operation', onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const wait = delayMs * (attempt + 1);
      if (onRetry) onRetry(err, attempt + 1, wait);
      console.warn(`[util] ${label} 第${attempt + 1}次失败，${wait}ms 后重试：${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** 超时包装：给任意 promise 加一个上限，避免单步永久挂起 */
function withTimeout(promise, ms, message = '操作超时') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message}（${formatDuration(ms)}）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = {
  CONFIG,
  PATHS,
  ensureDirs,
  safeFileName,
  uniqueFileName,
  formatTime,
  formatDuration,
  timeStamp,
  nowIso,
  readImageBuffer,
  writeImage,
  imageContentType,
  fileSize,
  withRetry,
  withTimeout,
  sanitizeError,
};
