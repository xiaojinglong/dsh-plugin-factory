'use strict';

/**
 * crawler.js —— page-audit 执行层（浏览器型：登录态 + 多页巡检 + 截图 + 逐条问题）
 *
 * 站点：本插件内置的本地模拟站点（service/fixture-server.js，随机端口）。
 * 覆盖场景：storageState 登录态复用 / 缺失时模拟登录并保存 / SPA 无关的静态多页 / 截图留证 / 链接 404 检查。
 */

const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SESSION_FILE = process.env.SESSION_FILE || path.join(__dirname, '..', 'data', 'sessions', 'page-audit.json');
const PAGES = ['/index.html', '/page2.html', '/page3.html'];
const RULES = {
  MISSING_ALT: { level: 'P2', label: '图片缺少 alt' },
  SHORT_TITLE: { level: 'P3', label: '标题过短（<8 字符）' },
  MISSING_PRICE: { level: 'P2', label: '价格缺失' },
  BROKEN_LINK: { level: 'P1', label: '链接 404' },
  DUPLICATE_TITLE: { level: 'P3', label: '标题重复' },
};

let browserPromise = null;
async function getBrowser() {
  if (browserPromise) {
    try { const b = await browserPromise; if (b.isConnected()) return b; } catch { /* ignore */ }
    browserPromise = null;
  }
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ headless: String(process.env.HEADLESS || 'true') !== 'false', args: ['--no-sandbox', '--disable-gpu'] })
      .then((b) => { b.on('disconnected', () => { browserPromise = null; }); return b; });
  }
  return browserPromise;
}
async function closeBrowser() {
  const p = browserPromise; browserPromise = null;
  if (!p) return;
  try { const b = await p; await b.close(); } catch { /* ignore */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureLogin(page, ctx, base) {
  ctx.setProgress('检查登录态');
  await page.goto(`${base}${PAGES[0]}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (/login\.html/.test(page.url())) {
    ctx.setProgress('登录态缺失：执行模拟登录');
    await page.locator('#login').click({ timeout: 10000 });
    await page.waitForURL(/index\.html/, { timeout: 15000 });
    await page.waitForSelector('table.audit tbody tr', { timeout: 15000 });
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    await page.context().storageState({ path: SESSION_FILE });
    ctx.log(`已保存登录态：${SESSION_FILE}`);
    return { loggedIn: true };
  }
  return { loggedIn: false };
}

async function scanPage(page, ctx, base, pathname, seq, started) {
  ctx.setProgress(`巡检第 ${seq} 页：${pathname}`);
  await page.goto(`${base}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('table.audit tbody tr', { timeout: 15000 });
  const title = (await page.title()).trim();
  const items = await page.$$eval('table.audit tbody tr', (trs) => trs.map((tr) => {
    const tds = [...tr.querySelectorAll('td')];
    const img = tr.querySelector('img');
    return {
      title: (tds[0]?.innerText || '').trim(),
      price: (tds[1]?.innerText || '').trim(),
      link: tr.querySelector('a')?.getAttribute('href') || '',
      imgAlt: img ? (img.getAttribute('alt') || '') : '__no_img__',
    };
  }));

  const links = [...new Set(items.map((i) => i.link).filter((h) => h && h.startsWith('/')))];
  const linkStatus = await page.evaluate(async (hrefs) => {
    const out = {};
    for (const href of hrefs) {
      try { const r = await fetch(href, { method: 'GET' }); out[href] = r.status; } catch { out[href] = 0; }
    }
    return out;
  }, links);

  const issues = [];
  for (const it of items) {
    if (it.imgAlt === '') issues.push({ rule: 'MISSING_ALT', level: RULES.MISSING_ALT.level, title: it.title, detail: RULES.MISSING_ALT.label });
    if (it.title && it.title.length < 8) issues.push({ rule: 'SHORT_TITLE', level: RULES.SHORT_TITLE.level, title: it.title, detail: `${RULES.SHORT_TITLE.label}（${it.title.length}）` });
    if (!it.price) issues.push({ rule: 'MISSING_PRICE', level: RULES.MISSING_PRICE.level, title: it.title, detail: RULES.MISSING_PRICE.label });
    if (it.link && linkStatus[it.link] === 404) issues.push({ rule: 'BROKEN_LINK', level: RULES.BROKEN_LINK.level, title: it.title, detail: `${it.link} → 404` });
  }

  const tmp = path.join(os.tmpdir(), `page-audit-${Date.now()}-${seq}.png`);
  await page.screenshot({ path: tmp, fullPage: true });
  const saved = await ctx.saveFile({ kind: 'detail', fileName: `page-${seq}.png`, sourcePath: tmp });
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }

  return {
    seq, path: pathname, title, items: items.length, issues,
    screenshot: saved.relativePath, elapsed_ms: Date.now() - started,
    status: issues.length ? 'issues' : 'clean',
    _items: items,
  };
}

async function runJob(job, ctx) {
  clearTimeout(__idleTimer);
  const p = ctx.params || {};
  const limit = Math.max(1, Math.min(PAGES.length, Number(p.pages) || PAGES.length));
  const base = process.env.PAGE_AUDIT_BASE || 'http://127.0.0.1:18898';
  const started = Date.now();
  const sessionExisted = fs.existsSync(SESSION_FILE);

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    ...(sessionExisted ? { storageState: SESSION_FILE } : {}),
  });
  const page = await context.newPage();
  const pagesData = [];
  let sessionReused = sessionExisted;

  try {
    const login = await ensureLogin(page, ctx, base);
    if (login.loggedIn) sessionReused = false;
    for (let i = 0; i < limit; i += 1) {
      if (ctx.isAborted()) throw new Error('任务已被终止');
      pagesData.push(await scanPage(page, ctx, base, PAGES[i], i + 1, started));
      await sleep(200);
    }
  } finally {
    await context.close().catch(() => {});
    scheduleIdleClose();
  }

  // 跨页/页内重复标题：重复出现的第 2 次起计为问题
  const allItems = pagesData.flatMap((pd) => pd._items.map((it) => ({ title: it.title, seq: pd.seq })));
  const counts = new Map();
  for (const it of allItems) counts.set(it.title, (counts.get(it.title) || 0) + 1);
  const seen = new Set();
  for (const it of allItems) {
    if (counts.get(it.title) <= 1) continue;
    if (!seen.has(it.title)) { seen.add(it.title); continue; }
    const pd = pagesData.find((x) => x.seq === it.seq);
    pd.issues.push({ rule: 'DUPLICATE_TITLE', level: RULES.DUPLICATE_TITLE.level, title: it.title, detail: RULES.DUPLICATE_TITLE.label });
    pd.status = 'issues';
  }

  const rows = pagesData.map((pd) => ({
    seq: pd.seq, path: pd.path, title: pd.title, items: pd.items,
    issues: pd.issues, screenshot: pd.screenshot, elapsed_ms: pd.elapsed_ms, status: pd.status,
  }));
  const issueCount = rows.reduce((s, r) => s + r.issues.length, 0);
  const dataset = {
    task: 'page_audit',
    fetchedAt: new Date().toISOString(),
    params: { pages: limit },
    extra: {
      base, pageCount: rows.length, itemCount: pagesData.reduce((s, x) => s + x.items, 0),
      issueCount, sessionReused, sessionFile: SESSION_FILE, elapsedMs: Date.now() - started,
      screenshots: rows.map((r) => r.screenshot),
    },
    total: rows.length,
    totalPages: '-',
    pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'page_audit_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：${rows.length} 页 / ${dataset.extra.itemCount} 条 / 问题 ${issueCount} 个`);
}

let __idleTimer = null;
function scheduleIdleClose() {
  clearTimeout(__idleTimer);
  const ms = Number(process.env.BROWSER_IDLE_MS || 600000);
  __idleTimer = setTimeout(() => { closeBrowser().catch(() => {}); }, ms);
  if (__idleTimer.unref) __idleTimer.unref();
}

module.exports = { runJob, getBrowser, closeBrowser, scheduleIdleClose, PAGES, RULES };
