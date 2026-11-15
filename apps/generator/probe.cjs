'use strict';

/**
 * apps/generator/probe.cjs —— 勘探适配器（M3，安全加固版）
 *
 * 支持：fixture 文件、HTTP JSON（默认只允许本机；外部主机必须在 allowlist）。
 * 安全：
 *   - allowlist（env FACTORY_PROBE_ALLOWLIST 或 config/probe-allowlist.json，支持 *.example.com）
 *   - DNS rebinding 防护：非本机主机若解析到私网/保留地址则拒绝（除非 allowlist 显式写了该 IP）
 *   - 只允许 http/https；重定向最多 3 次且每次重新校验；响应上限 1MB；超时 10s
 *   - 凭证通过 authEnv 从进程环境读取，不写入结果/日志
 */

const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');
const config = require('../../packages/config');

const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10000;
const DEFAULT_ALLOWLIST = ['127.0.0.1', 'localhost', '::1'];

function allowlistFile() { return path.join(config.FACTORY_ROOT, 'config', 'probe-allowlist.json'); }
function loadAllowlist() {
  const env = String(process.env.FACTORY_PROBE_ALLOWLIST || '').trim();
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const arr = JSON.parse(fs.readFileSync(allowlistFile(), 'utf8'));
    if (Array.isArray(arr)) return arr.map(String);
  } catch { /* ignore */ }
  return [...DEFAULT_ALLOWLIST];
}

function isLocalHost(host) { return ['127.0.0.1', 'localhost', '::1'].includes(String(host).toLowerCase()); }
function isHostAllowed(host, allowlist = loadAllowlist()) {
  const h = String(host || '').toLowerCase();
  return allowlist.some((entry) => {
    const e = String(entry).trim().toLowerCase();
    if (!e) return false;
    if (e.startsWith('*.')) return h.endsWith(e.slice(1)) && h !== e.slice(2);
    return h === e;
  });
}
function isPrivateIp(ip) {
  const v = String(ip);
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0 || a >= 224) return true;
    return false;
  }
  if (net.isIPv6(v)) {
    const low = v.toLowerCase();
    return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
  }
  return false;
}

async function assertUrlAllowed(raw, allowlist = loadAllowlist()) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error(`非法 URL：${raw}`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('只允许 http/https');
  const host = u.hostname;
  if (!isHostAllowed(host, allowlist)) throw new Error(`主机不在 allowlist：${host}（配置 config/probe-allowlist.json 或 FACTORY_PROBE_ALLOWLIST）`);
  if (isLocalHost(host)) return { url: u, addresses: [] };
  let addresses = [];
  try { addresses = await dns.lookup(host, { all: true }); } catch (e) { throw new Error(`DNS 解析失败：${host}（${e.message}）`); }
  if (!addresses.length) throw new Error(`DNS 无结果：${host}`);
  for (const a of addresses) {
    if (!isPrivateIp(a.address)) continue;
    const explicitlyAllowedIp = allowlist.map((x) => String(x).trim()).includes(a.address);
    if (!explicitlyAllowedIp) throw new Error(`拒绝私网/保留地址 ${a.address}（${host}）；如确需请显式加入 allowlist IP`);
  }
  return { url: u, addresses };
}

function summarizeList(list) {
  const rows = Array.isArray(list) ? list : [];
  const fields = rows.length && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];
  return { count: rows.length, fields, sample: rows.slice(0, 3) };
}

async function probeFixture(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`fixture 不存在：${abs}`);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const list = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []);
  return { kind: 'fixture', source: abs, ...summarizeList(list) };
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function fetchWithRetry(url, init, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (RETRY_STATUS.has(res.status) && attempt < retries) {
        await sleep(200 * (2 ** attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) throw err;
      await sleep(200 * (2 ** attempt));
    }
  }
  throw lastErr || new Error('fetch 失败');
}

async function probeHttp(apiUrl, opts = {}) {
  const allowlist = opts.allowlist || loadAllowlist();
  const method = String(opts.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error('probe 只支持 GET/POST');
  const headers = { accept: 'application/json' };
  let authUsed = false;
  if (opts.authEnv) {
    const token = String(process.env[opts.authEnv] || '').trim();
    if (!token) throw new Error(`缺少凭证环境变量：${opts.authEnv}`);
    headers.authorization = `Bearer ${token}`;
    authUsed = true;
  }
  let body;
  if (method === 'POST') {
    if (!opts.body || typeof opts.body !== 'object' || Array.isArray(opts.body)) throw new Error('POST probe 需要 params.body 对象');
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let current = String(apiUrl);
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    await assertUrlAllowed(current, allowlist);
    const res = await fetchWithRetry(current, {
      method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    }, Number(opts.retries ?? 2));
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`重定向缺少 location（HTTP ${res.status}）`);
      current = new URL(location, current).toString();
      continue;
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error(`响应过大（${len} > ${MAX_BYTES}）`);
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`响应过大（>${MAX_BYTES}）`);
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    const list = Array.isArray(json) ? json : (json && (json.list || (json.data && json.data.list)) || []);
    return {
      kind: 'http', source: new URL(current).toString(), finalUrl: new URL(current).toString(), method,
      status: res.status, contentType: res.headers.get('content-type') || '',
      bytes: Buffer.byteLength(text), authUsed, ...summarizeList(list),
    };
  }
  throw new Error(`重定向超过 ${MAX_REDIRECTS} 次`);
}

async function probeBrowser(browserUrl, opts = {}) {
  const allowlist = opts.allowlist || loadAllowlist();
  await assertUrlAllowed(browserUrl, allowlist);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: String(process.env.HEADLESS || 'true') !== 'false',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const storageState = opts.storageState && fs.existsSync(opts.storageState) ? opts.storageState : undefined;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', ...(storageState ? { storageState } : {}) });
    const page = await context.newPage();
    await page.goto(browserUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const title = await page.title();
    const loginRequired = /login|signin|sso|auth/i.test(page.url()) || (await page.locator('input[type="password"]').count()) > 0;
    if (loginRequired) {
      throw new Error(storageState
        ? '登录态已过期：页面仍跳转登录/包含密码框，请更新 storageState 后重试'
        : '需要登录态：页面跳转登录/包含密码框，请提供 storageState（人工扫码更新）');
    }
    const readTables = (target) => target.$$eval('table', (ts) => ts.slice(0, 5).map((t) => ({
      headers: [...t.querySelectorAll('thead th')].map((x) => (x.innerText || '').trim()),
      rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').trim())),
    }))).catch(() => []);
    const mainTables = (await readTables(page)).map((t) => ({ ...t, frame: page.url() }));
    const frameTables = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const ts = await readTables(frame);
      for (const t of ts) frameTables.push({ ...t, frame: frame.url() });
    }
    const tables = [...mainTables, ...frameTables];
    const links = await page.$$eval('a[href]', (as) => as.length);
    let screenshot = '';
    if (opts.screenshotPath) {
      fs.mkdirSync(path.dirname(path.resolve(opts.screenshotPath)), { recursive: true });
      await page.screenshot({ path: opts.screenshotPath, fullPage: true });
      screenshot = path.resolve(opts.screenshotPath);
    }
    const first = tables[0] || { headers: [], rows: [] };
    return {
      kind: 'browser', source: String(browserUrl), finalUrl: page.url(), title, links, screenshot,
      frames: page.frames().map((f) => f.url()),
      tables: tables.map((t) => ({ frame: t.frame, headers: t.headers, count: t.rows.length, sample: t.rows.slice(0, 3) })),
      fields: first.headers, sample: first.rows.slice(0, 3), count: first.rows.length,
      storageState: storageState || '',
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function probe(params = {}) {
  if (params.fixture) return probeFixture(params.fixture);
  if (params.apiUrl) return probeHttp(params.apiUrl, params);
  if (params.browserUrl) return probeBrowser(params.browserUrl, params);
  throw new Error('缺少勘探参数：需要 params.fixture / params.apiUrl / params.browserUrl');
}

module.exports = {
  probe, probeFixture, probeHttp, probeBrowser, summarizeList,
  loadAllowlist, isHostAllowed, isPrivateIp, assertUrlAllowed,
  MAX_BYTES, DEFAULT_ALLOWLIST,
};
