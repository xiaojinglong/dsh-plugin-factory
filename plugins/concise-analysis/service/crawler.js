'use strict';

/**
 * crawler.js —— 核心采集层（唯一与页面选择器强耦合的模块）
 *
 * 当前业务：吉客印 ——「平台经营分析」经营分析导出
 *
 * 真实链路（依据对 gsmp.giikin.com 前端资源的侦察结论）：
 *   1. 打开 https://gsmp.giikin.com/home
 *      - 已登录：直接进首页（cookie userToken / storageState 复用）
 *      - 未登录：守护者 SSO →『选择组织』→ 钉钉扫码（二维码是 canvas）；沿用原有
 *        needVerify + autoResume 机制，扫码后自动续跑
 *   2. 右上角【大数据】是 window.open 新标签页，进入帆软 FineBI（bi.giikin.com:28090/webroot/decision）；
 *      若 BI 侧走登录桥接页，会点【本人账号一键登录】/ 选择组织（best-effort，失败会带原因）
 *   3. 左侧【平台业务】展开 →【平台经营分析】→ 等报表表格出现
 *      （FineBI 报表通常在 iframe 里，本文件所有定位都跨 frame 搜索）
 *   4. 筛选：平台=shopee、线路=新加坡、站长=丁月；维度勾选 平台/线路/店铺名；
 *      指标（利润分组）勾选 毛利润/运营成本/净利润/净利率（可由 POST /jobs 的 params 覆盖）
 *   5. 点【查询】，等加载遮罩消失 + 表格出数据
 *   6. 左上角【原样导出】下载汇总表
 *   7. 逐行点击【站点名称】单元格 → 菜单【订单明细（下载）】下载该店明细；
 *      单店失败记入 missingItems 后继续下一家
 *
 * 架构约束（保持不变）：
 * - 浏览器打开页面、元素等待、点击、填表、采集、下载文件，全部集中在本文件；
 * - server.js / job.js / 接口契约 / 任务队列 / 状态规则 / 文件存储规则完全不知道页面细节；
 * - 等待策略：禁止固定 sleep 作为页面同步手段，全部使用 locator.waitFor / waitForFunction /
 *   networkidle / waitForEvent('download')；
 * - 产物映射：下载成功的当场调用 ctx.saveFile({ itemName, fileName, kind })，由 job.js 写入 meta.json，
 *   绝不事后靠文件名反推业务映射；
 * - 失败语义：页面/查询超时 → 抛错（job failed）；主报表失败 → 抛错；单店失败 → ctx.addMissing 后继续。
 *
 * 站点适配点：所有真实 DOM 的候选选择器集中在 SEL 与各 helper 的候选数组中。
 * 目标系统是 Vue2 + FineBI（非 Element UI），因此本文件以「文本/role 定位 + 跨 frame 搜索」为主，
 * Element UI / Ant Design 语义作为兜底；真机结构若有差异，只需在候选数组补选择器。
 */

const path = require('node:path');
const fs = require('node:fs/promises');

const { chromium } = require('playwright');
const { CONFIG, PATHS, safeFileName, withRetry, withTimeout, sanitizeError } = require('./util');

/**
 * 版本标识：服务启动（require 本模块）时打印。
 * 若启动日志里没有这一行 / 版本号不符，说明进程加载的是旧代码，需要重启服务。
 */
const CRAWLER_VERSION = '2026-11-12.16:52 · 参数乱码自动回退';
console.log(`[crawler] 版本 ${CRAWLER_VERSION}`);

/* ================================================================== */
/* 0. 业务默认值 & 页面选择器策略（站点适配点）                          */
/* ================================================================== */

/** 需求固定的默认筛选条件；POST /jobs 的 params 可覆盖（接口不新增，只是入参透传） */
const DEFAULT_FILTERS = Object.freeze({
  platform: 'shopee',
  line: '新加坡',
  station: '丁月',
  dimensions: ['平台', '线路', '店铺名'],
  metrics: ['毛利润', '运营成本', '净利润', '净利率'],
});

/** 单个店铺明细下载超时：失败要尽快结束，不能拖垮整个任务（主报表仍用 navTimeoutMs） */
const DETAIL_DOWNLOAD_TIMEOUT_MS = Math.min(CONFIG.navTimeoutMs, 8000);

/** 把参数值规整成非空字符串数组 */
function asTextList(value, fallback) {
  if (Array.isArray(value)) {
    const list = value.map((v) => String(v ?? '').trim()).filter(Boolean);
    if (list.length) return list;
  } else if (value !== undefined && value !== null) {
    const one = String(value).trim();
    if (one) return [one];
  }
  return Array.isArray(fallback) ? fallback.slice() : [fallback].filter(Boolean);
}

/** 是否包含中文字符（用于识别“提交参数中文被终端/编码损坏”的情况） */
function hasCJK(value) {
  return /[\u3400-\u9FFF]/.test(String(value ?? ''));
}

/** 从参数里取字符串数组（非空） */
function rawTextList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (value !== undefined && value !== null) {
    const one = String(value).trim();
    if (one) return [one];
  }
  return [];
}

/**
 * 中文单值参数清洗：
 * - 用户没传 → 用默认值；
 * - 传了但没有任何中文字符（典型是终端编码/剪贴板把中文变成乱码）→ 回退默认值并告警。
 */
function pickChineseValue(value, fallback) {
  const fallbackList = Array.isArray(fallback) ? fallback.slice() : [fallback];
  const raw = rawTextList(value);
  if (!raw.length) return fallbackList;
  const valid = raw.filter(hasCJK);
  if (!valid.length || valid.length !== raw.length) {
    console.warn('[crawler] 检测到筛选参数中文疑似编码损坏，已回退默认值：', JSON.stringify(raw));
    return fallbackList;
  }
  return valid;
}

/** 中文多选参数清洗（维度/指标），规则同上 */
function pickChineseList(value, fallback) {
  const raw = rawTextList(value);
  if (!raw.length) return fallback.slice();
  const valid = raw.filter(hasCJK);
  if (!valid.length || valid.length !== raw.length) {
    console.warn('[crawler] 检测到维度/指标参数中文疑似编码损坏，已回退默认值：', JSON.stringify(raw));
    return fallback.slice();
  }
  return valid;
}

/** 从 job.params 组装筛选条件（默认值与需求一致；键名兼容别名；损坏中文自动回退） */
function pickFilters(params = {}) {
  const p = params || {};
  // 只下载汇总表：onlySummary=true 或 includeDetails=false 时跳过多店铺明细
  const includeDetails = p.includeDetails !== false && p.onlySummary !== true;
  return {
    platform: asTextList(p.platform, DEFAULT_FILTERS.platform),
    line: pickChineseValue(p.line ?? p.route, DEFAULT_FILTERS.line),
    station: pickChineseValue(p.station ?? p.stationMaster ?? p.master, DEFAULT_FILTERS.station),
    dimensions: pickChineseList(p.dimensions, DEFAULT_FILTERS.dimensions),
    metrics: pickChineseList(p.metrics, DEFAULT_FILTERS.metrics),
    includeDetails,
  };
}

/** 英文选项的大小写变体（站点选项可能是 shopee / Shopee / SHOPEE） */
function caseVariants(text) {
  const s = String(text ?? '').trim();
  if (!s) return [];
  const out = new Set([s]);
  out.add(s.toLowerCase());
  out.add(s.toUpperCase());
  if (s.length > 1) out.add(s[0].toUpperCase() + s.slice(1).toLowerCase());
  return [...out];
}

/** 多值展开为“每个值的大小写变体”，保持顺序去重 */
function expandVariants(list) {
  const out = [];
  for (const item of list || []) {
    for (const v of caseVariants(item)) {
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** 选择器策略：真实页面结构变化时只改这里（以及 helper 里的候选数组） */
const SEL = {
  /* ---- 登录：守护者 SSO + 钉钉扫码（二维码为 canvas） ---- */
  authUrlPatterns: [
    /\/guard\/sso\//i,
    /login\.dingtalk\.com/i,
    /\/(?:login|logout|oauth|passport|authorize)\b/i,
    /fe\/data-aid\/fine\/login/i,
    /webroot\/decision\/login/i,
  ],
  loginQr: [
    '.app-qr-login-page .module-qrcode-code canvas',
    '.module-qrcode-code canvas',
    '.qrcode canvas',
    'iframe[src*="login.dingtalk.com"]',
    'iframe[src*="dingtalk"]',
    'iframe[src*="oauth"]',
    'img[alt*="二维码"]',
    'img[title*="二维码"]',
    'img[src*="qrcode"]',
    'img[src*="qr"]',
    '[class*="qrcode"] img',
    '[class*="qrcode"] canvas',
    '[class*="qr-code"]',
    '.qrcode',
    '#qrcode',
    // 注意：不要放裸 canvas —— 已登录首页的图表也是 canvas，会误判为登录页
  ],
  loginCaptcha: ['input[name="captcha"]', 'input#captcha', 'input[placeholder*="验证码"]'],
  /* SSO 登录过程中的中间页 */
  bridgeTexts: ['本人账号一键登录', '一键登录', '账号一键登录'],
  orgSelectors: ['#divCompany_0', '[id^="divCompany_"]', '[class*="company-item"]', '[class*="org-item"]'],
  orgTexts: ['吉客印（郑州）数字科技', '吉客印(郑州)数字科技', '武汉吉喵云', '选择组织'],
  loginTabTexts: ['扫码登录', '二维码登录'],
  /* 登录成功/业务壳：首页、数据平台、报表页出现任一即视为已进入业务系统 */
  appShell: [
    '.el-menu',
    '.el-container',
    '.el-aside',
    '[class*="sidebar"]',
    '[class*="app-main"]',
    '[class*="layout"]',
    '[class*="decision"]',
    '#reportFrame',
    'nav',
    'aside',
  ],
  shellTexts: ['平台业务', '平台经营分析', '大数据', '数据平台'],

  /* ---- 顶部导航 / 左侧菜单 ---- */
  bigDataTexts: ['大数据'],
  /* 真实站点的【大数据】藏在 hover 展开的工具栏里 */
  bigDataHover: [
    '.special_menu .tools_wrap',
    '.special_menu',
    '[class*="tools_wrap"]',
    '[class*="special_menu"]',
    '[class*="header"] [class*="tools"]',
  ],
  platformGroupTexts: ['平台业务'],
  reportPageTexts: ['平台经营分析'],

  /* ---- 报表筛选区 ---- */
  dimensionGroupLabels: ['维度', '维度选择', '统计维度'],
  metricGroupLabels: ['指标', '利润分组指标', '利润分组', '指标选择', '利润指标', '指标（利润分组）'],
  queryTexts: ['查询', '查 询'],

  /* ---- 结果表格（标准 table 语义优先，FineBI 类名兜底） ---- */
  tableHeaders: [
    '.el-table__header-wrapper thead tr:last-child th',
    '.el-table__header-wrapper thead th',
    '.el-table__header th',
    'table thead th',
    '.ant-table-thead th',
    '[class*="bi-table"] th',
    '[class*="table"] thead th',
  ],
  tableRows: [
    '.el-table__body-wrapper > table > tbody > tr',
    '.el-table__body-wrapper > table.el-table__body > tbody > tr',
    '.el-table__body-wrapper tbody tr',
    '.el-table__fixed-body-wrapper tbody tr',
    '.ant-table-tbody > tr',
    'table tbody tr',
    '[class*="bi-table"] tbody tr',
    '[class*="table"] tbody tr',
  ],
  emptyTexts: ['.el-table__empty-text', '.ant-empty-description', '[class*="empty-text"]', '[class*="empty"]'],
  siteNameHeader: '站点名称',

  /* ---- 导出 ---- */
  mainExportTexts: ['原样导出', '原样导出（下载）'],
  detailMenuTexts: ['订单明细（下载）', '订单明细(下载)', '订单明细下载', '订单明细'],
  dialogConfirmTexts: ['确定', '确认'],
  loadingMask: ['.el-loading-mask', '.ant-spin-spinning', '[class*="loading-mask"]', '[class*="loadingMask"]'],
};

/* ================================================================== */
/* 1. 浏览器单例（崩溃后自动重建）                                       */
/* ================================================================== */

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.isConnected()) return b;
      console.warn('[crawler] 浏览器已断开，重建中');
      browserPromise = null;
    } catch {
      browserPromise = null;
    }
  }
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: CONFIG.headless,
        slowMo: CONFIG.slowMo,
        args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
      })
      .then((b) => {
        console.log('[crawler] Chromium 已启动');
        b.on('disconnected', () => {
          console.warn('[crawler] Chromium 断开');
          browserPromise = null;
        });
        return b;
      });
  }
  return browserPromise;
}

async function closeBrowser() {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  try {
    const b = await p;
    await b.close();
    console.log('[crawler] Chromium 已关闭');
  } catch {
    /* ignore */
  }
}

/* ================================================================== */
/* 2. 入口：runJob(job, ctx)                                            */
/* ================================================================== */

/**
 * @param {object} job 任务对象（只读使用 jobId；状态变更一律走 ctx）
 * @param {object} ctx 由 job.js 注入：setProgress / needVerify / autoResume / saveFile / addMissing / isAborted
 */
async function runJob(job, ctx) {
  const browser = await getBrowser();
  const context = await createContext();
  const page = await context.newPage();
  page.setDefaultTimeout(CONFIG.navTimeoutMs);
  page.setDefaultNavigationTimeout(CONFIG.navTimeoutMs);

  // 页面级异常只记录，不中断流程（由具体步骤的超时决定成败）
  page.on('pageerror', (err) => console.warn(`[crawler:${job.jobId}] 页面脚本异常：${err.message}`));

  try {
    if (CONFIG.demoMode) {
      await runDemo(page, ctx);
    } else {
      await runReal(page, ctx);
      // 成功后才持久化登录态，避免把半登录的坏 cookie 存下来
      await page.context().storageState({ path: PATHS.sessionFile(CONFIG.sessionName) }).catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
  }
}

/** 创建上下文：复用 sessions 目录里的登录态 */
async function createContext() {
  const browser = await getBrowser();
  const sessionFile = PATHS.sessionFile(CONFIG.sessionName);

  let storageState;
  try {
    await fs.access(sessionFile);
    storageState = sessionFile; // Playwright 支持直接传文件路径
    console.log('[crawler] 复用登录态：', sessionFile);
  } catch {
    console.log('[crawler] 无历史登录态，将走首次登录流程');
  }

  return browser.newContext({
    storageState,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
}

/* ================================================================== */
/* 3. 真实站点流程：吉客印「平台经营分析」导出                           */
/* ================================================================== */

/** 在页面/iframe 内按“可见 + 精确文本”点击（DOM 点击，绕过遮挡/动画导致的 actionability 等待） */
async function clickVisibleText(target, text, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await target
      .evaluate((needle) => {
        const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden';
        };
        const hits = [...document.querySelectorAll('a, button, li, span, div')].filter(
          (el) => norm(el.textContent) === needle
        );
        const el = hits.find(vis);
        if (!el) return false;
        el.click();
        return true;
      }, text)
      .catch(() => false);
    if (clicked) return true;
    const waitTarget = typeof target.page === 'function' ? target.page() : target;
    await waitTarget.waitForTimeout(300);
  }
  return false;
}

/** 打开【三方】菜单并进入 Shopee店铺健康监测，返回 iframe */
async function openShopeeHealthFrame(page) {
  await page.getByText('三方', { exact: true }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const leaves = page.getByText('Shopee店铺健康监测', { exact: true });
  const n = await leaves.count().catch(() => 0);
  let clicked = false;
  for (let i = 0; i < n; i += 1) {
    const leaf = leaves.nth(i);
    if (await leaf.isVisible().catch(() => false)) {
      await leaf.click({ timeout: 10000 }).catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error('未找到可见的【Shopee店铺健康监测】菜单项');
  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(800);
    const frame = page.frames().find((f) => /shopeeShopHealth/.test(f.url()));
    if (frame) return frame;
  }
  throw new Error('Shopee店铺健康监测 iframe 未出现');
}

/** 判断是否为 Shopee 店铺健康监测任务（task=shopee_health） */
function isShopeeHealthTask(params = {}) {
  const task = String(params.task || params.module || '').toLowerCase();
  return task === 'shopee_health' || task === 'shopee-health' || task === 'shopeehealth';
}

/**
 * Shopee 店铺健康监测：三方 → shopee运营系统 → Shopee店铺健康监测（iframe）
 * 设置日期 → 查询 → 抓表格 → 翻页取前 N 页 → 生成 data.txt
 */
async function runShopeeHealth(page, ctx) {
  const params = ctx.params || {};
  const date = String(params.date || '2026-11-11');
  const pages = Math.max(1, Math.min(50, Number(params.pages) || 5));
  const progress = (msg) => ctx.setProgress(msg);

  await page.setViewportSize({ width: 1600, height: 950 });
  await page.waitForTimeout(500);
  progress('打开【三方】菜单');
  const frame = await openShopeeHealthFrame(page);
  ctx.log('已进入 Shopee店铺健康监测 iframe');
  page.setDefaultTimeout(15000);
  await page.waitForTimeout(2000);

  progress(`设置日期：${date}`);
  const dateInput = frame.locator('input[placeholder="选择日期"]').first();
  await dateInput.waitFor({ state: 'visible', timeout: 20000 });
  await dateInput.click({ timeout: 10000 });
  await dateInput.fill(date);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  progress('查询中，等待列表数据');
  const firstResp = page.waitForResponse(
    (r) => /overallPerformance\/list/.test(r.url()) && /[?&]page=1(&|$)/.test(r.url()),
    { timeout: 30000 }
  );
  if (!(await clickVisibleText(frame, '查询', 10000))) {
    await frame.getByText('查询', { exact: true }).first().click({ timeout: 10000 });
  }
  await firstResp.catch(() => null);
  await page.waitForTimeout(1500);

  const readTable = async () =>
    frame.evaluate(() => {
      const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const tables = [...document.querySelectorAll('table')];
      const headerTable = tables.find((t) => t.querySelectorAll('thead th').length > 30);
      const header = headerTable
        ? [...headerTable.querySelectorAll('thead th')].map(textOf).filter(Boolean)
        : [];
      let body = tables[0];
      let max = 0;
      for (const t of tables) {
        const n = t.querySelectorAll('tbody tr').length;
        if (n > max) { max = n; body = t; }
      }
      const rows = body
        ? [...body.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map(textOf))
        : [];
      return { header, rows };
    });

  // 等首页表格渲染
  let table = { header: [], rows: [] };
  for (let i = 0; i < 20; i += 1) {
    table = await readTable();
    if (table.rows.length) break;
    await page.waitForTimeout(500);
  }
  if (!table.rows.length) throw new Error('查询后列表为空（未取到数据行）');
  if (!table.header.length) throw new Error('未解析到列表表头');
  ctx.log(`表头 ${table.header.length} 列，首页 ${table.rows.length} 行`);

  const allRows = [...table.rows];
  const seen = new Set(allRows.map((r) => r.join('|')));
  for (let p = 2; p <= pages; p += 1) {
    progress(`抓取第 ${p}/${pages} 页`);
    const resp = page.waitForResponse(
      (r) => /overallPerformance\/list/.test(r.url()) && new RegExp('[?&]page=' + p + '(&|$)').test(r.url()),
      { timeout: 30000 }
    );
    const pager = frame.locator('.el-pagination:visible').first();
    const next = pager.locator('button.btn-next');
    if (await next.count().catch(() => 0)) {
      await next.click({ timeout: 10000 });
    } else {
      await pager
        .locator('.el-pager li')
        .filter({ hasText: new RegExp('^' + p + '$') })
        .first()
        .click({ timeout: 10000 });
    }
    await resp.catch(() => null);
    await page.waitForTimeout(1200);

    let pageRows = [];
    for (let i = 0; i < 20; i += 1) {
      const t = await readTable();
      pageRows = t.rows;
      const sig = t.rows.map((r) => r.join('|')).join('||');
      if (t.rows.length && !seen.has(t.rows[0].join('|'))) {
        if (!sig) continue;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!pageRows.length) {
      ctx.log(`第 ${p} 页无数据，提前结束`);
      break;
    }
    for (const row of pageRows) {
      const key = row.join('|');
      if (!seen.has(key)) {
        seen.add(key);
        allRows.push(row);
      }
    }
  }

  progress(`生成 data.txt（${allRows.length} 行）`);
  const lines = [table.header.join('\t'), ...allRows.map((r) => r.join('\t'))];
  const tsv = lines.join('\n');
  await ctx.saveFile({ fileName: 'data.txt', kind: 'main', content: tsv, encoding: 'utf8' });
  ctx.log(`已保存 data.txt：${table.header.length} 列 × ${allRows.length} 行（日期 ${date}）`);
}

/** 判断是否为 Shopee 店铺商品批量管理任务（task=shopee_batch） */
function isShopeeBatchTask(params = {}) {
  const task = String(params.task || params.module || '').toLowerCase();
  return task === 'shopee_batch' || task === 'shopee-batch' || task === 'goodsbatch';
}

/** 打开 三方 → 店铺商品批量管理，返回 goodsBatchManagement iframe */
async function openShopeeBatchFrame(page) {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.waitForTimeout(500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByText('三方', { exact: true }).first().click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const leaves = page.getByText('店铺商品批量管理', { exact: true });
    const n = await leaves.count().catch(() => 0);
    for (let i = 0; i < n; i += 1) {
      if (await leaves.nth(i).isVisible().catch(() => false)) {
        await leaves.nth(i).click({ timeout: 10000 }).catch(() => {});
        break;
      }
    }
    for (let i = 0; i < 25; i += 1) {
      await page.waitForTimeout(800);
      const frame = page.frames().find((f) => /goodsBatchManagement/.test(f.url()));
      if (frame) return frame;
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  throw new Error('店铺商品批量管理页面未加载（iframe 未出现）');
}

/** 读取当前列表页的表格（表头 + 数据行） */
async function readShopeeBatchTable(frame) {
  return frame.evaluate(() => {
    const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const tables = [...document.querySelectorAll('table')];
    const headerTable = tables.find((t) => t.querySelectorAll('thead th').length > 10);
    let body = null;
    let max = 0;
    for (const t of tables) {
      const n = t.querySelectorAll('tbody tr').length;
      if (n > max) { max = n; body = t; }
    }
    const headers = headerTable ? [...headerTable.querySelectorAll('thead th')].map(textOf) : [];
    const rows = body ? [...body.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map(textOf)) : [];
    const pager = [...document.querySelectorAll('.el-pagination')].find((p) => p.getBoundingClientRect().width > 1);
    const pagerText = pager ? textOf(pager) : '';
    const totalMatch = pagerText.match(/共\s*(\d+)\s*条/);
    return { headers, rows, pagerText, total: totalMatch ? Number(totalMatch[1]) : null };
  });
}

/**
 * Shopee 店铺商品批量管理：站长筛选 → 查询 → 上传失败 tab → 前 N 页 → datajson.txt
 */
async function runShopeeBatch(page, ctx) {
  const params = ctx.params || {};
  const master = String(params.master || params.station || params.stationMaster || '丁月');
  const tabName = String(params.tab || params.statusTab || '上传失败');
  const pages = Math.max(1, Math.min(50, Number(params.pages) || 3));
  const progress = (msg) => ctx.setProgress(msg);

  progress('进入 Shopee 店铺商品批量管理');
  const frame = await openShopeeBatchFrame(page);
  await page.setDefaultTimeout(15000);
  ctx.log('已进入 goodsBatchManagement iframe');
  await page.waitForTimeout(2500);

  progress(`设置站长：${master}`);
  const masterInput = frame.locator('input[placeholder="站长"]').first();
  await masterInput.waitFor({ state: 'visible', timeout: 20000 });
  let picked = false;
  for (let attempt = 0; attempt < 3 && !picked; attempt += 1) {
    await masterInput.click({ timeout: 5000 }).catch(() => {});
    await masterInput.fill('').catch(() => {});
    await masterInput.fill(master).catch(() => {});
    await page.waitForTimeout(1500);
    const options = frame.locator('.el-select-dropdown__item, .el-autocomplete-suggestion li, .el-cascader-node');
    const optionCount = await options.count().catch(() => 0);
    for (let i = 0; i < optionCount; i += 1) {
      const opt = options.nth(i);
      if (!(await opt.isVisible().catch(() => false))) continue;
      const text = ((await opt.innerText().catch(() => '')) || '').trim();
      if (text.includes(master)) {
        await opt.click({ timeout: 5000 }).catch(() => {});
        picked = true;
        break;
      }
    }
    if (!picked) await page.keyboard.press('Escape').catch(() => {});
  }
  if (!picked) throw new Error(`站长下拉中未找到「${master}」`);
  const selectedMaster = (await masterInput.inputValue().catch(() => '')) || '';
  if (!selectedMaster.includes(master)) throw new Error(`站长设置未生效（输入框值：${selectedMaster}）`);
  ctx.log(`站长已选择：${master}`);

  progress('查询中，等待列表数据');
  const waitListing = (status, pageNo) => page.waitForResponse(
    (r) => {
      if (!/\/agent\/shopee\/listing\/listing/.test(r.url())) return false;
      const body = r.request().postData() || '';
      return body.includes('"status":"' + status + '"') && new RegExp('"page":' + pageNo + '([,}])').test(body);
    },
    { timeout: 30000 }
  );
  const normalResp = waitListing('NORMAL', 1);
  await frame.getByText('查询', { exact: true }).first().click({ timeout: 10000 });
  await normalResp.catch(() => null);
  await page.waitForTimeout(1500);

  progress(`切换到【${tabName}】`);
  const tabResp = waitListing('UPFAILED', 1);
  const tab = frame.locator('.el-tabs__item').filter({ hasText: tabName }).first();
  if (!(await tab.count().catch(() => 0))) throw new Error(`未找到【${tabName}】标签页`);
  await tab.click({ timeout: 10000 });
  await tabResp.catch(() => null);
  await page.waitForTimeout(1500);

  let table = { headers: [], rows: [], total: null, pagerText: '' };
  for (let i = 0; i < 20; i += 1) {
    table = await readShopeeBatchTable(frame);
    if (table.rows.length) break;
    await page.waitForTimeout(500);
  }
  if (!table.rows.length) throw new Error(`【${tabName}】列表为空（未取到数据行）`);
  if (!table.headers.length) throw new Error('未解析到列表表头');
  ctx.log(`表头 ${table.headers.length} 列，首页 ${table.rows.length} 行，共 ${table.total ?? '?'} 条`);
  const masterIdx = table.headers.indexOf('站长');
  if (masterIdx >= 0 && table.rows.length) {
    const dist = {};
    for (const row of table.rows) {
      const v = row[masterIdx] || '';
      dist[v] = (dist[v] || 0) + 1;
    }
    ctx.log(`结果列站长分布：${JSON.stringify(dist)}`);
    if (!Object.keys(dist).some((k) => k.includes(master))) {
      ctx.log(`⚠️ 页面结果与筛选站长（${master}）不一致，按页面实际显示取值`);
    }
  }

  const collected = [];
  const seen = new Set();
  const addRows = (rows) => {
    for (const row of rows) {
      const key = row.join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(row);
    }
  };
  addRows(table.rows);

  for (let p = 2; p <= pages; p += 1) {
    progress(`抓取第 ${p}/${pages} 页`);
    const resp = waitListing('UPFAILED', p);
    const next = frame.locator('.el-pagination:visible').first().locator('button.btn-next');
    await next.click({ timeout: 10000 });
    await resp.catch(() => null);
    await page.waitForTimeout(1200);
    let pageRows = [];
    for (let i = 0; i < 20; i += 1) {
      const t = await readShopeeBatchTable(frame);
      pageRows = t.rows;
      if (t.rows.length && !seen.has(t.rows[0].join('|'))) break;
      await page.waitForTimeout(500);
    }
    if (!pageRows.length) {
      ctx.log(`第 ${p} 页无数据，提前结束`);
      break;
    }
    addRows(pageRows);
  }

  const headerKeys = table.headers.map((h, i) => (h ? h : `列${i + 1}`));
  const rows = collected.map((row) => {
    const obj = {};
    headerKeys.forEach((key, i) => {
      obj[key] = row[i] ?? '';
    });
    return obj;
  });
  const payload = {
    task: 'shopee_batch',
    tab: tabName,
    filters: { 站长: master },
    total: table.total,
    pageSize: 20,
    pages,
    headers: headerKeys,
    rowCount: rows.length,
    rows,
  };
  progress(`生成 datajson.txt（${rows.length} 行）`);
  await ctx.saveFile({ fileName: 'datajson.txt', kind: 'main', content: JSON.stringify(payload, null, 2), encoding: 'utf8' });
  ctx.log(`已保存 datajson.txt：${headerKeys.length} 列 × ${rows.length} 行`);
}

async function runReal(page, ctx) {
  const filters = pickFilters(ctx.params);

  try {
    /* ---- 3.1 打开目标系统（含 SSO / 钉钉扫码） ---- */
    ctx.setProgress('打开吉客印综合管理平台');
    page = await withStep('打开目标系统失败', () => openHome(page, ctx));
    if (isShopeeBatchTask(ctx.params)) {
      ctx.setProgress('进入 Shopee 店铺商品批量管理');
      await withStep('Shopee 店铺商品批量管理取数失败', () => runShopeeBatch(page, ctx));
      return;
    }
    if (isShopeeHealthTask(ctx.params)) {
      ctx.setProgress('进入 Shopee 店铺健康监测');
      await withStep('Shopee 店铺健康监测取数失败', () => runShopeeHealth(page, ctx));
      return;
    }

    /* ---- 3.2 大数据 → 数据平台 ---- */
    ctx.setProgress('点击右上角【大数据】进入数据平台');
    page = await withStep('进入数据平台失败', () => openDataPlatform(page, ctx));

    /* ---- 3.2.1 真实站点：帆软 FineBI（报表在 iframe 内，控件/表头均为 FineUI） ---- */
    if (isFinebiPlatform(page)) {
      ctx.setProgress('进入 FineBI【平台经营分析】报表页');
      await withStep('吉客印经营分析导出失败', () => runFinebiFlow(page, ctx, filters));
      return;
    }

    /* ---- 3.2.2 通用页面（本地 mock / 兼容旧站点）：左侧菜单进入 ---- */
    ctx.setProgress('进入【平台业务】→【平台经营分析】');
    page = await withStep('进入平台经营分析页面失败', () => enterReportMenu(page, ctx));

    /* ---- 3.3 设置筛选条件 ---- */
    ctx.setProgress('设置筛选条件：平台/线路/站长/维度/指标');
    const usedWholeGroup = await withStep('设置筛选条件失败', () => applyFilters(page, ctx, filters));

    /* ---- 3.4 查询并等结果表格出数据 ---- */
    ctx.setProgress('查询中，等待报表数据加载');
    await withStep('查询失败', () => runQueryAndWaitResult(page, ctx));

    /* 解析表格：定位【站点名称】列、数据行与站点名称（报表可能在 iframe 内） */
    const table = await withStep('解析报表表格失败', () =>
      resolveReportTable(page, filters, usedWholeGroup, ctx)
    );
    ctx.log(`报表共 ${table.siteNames.length} 行，【站点名称】为第 ${table.columnIndex + 1} 列`);

    /* ---- 3.5 汇总表：左上角【原样导出】 ---- */
    ctx.setProgress('导出汇总表（原样导出）');
    await withStep('汇总表导出失败', () => exportMainReport(page, ctx));
  if (!filters.includeDetails) {
    ctx.log('仅需汇总表：跳过店铺明细下载');
    return;
  }

    /* ---- 3.6 订单明细：逐行点击【站点名称】→【订单明细（下载）】 ---- */
    let detailCount = 0;
    for (let i = 0; i < table.siteNames.length; i++) {
      if (ctx.isAborted()) throw new Error('任务已被终止');

      const itemName = table.siteNames[i] || `第${i + 1}行`;
      ctx.setProgress(`导出店铺明细 ${i + 1}/${table.siteNames.length}：${itemName}`);

      try {
        // 单店失败只登记缺失项，不影响其他店铺（异常隔离）
        const record = await withRetry(
          async () => {
            const download = await downloadDetailForRow(page, table, i);
            // 下载可能被服务端中断/卡住：download.path() 本身没有超时，必须自己兜底，
            // 否则单个店铺的坏下载会把整个任务拖到全局超时。
            const tmpFile = await withTimeout(
              download.path(),
              DETAIL_DOWNLOAD_TIMEOUT_MS + 7000,
              '明细文件落盘超时'
            );
            const fileName = bindDetailFileName(itemName, download.suggestedFilename());
            // ★ 关键：下载当场把【站点名称】与文件绑定写入 meta.json
            return ctx.saveFile({ itemName, fileName, kind: 'detail', sourcePath: tmpFile });
          },
          {
            retries: 1, // 失败行最多再试 1 次：既不重复狂点，也容忍偶发抖动
            delayMs: 800,
            label: `下载「${itemName}」订单明细`,
            onRetry: () => ctx.setProgress(`重试导出：「${itemName}」`),
          }
        );
        detailCount += 1;
        ctx.log(`店铺明细已保存：${record.fileName}`);
      } catch (err) {
        await safeEscape(page);
        await ctx.addMissing(itemName, `订单明细（下载）失败：${sanitizeError(err, 180)}`);
      }
    }

    ctx.log(
      `导出完成：汇总表 1 份，店铺明细 ${detailCount}/${table.siteNames.length}` +
        (detailCount < table.siteNames.length ? `，缺失 ${table.siteNames.length - detailCount} 家` : '')
    );
  } catch (err) {
    // 失败现场留证（截图落在 job 目录，不影响 /result）
    await dumpDebugScreenshot(page, ctx.dir, 'failure');
    throw err;
  }
}

/** 步骤包装：给错误补上业务上下文，便于任务失败时说明原因 */
async function withStep(label, fn) {
  try {
    return await fn();
  } catch (err) {
    throw new Error(`${label}：${sanitizeError(err, 240)}`);
  }
}

/* ================================================================== */
/* 3.1 打开系统 / SSO 登录                                              */
/* ================================================================== */

async function openHome(page, ctx) {
  const target = CONFIG.targetBaseUrl;
  if (!target) throw new Error('未配置 TARGET_BASE_URL，无法进入真实站点');

  ctx.setProgress('打开目标页面');
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: CONFIG.navTimeoutMs });
  } catch (err) {
    throw new Error(`页面打不开：${sanitizeError(err, 180)}`);
  }
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  await ensureAccess(page, ctx);
  ctx.setProgress('已进入系统首页');
  return page;
}

/**
 * 确保进入业务系统：处理登录桥接页 / SSO 选择组织 / 钉钉扫码，最后断言业务壳出现。
 * 已有有效登录态时这里只是一次快速断言。
 */
async function ensureAccess(page, ctx) {
  if (await looksLikeAuthFlow(page)) await resolveAuthFlow(page, ctx);

  if (await waitBusinessShell(page, CONFIG.navTimeoutMs)) return;

  // 兜底：登录页可能异步跳转，再判一次并处理
  if (await looksLikeAuthFlow(page)) {
    await resolveAuthFlow(page, ctx);
    if (await waitBusinessShell(page, CONFIG.navTimeoutMs)) return;
  }
  throw new Error('页面加载超时：未检测到系统主框架（网络异常或页面结构变化）');
}

/** 是否处于登录/授权流程中（以 URL / 登录桥接页 / 组织选择页为准，避免把已登录首页误判） */
async function looksLikeAuthFlow(page) {
  const url = page.url() || '';
  if (SEL.authUrlPatterns.some((re) => re.test(url))) return true;
  if (await raceText(page, [...SEL.bridgeTexts, ...SEL.orgTexts], 1200)) return true;
  return false;
}

/**
 * 登录/授权流程（best-effort 循环）：
 *   登录桥接页 → 选择组织 → 扫码登录页 → 扫码完成回到业务。
 * 每一轮只做一个动作，做完重新判定，避免对未知站点做固定顺序假设。
 */
async function resolveAuthFlow(page, ctx) {
  for (let round = 0; round < 4; round++) {
    // 1) FineBI 登录桥接页
    const bridge = await raceText(page, SEL.bridgeTexts, 2000);
    if (bridge) {
      ctx.setProgress('登录桥接：点击【本人账号一键登录】');
      await bridge.click({ timeout: 15000 }).catch(() => {});
      await settleNavigation(page);
      continue;
    }

    // 2) SSO『选择组织』页
    const org = await raceVisible(orgLocators(page), 1500);
    if (org) {
      ctx.setProgress('SSO：选择登录组织');
      await org.click({ timeout: 15000 }).catch(() => {});
      await settleNavigation(page);
      // 部分页面选完组织还要点一次确认
      if (/guard\/sso/i.test(page.url())) {
        const go = await raceText(page, ['进入', '确定', '确认登录'], 2000);
        if (go) await go.click({ timeout: 10000 }).catch(() => {});
        await settleNavigation(page);
      }
      continue;
    }

    // 3) 扫码登录页：URL 已落在 SSO/钉钉授权域才进入人机校验流程（doLogin 有整页截图兜底）
    const onAuthUrl = SEL.authUrlPatterns.some((re) => re.test(page.url()));
    if (onAuthUrl) {
      const tab = await raceText(page, SEL.loginTabTexts, 800);
      if (tab && !(await isQrVisible(page, 300))) await tab.click({ timeout: 10000 }).catch(() => {});
      await doLogin(page, ctx, {
        qrSelectors: SEL.loginQr,
        captchaSelectors: SEL.loginCaptcha,
        hint: '请使用钉钉扫描二维码登录，扫码完成后任务会自动继续',
      });
      continue;
    }
    break;
  }
}

/** 等页面导航/网络稳定（登录跳转用，失败不抛错） */
async function settleNavigation(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
}

/** 组织选择候选定位器（跨 frame） */
function orgLocators(page) {
  return pageScopes(page).flatMap((scope) => [
    ...SEL.orgSelectors.map((sel) => scope.locator(sel)),
    ...textLocators(scope, SEL.orgTexts),
  ]);
}

/** 二维码是否可见（跨 frame） */
async function isQrVisible(page, timeoutMs) {
  return !!(await raceVisible(
    pageScopes(page).flatMap((scope) => SEL.loginQr.map((sel) => scope.locator(sel))),
    timeoutMs
  ));
}

/** 业务壳是否出现（登录成功的断言，也是“已有登录态”的判定） */
async function waitBusinessShell(page, timeoutMs) {
  return !!(await raceVisible(
    pageScopes(page).flatMap((scope) => [
      ...SEL.appShell.map((sel) => scope.locator(sel)),
      ...textLocators(scope, SEL.shellTexts),
    ]),
    timeoutMs
  ));
}

/**
 * 人机校验流程（结构沿用原实现）：截图二维码 -> 进入 waiting_verify -> 等待外部提交验证码
 * 或检测到扫码完成（页面自动跳转）-> autoResume。选择器换成钉钉 canvas 等候选。
 */
async function doLogin(page, ctx, { qrSelectors, captchaSelectors }) {
  ctx.setProgress('检测到登录页，等待钉钉扫码/验证码');

  // 抓取二维码/验证码图片（元素截图，比下载 img 更稳）；二维码是 canvas 也能截
  let imageBuffer = null;
  const qrEl = await raceVisible(
    pageScopes(page).flatMap((scope) => qrSelectors.map((sel) => scope.locator(sel))),
    15000
  );
  if (qrEl) imageBuffer = await qrEl.screenshot({ type: 'png' }).catch(() => null);
  if (!imageBuffer) {
    // 兜底：给整页截图，保证 HEADLESS 下人工也能看到二维码完成扫码
    console.warn('[crawler] 未定位到二维码元素，降级为整页截图');
    imageBuffer = await page.screenshot({ type: 'png' }).catch(() => null);
  }

  // 进入 waiting_verify：此后 GET /jobs/:id/verify 可拿到这张图（HTTP 侧不阻塞）
  const verifyPromise = ctx.needVerify({
    imageBuffer,
    contentType: 'image/png',
    hint: '请使用钉钉扫描二维码登录，扫码完成后任务会自动继续',
  });

  // 后台监听：用户扫码后页面会自动跳转，无需外部输入
  const autoWatch = waitBusinessShell(page, CONFIG.verifyTimeoutMs)
    .then((ok) => {
      if (ok) {
        ctx.log('检测到登录成功（扫码完成）');
        ctx.autoResume();
      }
    })
    .catch(() => {});

  const { code } = await verifyPromise;
  autoWatch.catch(() => {});

  // 人工提交的验证码：填入并提交（钉钉扫码一般走 autoResume，这里兼容验证码类校验）
  if (code) {
    const input = await raceVisible(
      pageScopes(page).flatMap((scope) => captchaSelectors.map((sel) => scope.locator(sel))),
      10000
    );
    if (input) {
      await input.fill(code);
      await input.press('Enter');
    }
  }

  // 不管哪种方式，都必须断言登录态真正生效，而不是靠 sleep 猜
  if (!(await waitBusinessShell(page, CONFIG.navTimeoutMs))) {
    throw new Error('登录未完成：未检测到系统主框架');
  }
  ctx.setProgress('登录成功');
}

/* ================================================================== */
/* 3.2 导航：大数据（新标签页）→ 平台业务 → 平台经营分析                  */
/* ================================================================== */

/**
 * 点【大数据】并进入数据平台（真实站点会 window.open 新标签页进入帆软 FineBI）。
 * 登录桥接/SSO 处理由 ensureAccess 兜底。
 */
async function openDataPlatform(page, ctx) {
  page = await openBigData(page);
  await ensureAccess(page, ctx);
  ctx.log(`已进入数据平台（当前页：${page.url()}）`);
  return page;
}

/** 是否帆软 FineBI 数据平台（真实站点） */
function isFinebiPlatform(page) {
  const urls = [page.url()];
  try {
    for (const frame of page.frames()) urls.push(frame.url());
  } catch {
    /* ignore */
  }
  return urls.some((url) => /bi\.giikin\.com|\/webroot\/decision/i.test(url || ''));
}

/**
 * 通用页面：左侧展开【平台业务】→ 点击【平台经营分析】→ 等报表就绪。
 * （真实 FineBI 走 runFinebiFlow 专用分支；本函数用于本地 mock/兼容旧站点）
 */
async function enterReportMenu(page, ctx) {
  /* 1) 左侧展开【平台业务】：子项已可见则不重复点击，避免把它收起 */
  if (!(await isTextVisible(page, SEL.reportPageTexts, 3000))) {
    ctx.setProgress('展开左侧【平台业务】');
    await clickText(page, SEL.platformGroupTexts, { what: '左侧【平台业务】菜单' });
  }

  /* 2) 点击【平台经营分析】 */
  ctx.setProgress('打开【平台经营分析】');
  await clickText(page, SEL.reportPageTexts, { what: '【平台经营分析】菜单' });

  /* 3) 等报表页就绪：出现【查询】按钮 / 表格 / 维度筛选区任一即视为已进入 */
  const ready = await raceVisible(
    pageScopes(page).flatMap((scope) => [
      ...textLocators(scope, SEL.queryTexts),
      ...SEL.tableHeaders.map((sel) => scope.locator(sel)),
      ...textLocators(scope, [SEL.siteNameHeader]),
      ...textLocators(scope, SEL.dimensionGroupLabels),
    ]),
    CONFIG.navTimeoutMs
  );
  if (!ready) throw new Error('【平台经营分析】页面加载超时：未找到查询按钮或报表表格');
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  ctx.log('已进入【平台经营分析】报表页');
  return page;
}

/**
 * 点【大数据】并接管新标签页（真实站点 window.open 到 FineBI）。
 * 兼容两类环境：
 *   - 新标签页：等 popup 事件，接管新 page；
 *   - 页内路由：等左侧菜单出现，继续用当前 page。
 */
async function openBigData(page) {
  // 新标签页监听要在点击前挂上
  const popupPromise = page
    .waitForEvent('popup', { timeout: 15000 })
    .then((popup) => (popup ? { page: popup } : null))
    .catch(() => null);

  let clicked = false;

  // 优先直接点（部分环境【大数据】是常显入口）
  const direct = await raceText(page, SEL.bigDataTexts, 4000);
  if (direct) {
    await direct.click({ timeout: 15000 });
    clicked = true;
  }

  // 真实站点：hover 右上角工具区后，菜单里才出现【大数据】
  if (!clicked) {
    for (const hoverSelector of SEL.bigDataHover) {
      const el = page.locator(hoverSelector).first();
      if (await el.count().catch(() => 0)) {
        await el.hover({ timeout: 5000 }).catch(() => {});
      }
    }
    const afterHover = await raceText(page, SEL.bigDataTexts, 6000);
    if (afterHover) {
      await afterHover.click({ timeout: 15000 });
      clicked = true;
    }
  }
  if (!clicked) throw new Error('未找到右上角【大数据】入口');

  // 新标签页 或 页内菜单，谁先就绪用谁
  const inPageMenu = raceText(page, ['平台业务', '平台经营分析'], 15000).then((loc) =>
    loc ? { page } : null
  );
  const opened = await firstOf(
    [popupPromise, inPageMenu],
    15000,
    '点击【大数据】后未进入数据平台（既没有新标签页，也没有左侧菜单）'
  );

  const target = opened.page || page;
  if (target !== page) {
    attachPageDefaults(target);
    await target.waitForLoadState('domcontentloaded', { timeout: CONFIG.navTimeoutMs }).catch(() => {});
  }
  await target.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  return target;
}

/** 新标签页统一超时与异常日志 */
function attachPageDefaults(target) {
  target.setDefaultTimeout(CONFIG.navTimeoutMs);
  target.setDefaultNavigationTimeout(CONFIG.navTimeoutMs);
  target.on('pageerror', (err) => console.warn(`[crawler] 新标签页脚本异常：${err.message}`));
}

/* ================================================================== */
/* 3.2.3 帆软 FineBI 专用流程（真实站点）                                */
/* ================================================================== */
/*
 * 真实报表页结构（已真机验证）：
 *  - 报表在 iframe.bi-iframe（URL 含 /v10/entry/access/）里；
 *  - 左侧目录树在主文档：div.dec-frame-icon-text-node（平台业务/运营及业绩分析）、
 *    div.dec-frame-icon-text-item（平台经营分析）；
 *  - 筛选控件：.report-main-parameter-container-controller-*，弹层 .bi-popup-view，
 *    多选行 .bi-multi-select-item，树形 zTree（li[treenode]）；确认按钮「确定」；
 *  - 表头是首行 td（id 形如 B1-0-<tableId>，站点名称列 L1-…），数据行 td id 形如 L2-0-<tableId>；
 *  - 查询 #fr-btn-SEARCH，原样导出 #fr-btn-ExcelO；
 *  - 站点名称单元格内 span.linkspan 点击后弹 FineUI 菜单，菜单项「订单明细（下载）」触发下载。
 */

const FINEBI_DETAIL_TIMEOUT_MS = Math.min(CONFIG.navTimeoutMs, 30000);

/** 等报表 iframe（#fr-btn-SEARCH 出现） */
async function waitFinebiReportFrame(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      for (const frame of page.frames()) {
        if (!/\/v10\/entry\/access\//.test(frame.url())) continue;
        if (await frame.locator('#fr-btn-SEARCH').first().count().catch(() => 0)) {
          await frame.waitForSelector('#fr-btn-SEARCH', { timeout: 10000 }).catch(() => {});
          return frame;
        }
      }
    } catch {
      /* 页面可能正在导航 */
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

/** 进入 FineBI 报表页：目录树 平台业务 → 运营及业绩分析 → 平台经营分析 */
async function openFinebiReport(page, ctx) {
  // 关掉可能存在的门户引导弹窗
  for (const text of ['我知道了', '不再提醒']) {
    const tip = page.getByText(text, { exact: true }).first();
    if (await tip.count().catch(() => 0)) {
      await tip.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  const node = (text) => page.locator('div.dec-frame-icon-text-node').filter({ hasText: text }).first();
  const item = (text) => page.locator('div.dec-frame-icon-text-item').filter({ hasText: text }).first();

  let frame = await waitFinebiReportFrame(page, 3000);
  if (frame) return frame;

  for (const folder of ['平台业务', '运营及业绩分析']) {
    if (await item('平台经营分析').isVisible().catch(() => false)) break;
    if (await node(folder).count().catch(() => 0)) {
      ctx.setProgress(`展开左侧目录：${folder}`);
      await node(folder).click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(900);
    }
  }

  if (await item('平台经营分析').isVisible().catch(() => false)) {
    ctx.setProgress('打开【平台经营分析】');
    await item('平台经营分析').click({ timeout: 15000 }).catch(() => {});
  } else {
    throw new Error('未在左侧目录找到【平台经营分析】（平台业务 → 运营及业绩分析）');
  }

  frame = await waitFinebiReportFrame(page, CONFIG.navTimeoutMs);
  if (!frame) throw new Error('【平台经营分析】报表加载超时（未找到查询按钮 #fr-btn-SEARCH）');
  return frame;
}

/** 报表筛选控件定位器 */
function finebiWidgetLocator(frame) {
  return frame.locator(
    '.report-main-parameter-container-controller-tag-combo-checkbox, ' +
      '.report-main-parameter-container-controller-tree-combo-box, ' +
      '.report-main-parameter-container-controller-combo'
  );
}

/** 按业务含义查找筛选控件：platform / route / master / dimension / metric（expected 为期望值，参数化匹配） */
async function findFinebiWidget(frame, kind, expected = []) {
  const values = (expected || []).map((v) => String(v).toLowerCase());
  const hitValue = (text) => values.some((v) => v && String(text).toLowerCase().includes(v));
  const loc = finebiWidgetLocator(frame);
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const widget = loc.nth(i);
    if (!(await widget.isVisible().catch(() => false))) continue;
    const text = ((await widget.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const cls = (await widget.getAttribute('class').catch(() => '')) || '';
    if (kind === 'platform' && (text === '平台' || hitValue(text))) return { index: i, text, cls, widget };
    if (kind === 'route' && (text === '线路' || hitValue(text))) return { index: i, text, cls, widget };
    if (kind === 'master' && cls.includes('tree-combo-box') && (text === '站长' || hitValue(text))) {
      return { index: i, text, cls, widget };
    }
    if (kind === 'dimension' && text.includes('站点负责人') && text.includes('站点名称')) {
      return { index: i, text, cls, widget };
    }
    if (kind === 'metric' && cls.includes('tree-combo-box') && text.includes('已选择')) {
      return { index: i, text, cls, widget };
    }
  }
  return null;
}

/** 等弹层内容加载完成（FineBI 弹层先出空壳再异步渲染选项） */
async function waitFinebiPopupContent(frame, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let popup = frame.locator('.bi-popup-view').filter({ visible: true }).last();
  while (Date.now() < deadline) {
    if (await popup.count().catch(() => 0)) {
      const items = await popup
        .locator('.bi-multi-select-item, .bi-single-select-item, li[treenode]')
        .count()
        .catch(() => 0);
      if (items > 0) return popup;
    }
    await frame.page().waitForTimeout(300);
    popup = frame.locator('.bi-popup-view').filter({ visible: true }).last();
  }
  return popup;
}

/** 等「内容里包含指定文本」的弹层（避免误用残留弹层/错误弹层） */
async function waitFinebiPopupByText(frame, requiredTexts, timeoutMs = 12000, requireAll = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const popups = frame.locator('.bi-popup-view').filter({ visible: true });
    const count = await popups.count().catch(() => 0);
    // 后出现的弹层一般层级更高，从后往前找
    for (let i = count - 1; i >= 0; i -= 1) {
      const popup = popups.nth(i);
      const info = await popup
        .evaluate((el) => ({
          text: (el.innerText || '').replace(/\s+/g, ' '),
          options: [...el.querySelectorAll('.bi-multi-select-item, .bi-single-select-item')].map((x) =>
            (x.innerText || '').replace(/\s+/g, ' ').trim()
          ),
        }))
        .catch(() => null);
      if (!info) continue;
      const hit = (t) => info.options.includes(t) || info.text.includes(t);
      if (requireAll ? requiredTexts.every(hit) : requiredTexts.some(hit)) return popup;
    }
    await frame.page().waitForTimeout(300);
  }
  return null;
}

/**
 * 打开筛选控件并返回「内容正确的弹层」；被残留弹层遮挡时自动重试。
 * requiredTexts：该弹层里应出现的选项文本（用于识别弹层是否真的打开/加载完）
 */
async function finebiOpenFilterPopup(frame, widget, requiredTexts, retries = 3, requireAll = false) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    await closeFinebiPopups(frame);
    await widget.scrollIntoViewIfNeeded().catch(() => {});
    await widget.click({ timeout: 10000 }).catch(() => {});
    const popup = await waitFinebiPopupByText(frame, requiredTexts, 10000, requireAll);
    if (popup) return popup;
  }
  throw new Error(`筛选弹层打开失败（未找到选项：${requiredTexts.join(' / ')}）`);
}

/** 打开筛选控件弹层（通用兜底） */
async function openFinebiWidget(frame, found) {
  await closeFinebiPopups(frame);
  await found.widget.scrollIntoViewIfNeeded().catch(() => {});
  await found.widget.click({ timeout: 10000 });
  await frame.page().waitForTimeout(500);
  await frame
    .locator('.bi-popup-view')
    .filter({ visible: true })
    .last()
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => {});
  return waitFinebiPopupContent(frame, 8000);
}

/** 在弹层内部滚动一屏（FineBI 多选/树弹层是虚拟滚动，目标项可能还没渲染） */
async function finebiScrollPopup(popup, delta) {
  return popup
    .evaluate((el, step) => {
      const nodes = [el, ...el.querySelectorAll('div')].filter(
        (n) => n.scrollHeight > n.clientHeight + 5
      );
      const box = nodes[nodes.length - 1] || el;
      const before = box.scrollTop;
      box.scrollTop = Math.min(box.scrollHeight, box.scrollTop + step);
      return box.scrollTop !== before;
    }, delta)
    .catch(() => false);
}

/** 打开筛选控件弹层前，先关掉可能残留的弹层，避免点击被遮挡 */
async function closeFinebiPopups(frame) {
  for (let i = 0; i < 3; i += 1) {
    const open = await frame.locator('.bi-popup-view').filter({ visible: true }).count().catch(() => 0);
    if (!open) return;
    await frame.page().keyboard.press('Escape').catch(() => {});
    await frame.page().waitForTimeout(200);
    const stillOpen = await frame.locator('.bi-popup-view').filter({ visible: true }).count().catch(() => 0);
    if (!stillOpen) return;
    // 点报表空白区域（不要点左上角工具栏，避免误触“原样导出”）
    await frame.locator('body').click({ position: { x: 700, y: 820 }, timeout: 1500 }).catch(() => {});
    await frame.page().waitForTimeout(150);
  }
}

/** 读取某个选项当前是否已选中 */
async function finebiOptionSelected(popup, text) {
  return popup
    .evaluate((el, target) => {
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const item = [...el.querySelectorAll('.bi-multi-select-item, .bi-single-select-item')].find(
        (x) => norm(x.innerText) === target
      );
      if (!item) return false;
      return !!item.querySelector('.checkbox-content.bi-high-light-background, .bi-checkbox.active');
    }, text)
    .catch(() => false);
}

/** 轮询等选中态变化 */
async function finebiWaitOptionSelected(frame, popup, text, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await finebiOptionSelected(popup, text)) return true;
    await frame.page().waitForTimeout(150);
  }
  return false;
}

/**
 * 点选一个选项：优先**真实鼠标**点选项中心（最接近人工操作），
 * 不行再用 DOM click（checkbox/文字/整行）+ 键盘 Space；每一步都校验选中态。
 * 所有 locator 操作都带短超时，绝不允许无限等待。
 */
async function finebiClickVisibleOption(frame, popup, text) {
  if (await finebiOptionSelected(popup, text)) return true;

  const index = await popup
    .evaluate((el, target) => {
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      return [...el.querySelectorAll('.bi-multi-select-item, .bi-single-select-item')].findIndex(
        (x) => norm(x.innerText) === target
      );
    }, text)
    .catch(() => -1);
  if (index < 0) return false;

  const item = popup.locator('.bi-multi-select-item, .bi-single-select-item').nth(index);
  // 选项可能在长列表可视区之外：先滚到可见，否则鼠标坐标会点到别处
  await item.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});

  // 1) 真实鼠标点击选项中心
  const box = await item.boundingBox({ timeout: 3000 }).catch(() => null);
  if (box) {
    await frame.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    if (await finebiWaitOptionSelected(frame, popup, text, 2500)) return true;
  }

  // 2) DOM click 各候选节点
  for (const selector of ['.bi-checkbox', '.list-item-text', '.checkbox-content', '']) {
    const clicked = await popup
      .evaluate(
        (el, { target, selector }) => {
          const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
          const node = [...el.querySelectorAll('.bi-multi-select-item, .bi-single-select-item')].find(
            (x) => norm(x.innerText) === target
          );
          if (!node) return false;
          const targetNode = selector ? node.querySelector(selector) : node;
          if (!targetNode) return false;
          targetNode.click();
          return true;
        },
        { target: text, selector }
      )
      .catch(() => false);
    if (!clicked) continue;
    if (await finebiWaitOptionSelected(frame, popup, text, 1200)) return true;
  }

  // 3) 键盘兜底：聚焦选项后按 Space/Enter
  await item.focus({ timeout: 2000 }).catch(() => {});
  await frame.page().keyboard.press('Space').catch(() => {});
  if (await finebiWaitOptionSelected(frame, popup, text, 1200)) return true;
  await frame.page().keyboard.press('Enter').catch(() => {});
  return finebiWaitOptionSelected(frame, popup, text, 1200);
}

/** 在当前可见弹层里按文本点选一项（选项已渲染则原地点击，不滚动；每一步都有硬超时） */
async function finebiSelectOption(frame, text, popupArg = null) {
  let popup = popupArg || (await waitFinebiPopupContent(frame, 8000));
  await popup
    .evaluate((el) => {
      for (const n of [el, ...el.querySelectorAll('div')]) {
        if (n.scrollHeight > n.clientHeight + 5) n.scrollTop = 0;
      }
    })
    .catch(() => {});

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const alive = await popup.count().catch(() => 0);
    if (!alive) return false;

    const index = await withTimeout(
      popup.evaluate((el, target) => {
        const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        return [...el.querySelectorAll('.bi-multi-select-item, .bi-single-select-item')].findIndex(
          (x) => norm(x.innerText) === target
        );
      }, text),
      3000,
      '读取选项超时'
    ).catch(() => -1);

    if (index >= 0) {
      // 选项已渲染：原地尝试点选（带硬超时），不要再滚动
      const ok = await withTimeout(
        finebiClickVisibleOption(frame, popup, text),
        12000,
        '选项点击超时'
      ).catch(() => false);
      if (ok) return true;
      await frame.page().waitForTimeout(400);
      continue;
    }

    const scrolled = await withTimeout(finebiScrollPopup(popup, 160), 3000, '弹层滚动超时').catch(
      () => false
    );
    await frame.page().waitForTimeout(scrolled ? 200 : 400);
  }
  return false;
}

/**
 * 点击弹层「确定」并确认弹层关闭。
 * 全选/勾选后弹层会重渲染，旧定位器可能失效，所以这里每次重新找按钮，并有 DOM/鼠标兜底。
 */
async function finebiConfirmPopup(frame, popupArg = null) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visiblePopups = frame.locator('.bi-popup-view').filter({ visible: true });
    if ((await visiblePopups.count().catch(() => 0)) === 0) return true;

    let clicked = false;

    // 1) 最新可见弹层里的「确定」
    const freshPopup = visiblePopups.last();
    const freshBtn = freshPopup.locator('.bi-basic-button').filter({ hasText: '确定' }).last();
    if (await freshBtn.count().catch(() => 0)) {
      await freshBtn.click({ timeout: 5000 }).catch(() => {});
      clicked = true;
    }

    // 2) 传入的弹层里再找一次
    if (!clicked && popupArg) {
      const btn = popupArg.locator('.bi-basic-button').filter({ hasText: '确定' }).last();
      if (await btn.count().catch(() => 0)) {
        await btn.click({ timeout: 5000 }).catch(() => {});
        clicked = true;
      }
    }

    // 3) DOM 兜底：所有可见弹层里找文本 = 确定 的节点直接 click
    if (!clicked) {
      clicked = await frame
        .evaluate(() => {
          const vis = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1;
          };
          const popups = [...document.querySelectorAll('.bi-popup-view')].filter(vis).reverse();
          for (const popup of popups) {
            const nodes = [...popup.querySelectorAll('.bi-basic-button, .bi-multi-select-bar, button, div, span')];
            const btn = nodes.find((n) => (n.innerText || '').replace(/\s+/g, ' ').trim() === '确定');
            if (btn) {
              btn.click();
              return true;
            }
          }
          return false;
        })
        .catch(() => false);
    }

    // 4) 坐标兜底：真实鼠标点「确定」按钮中心
    if (!clicked) {
      const btnBox = await freshBtn.boundingBox({ timeout: 2000 }).catch(() => null);
      if (btnBox) {
        await frame.page().mouse.click(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2).catch(() => {});
        clicked = true;
      }
    }

    await frame.page().waitForTimeout(500);

    // 验证弹层是否真的关闭
    const stillOpen = await frame.locator('.bi-popup-view').filter({ visible: true }).count().catch(() => 0);
    if (stillOpen === 0) return true;

    // 还没关：先按 Esc，再进行下一轮
    await frame.page().keyboard.press('Escape').catch(() => {});
    await frame.page().waitForTimeout(250);
  }

  const stillOpen = await frame.locator('.bi-popup-view').filter({ visible: true }).count().catch(() => 0);
  return stillOpen === 0;
}

/** 在弹层内点击某个 zTree 节点的展开箭头（按节点文本，兼容不同 switch class） */
async function finebiExpandTreeNode(frame, popup, nodeText) {
  const clicked = await popup
    .evaluate((el, text) => {
      const lis = [...el.querySelectorAll('li[treenode]')];
      const li = lis.find((x) => (x.innerText || '').replace(/\s+/g, ' ').trim() === text);
      if (!li) return false;
      const sw = li.querySelector('span.switch, span[treenode_switch]');
      if (!sw) return false;
      sw.click();
      return true;
    }, nodeText)
    .catch(() => false);
  if (clicked) await frame.page().waitForTimeout(900);
  return clicked;
}

/** 把弹层滚动到底部（展开的树/虚拟列表需要滚动才会渲染子节点） */
async function finebiScrollPopupToBottom(frame, popup) {
  await popup
    .evaluate((el) => {
      const nodes = [el, ...el.querySelectorAll('div')].filter((n) => n.scrollHeight > n.clientHeight + 5);
      for (const n of nodes) n.scrollTop = n.scrollHeight;
    })
    .catch(() => {});
  await frame.page().waitForTimeout(500);
}

/**
 * zTree 弹层勾选（用于站长树）：先定向展开父节点（如团队「Shopee」），
 * 再逐屏查找并勾选目标；用 DOM click 避免 Playwright 逐个等待 actionability。
 */
async function finebiCheckTree(frame, targets, parents = [], popupArg = null) {
  const popup = popupArg || frame.locator('.bi-popup-view').filter({ visible: true }).last();
  const wanted = new Set(targets);
  const checked = new Set();

  for (const parent of parents) await finebiExpandTreeNode(frame, popup, parent);

  for (let round = 0; round < 12 && wanted.size; round++) {
    const hits = await popup
      .evaluate((el, targets) => {
        const want = new Set(targets);
        const out = [];
        for (const li of el.querySelectorAll('li[treenode]')) {
          const text = (li.innerText || '').replace(/\s+/g, ' ').trim();
          if (!want.has(text)) continue;
          const chk = li.querySelector('span.chk, span[treenode_check]');
          if (chk && !String(chk.className || '').includes('checkbox_true')) chk.click();
          out.push(text);
        }
        return out;
      }, [...wanted])
      .catch(() => []);
    for (const text of hits) {
      checked.add(text);
      wanted.delete(text);
    }
    if (!wanted.size) break;

    // 展开当前可见的折叠节点（快速 DOM click）
    await popup
      .evaluate((el) => {
        for (const sw of el.querySelectorAll('li[treenode] span.switch.center_close')) sw.click();
      })
      .catch(() => {});
    await frame.page().waitForTimeout(350);

    const scrolled = await finebiScrollPopup(popup, 180);
    if (!scrolled) {
      // 再给一次机会：滚到底并重试
      await finebiScrollPopupToBottom(frame, popup);
      const retry = await popup
        .evaluate((el, targets) => {
          const want = new Set(targets);
          const out = [];
          for (const li of el.querySelectorAll('li[treenode]')) {
            const text = (li.innerText || '').replace(/\s+/g, ' ').trim();
            if (!want.has(text)) continue;
            const chk = li.querySelector('span.chk, span[treenode_check]');
            if (chk && !String(chk.className || '').includes('checkbox_true')) chk.click();
            out.push(text);
          }
          return out;
        }, [...wanted])
        .catch(() => []);
      for (const text of retry) {
        checked.add(text);
        wanted.delete(text);
      }
      break;
    }
    await frame.page().waitForTimeout(200);
  }
  return checked;
}

/**
 * 勾选「指标（利润分组）」下的具体指标：
 * 展开「利润」分组 → 勾选 毛利润/运营成本/净利润/净利率；找不到具体节点时退回勾选「利润」分组。
 */
async function selectFinebiMetrics(frame, metrics, popupArg = null) {
  const popup = popupArg || frame.locator('.bi-popup-view').filter({ visible: true }).last();

  // 1) 展开「利润」分组
  await finebiExpandTreeNode(frame, popup, '利润');
  await finebiScrollPopupToBottom(frame, popup);

  // 2) 勾选 4 个具体指标（节点名精确匹配）
  const wanted = new Set(metrics.map((m) => String(m).replace(/\s+/g, '')));
  const checked = new Set();
  for (let round = 0; round < 10 && wanted.size; round++) {
    const done = await popup
      .evaluate((el, targets) => {
        const want = new Set(targets);
        const hit = [];
        for (const li of el.querySelectorAll('li[treenode]')) {
          const text = (li.innerText || '').replace(/\s+/g, ' ').trim();
          if (!want.has(text)) continue;
          const chk = li.querySelector('span.chk, span[treenode_check]');
          if (!chk) continue;
          const cls = String(chk.className || '');
          if (!cls.includes('checkbox_true')) chk.click();
          hit.push(text);
        }
        return hit;
      }, [...wanted])
      .catch(() => []);
    for (const text of done) {
      checked.add(text);
      wanted.delete(text);
    }
    if (!wanted.size) break;
    const scrolled = await finebiScrollPopup(popup, 180);
    if (!scrolled) {
      await frame.page().waitForTimeout(400);
      const again = await popup
        .evaluate((el, targets) => {
          const want = new Set(targets);
          const hit = [];
          for (const li of el.querySelectorAll('li[treenode]')) {
            const text = (li.innerText || '').replace(/\s+/g, ' ').trim();
            if (!want.has(text)) continue;
            const chk = li.querySelector('span.chk, span[treenode_check]');
            if (chk && !String(chk.className || '').includes('checkbox_true')) chk.click();
            hit.push(text);
          }
          return hit;
        }, [...wanted])
        .catch(() => []);
      for (const text of again) {
        checked.add(text);
        wanted.delete(text);
      }
      if (!wanted.size) break;
      break;
    }
    await frame.page().waitForTimeout(250);
  }

  // 3) 兜底：具体指标节点未找到时，勾选「利润」分组本身
  if (checked.size === 0) {
    const group = await popup
      .evaluate((el) => {
        for (const li of el.querySelectorAll('li[treenode]')) {
          if ((li.innerText || '').replace(/\s+/g, ' ').trim() !== '利润') continue;
          const chk = li.querySelector('span.chk, span[treenode_check]');
          if (chk && !String(chk.className || '').includes('checkbox_true')) chk.click();
          return '利润';
        }
        return null;
      })
      .catch(() => null);
    if (group) checked.add('利润');
  }

  return checked;
}

/** 设置 FineBI 筛选条件（平台/线路/站长/维度/指标） */
async function applyFinebiFilters(frame, ctx, filters) {
  /* ---- 1) 维度选择：放在最前面做（此时刚打开报表，没有残留弹层，最稳定） ---- */
  const dimension = await findFinebiWidget(frame, 'dimension');
  if (!dimension) throw new Error('未找到【维度选择】筛选控件');

  const readDimensionText = async () => {
    const current = (await findFinebiWidget(frame, 'dimension')) || dimension;
    return ((await current.widget.innerText({ timeout: 5000 }).catch(() => '')) || '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /** 执行一次维度勾选并返回成功选中的维度名 */
  const applyDimensions = async (names) => {
    const current = (await findFinebiWidget(frame, 'dimension')) || dimension;
    // 维度弹层必须同时包含 经营类目/店铺名/线路 三个选项，避免误识别成其它弹层
    const popup = await finebiOpenFilterPopup(frame, current.widget, ['经营类目', '店铺名', '线路'], 3, true);
    const selected = [];
    for (const name of names) {
      let ok = false;
      try {
        ok = await finebiSelectOption(frame, name, popup);
      } catch (err) {
        ctx.log(`⚠️ 维度「${name}」点选异常：${sanitizeError(err, 100)}`);
      }
      if (ok) selected.push(name);
      else ctx.log(`⚠️ 维度弹层中未选中「${name}」`);
    }
    await finebiConfirmPopup(frame, popup);
    return selected;
  };

  /** 维度勾选带硬超时，绝不无限等待 */
  const applyDimensionsSafely = async (names) => {
    try {
      return await withTimeout(applyDimensions(names), 50000, '维度勾选超时');
    } catch (err) {
      ctx.log(`⚠️ 维度勾选异常：${sanitizeError(err, 120)}`);
      await safeEscape(frame.page());
      return [];
    }
  };

  let afterDimensionText = await readDimensionText();
  let needDimensions = filters.dimensions.filter((name) => !afterDimensionText.includes(name));
  if (needDimensions.length) {
    ctx.setProgress(`勾选维度：${needDimensions.join('、')}`);

    /** 维度【全选】兜底（维度会变多，可能把指标列挤出原样导出范围，仅在精勾失败时用） */
    const selectAllDimensions = async () => {
      const current = (await findFinebiWidget(frame, 'dimension')) || dimension;
      const popup = await finebiOpenFilterPopup(
        frame,
        current.widget,
        ['经营类目', '店铺名', '线路'],
        3,
        true
      );
      await withTimeout(
        (async () => {
          const btn = popup
            .locator('.bi-basic-button, .bi-multi-select-bar')
            .filter({ hasText: '全选' })
            .first();
          if (await btn.count().catch(() => 0)) {
            await btn.click({ timeout: 5000 }).catch(() => {});
          }
          await popup
            .evaluate((el) => {
              const node = [
                ...el.querySelectorAll('.bi-basic-button, .bi-multi-select-bar, div, span'),
              ].find((n) => (n.innerText || '').replace(/\s+/g, ' ').trim() === '全选');
              if (node) node.click();
            })
            .catch(() => {});
        })(),
        8000,
        '维度全选超时'
      ).catch((err) => ctx.log(`⚠️ 点击【全选】异常：${sanitizeError(err, 100)}`));
      await finebiConfirmPopup(frame);
      return true;
    };

    // 方案 A（优先）：精确勾选。保留 站点名称 等已有维度，避免维度过多导致原样导出丢指标列
    let selected = await applyDimensionsSafely(needDimensions);
    ctx.log(`维度精确勾选结果：${selected.join('、') || '无'}（目标：${needDimensions.join('、')}）`);
    afterDimensionText = await readDimensionText();
    let stillMissing = filters.dimensions.filter((name) => !afterDimensionText.includes(name));

    if (stillMissing.length) {
      ctx.log(`维度首次未完全生效（${afterDimensionText}），重试一次`);
      await closeFinebiPopups(frame);
      selected = await applyDimensionsSafely(stillMissing);
      ctx.log(`维度重试结果：${selected.join('、') || '无'}`);
      afterDimensionText = await readDimensionText();
      stillMissing = filters.dimensions.filter((name) => !afterDimensionText.includes(name));
    }

    let dimOk = stillMissing.length === 0;
    if (dimOk) {
      ctx.log(`维度精勾完成（当前：${afterDimensionText}）`);
    } else {
      // 方案 B：全选兜底（保证能跑通；但维度较多时原样导出可能不含全部指标列）
      ctx.log('维度精确勾选仍失败，改用【全选】兜底');
      try {
        await selectAllDimensions();
        afterDimensionText = await readDimensionText();
        stillMissing = filters.dimensions.filter((name) => !afterDimensionText.includes(name));
        dimOk = stillMissing.length === 0;
        if (dimOk) ctx.log(`维度全选兜底完成（当前：${afterDimensionText}）`);
      } catch (err) {
        ctx.log(`⚠️ 维度全选兜底失败：${sanitizeError(err, 120)}`);
      }
    }

    if (!dimOk) {
      // 失败现场留证：维度弹层 DOM + 截图，便于继续校准
      try {
        const popup = await waitFinebiPopupByText(frame, ['经营类目', '店铺名', '线路'], 2000, true);
        if (popup) {
          const html = await popup.evaluate((el) => el.outerHTML).catch(() => '');
          if (html) await fs.writeFile(path.join(ctx.dir, 'dimension-popup.html'), html).catch(() => {});
        }
        await dumpDebugScreenshot(frame.page(), ctx.dir, 'dimension-fail');
      } catch {
        /* 诊断失败不影响主错误 */
      }
      throw new Error(`维度勾选失败：${stillMissing.join('、')}（当前已选：${afterDimensionText}）`);
    }
  }

  /* ---- 2) 平台（参数化） ---- */
  const platformTarget = (filters.platform && filters.platform[0]) || 'shopee';
  const platform = await findFinebiWidget(frame, 'platform', filters.platform);
  if (!platform) throw new Error('未找到【平台】筛选控件');
  if (!platform.text.toLowerCase().includes(platformTarget.toLowerCase())) {
    ctx.setProgress(`设置筛选条件：平台 = ${platformTarget}`);
    await withTimeout(
      (async () => {
        const popup = await finebiOpenFilterPopup(frame, platform.widget, [platformTarget], 3);
        await finebiSelectOption(frame, platformTarget, popup);
        await finebiConfirmPopup(frame, popup);
      })(),
      40000,
      '平台筛选超时'
    ).catch((err) => ctx.log(`⚠️ 平台筛选异常：${sanitizeError(err, 120)}`));
    // 以控件回显为准（部分控件点选后弹层会立即关闭，不能只看弹层内状态）
    const after = await findFinebiWidget(frame, 'platform', filters.platform);
    if (!(after && after.text.toLowerCase().includes(platformTarget.toLowerCase()))) {
      await dumpDebugScreenshot(frame.page(), ctx.dir, 'platform-fail');
      throw new Error(`平台 = ${platformTarget} 设置失败`);
    }
  }

  /* ---- 3) 线路（参数化） ---- */
  const routeTarget = (filters.line && filters.line[0]) || '新加坡';
  const route = await findFinebiWidget(frame, 'route', filters.line);
  if (!route) throw new Error('未找到【线路】筛选控件');
  if (!route.text.includes(routeTarget)) {
    ctx.setProgress(`设置筛选条件：线路 = ${routeTarget}`);
    await withTimeout(
      (async () => {
        const popup = await finebiOpenFilterPopup(frame, route.widget, [routeTarget], 3);
        await finebiSelectOption(frame, routeTarget, popup);
        await finebiConfirmPopup(frame, popup);
      })(),
      40000,
      '线路筛选超时'
    ).catch((err) => ctx.log(`⚠️ 线路筛选异常：${sanitizeError(err, 120)}`));
    const after = await findFinebiWidget(frame, 'route', filters.line);
    if (!(after && after.text.includes(routeTarget))) throw new Error(`线路 = ${routeTarget} 设置失败`);
  }

  /* ---- 4) 站长（参数化；树形多选：团队 → 站点负责人） ---- */
  const masterTarget = (filters.station && filters.station[0]) || '丁月';
  const master = await findFinebiWidget(frame, 'master', filters.station);
  if (!master) throw new Error('未找到【站长】筛选控件');
  if (!master.text.includes(masterTarget)) {
    ctx.setProgress(`设置筛选条件：站长 = ${masterTarget}`);
    await withTimeout(
      (async () => {
        const popup = await finebiOpenFilterPopup(frame, master.widget, ['Shopee', masterTarget], 3);
        await finebiCheckTree(frame, [masterTarget], ['Shopee'], popup);
        await finebiConfirmPopup(frame, popup);
      })(),
      45000,
      '站长筛选超时'
    ).catch((err) => ctx.log(`⚠️ 站长筛选异常：${sanitizeError(err, 120)}`));
    const after = await findFinebiWidget(frame, 'master', filters.station);
    if (!(after && after.text.includes(masterTarget))) throw new Error(`站长 = ${masterTarget} 设置失败`);
  }

  /* ---- 5) 指标（利润分组）：毛利润/运营成本/净利润/净利率 ---- */
  const metric = await findFinebiWidget(frame, 'metric');
  if (metric) {
    try {
      ctx.setProgress('勾选指标（利润分组）：毛利润/运营成本/净利润/净利率');
      const got = await withTimeout(
        (async () => {
          const popup = await finebiOpenFilterPopup(frame, metric.widget, ['利润', '采购'], 3);
          const checked = await selectFinebiMetrics(frame, filters.metrics, popup);
          await finebiConfirmPopup(frame, popup);
          return checked;
        })(),
        45000,
        '指标勾选超时'
      );
      ctx.log(`已勾选指标节点：${[...got].join('、') || '（未找到具体节点）'}`);
    } catch (err) {
      // 指标面板结构变化时不直接失败：查询后用表头严格校验指标列
      ctx.log(`⚠️ 指标勾选步骤异常（稍后用表头校验）：${sanitizeError(err, 120)}`);
      await safeEscape(frame.page());
    }
  } else {
    ctx.log('⚠️ 未找到【指标选择】控件，稍后用表头校验指标列');
  }
}

/** 点击【查询】并等待数据行渲染 */
async function finebiQuery(frame) {
  const searchBtn = frame.locator('#fr-btn-SEARCH').first();
  await searchBtn.scrollIntoViewIfNeeded().catch(() => {});
  await searchBtn.click({ timeout: CONFIG.navTimeoutMs });

  const deadline = Date.now() + CONFIG.navTimeoutMs;
  while (Date.now() < deadline) {
    const rows = await frame.locator('td[id^="L2-"]').count().catch(() => 0);
    if (rows > 0) {
      await frame.page().waitForTimeout(800);
      return;
    }
    await frame.page().waitForTimeout(500);
  }
  throw new Error('查询超时：点击【查询】后未出现报表数据（可能条件无匹配或无权限）');
}

/**
 * 解析 FineBI 报表表格：表头行 td（B1/C1/…/L1）、站点名称列、数据行单元格。
 * 同时严格校验：筛选条件是否生效、4 个指标列是否齐、维度列是否存在。
 */
async function readFinebiTable(frame, filters) {
  const info = await frame
    .evaluate(
      ({ metrics, dimensions }) => {
        const norm = (s) => String(s || '').replace(/\s+/g, '').trim();
        const headerRow = [...document.querySelectorAll('tr')].find((tr) =>
          [...tr.querySelectorAll('td')].some((td) => norm(td.innerText) === '站点名称')
        );
        if (!headerRow) return { err: '未找到包含【站点名称】的表头行' };
        const headerCells = [...headerRow.querySelectorAll('td')].map((td) => ({
          id: td.id,
          text: norm(td.innerText),
        }));
        const siteHeader = headerCells.find((h) => h.text === '站点名称');
        const mm = siteHeader && siteHeader.id.match(/^L1-(\d+)-(\d+)$/);
        if (!mm) return { err: '【站点名称】列 id 格式异常：' + (siteHeader ? siteHeader.id : 'null'), headerCells };

        const col = mm[1];
        const tableId = mm[2];
        const cellText = new Map();
        for (const td of document.querySelectorAll('td[id]')) {
          cellText.set(td.id, norm(td.innerText));
        }
        const siteCells = [];
        const re = new RegExp('^L(\\d+)-' + col + '-' + tableId + '$');
        for (const [id, text] of cellText) {
          const m = id.match(re);
          if (!m || Number(m[1]) < 2) continue;
          const td = document.getElementById(id);
          if (!td || td.offsetParent === null) continue;
          if (!td.querySelector('span.linkspan')) continue;
          siteCells.push({ id, row: Number(m[1]), text: (td.innerText || '').replace(/\s+/g, ' ').trim() });
        }
        siteCells.sort((a, b) => a.row - b.row);

        const letterOf = (headerText) => {
          const h = headerCells.find((x) => x.text === headerText);
          if (!h) return null;
          const lm = h.id.match(/^([A-Z]+)1-/);
          return lm ? lm[1] : null;
        };
        const pick = (letter, row) => (letter ? cellText.get(`${letter}${row}-${col}-${tableId}`) || '' : '');
        const platformLetter = letterOf('平台');
        const routeLetter = letterOf('线路');
        const masterLetter = letterOf('站点负责人');
        const rows = [...new Set(siteCells.map((c) => c.row))];
        const sample = (letter) =>
          letter
            ? [...new Set(rows.map((r) => pick(letter, r)).filter((v) => v && v !== '-'))].slice(0, 10)
            : [];
        const headerTexts = headerCells.map((h) => h.text);
        return {
          headerTexts,
          siteCells,
          siteCount: siteCells.length,
          headerLetter: { site: 'L', platform: platformLetter, route: routeLetter, master: masterLetter },
          values: {
            platform: sample(platformLetter),
            route: sample(routeLetter),
            master: sample(masterLetter),
          },
          needMetrics: metrics.map(norm),
          needDimensions: dimensions.map(norm),
        };
      },
      { metrics: filters.metrics, dimensions: filters.dimensions }
    )
    .catch((err) => ({ err: String(err) }));

  if (info.err) throw new Error(info.err);
  if (!info.siteCells.length) throw new Error('查询结果为空：未找到【站点名称】数据行');

  /* 校验筛选生效 */
  const joined = (arr) => (arr || []).join('|').toLowerCase();
  const joinedValues = (arr) => (arr || []).join('|').toLowerCase();
  const matchesAny = (arr, expected) =>
    expected.some((value) => joinedValues(arr).includes(String(value).toLowerCase()));
  const platformOk = matchesAny(info.values.platform, filters.platform);
  const routeOk = matchesAny(info.values.route, filters.line);
  const masterOk = matchesAny(info.values.master, filters.station);
  if (!platformOk || !routeOk || !masterOk) {
    throw new Error(
      `筛选未生效（平台=${info.values.platform.join('/') || '-'}；线路=${info.values.route.join('/') || '-'}；` +
        `站点负责人=${info.values.master.join('/') || '-'}）`
    );
  }

  /* 校验 4 个指标列 */
  const headerJoined = (info.headerTexts || []).join('|');
  const missingMetrics = filters.metrics.filter((m) => !headerJoined.includes(String(m).replace(/\s+/g, '')));
  if (missingMetrics.length) {
    throw new Error(`指标（利润分组）未生效：报表缺少列 ${missingMetrics.join('、')}`);
  }

  /* 校验维度列 */
  const missingDimensions = filters.dimensions.filter((d) => !headerJoined.includes(String(d).replace(/\s+/g, '')));
  if (missingDimensions.length) {
    throw new Error(`维度未生效：报表缺少列 ${missingDimensions.join('、')}`);
  }

  return info;
}

/** FineBI 汇总表导出（#fr-btn-ExcelO） */
async function finebiExportMain(page, frame, ctx) {
  const exportBtn = frame.locator('#fr-btn-ExcelO').first();
  await exportBtn.waitFor({ state: 'visible', timeout: 15000 });
  await exportBtn.scrollIntoViewIfNeeded().catch(() => {});

  const downloadPromise = page.waitForEvent('download', { timeout: CONFIG.navTimeoutMs });
  downloadPromise.catch(() => {});
  await exportBtn.click({ timeout: CONFIG.navTimeoutMs });
  const download = await downloadPromise;

  const tmpFile = await withTimeout(download.path(), CONFIG.navTimeoutMs, '汇总表落盘超时');
  const fileName = safeFileName(download.suggestedFilename() || '平台经营分析.xlsx', '平台经营分析.xlsx');
  const record = await ctx.saveFile({ itemName: null, fileName, kind: 'main', sourcePath: tmpFile });
  ctx.log(`汇总表已保存：${record.fileName}`);
}

/** 点击站点名称 linkspan → 菜单【订单明细（下载）】→ 等下载 */
async function finebiDownloadDetail(page, frame, cell) {
  await safeEscape(page);
  const span = frame.locator(`td[id="${cell.id}"] span.linkspan`).first();
  if (!(await span.count().catch(() => 0))) throw new Error('站点名称单元格没有可点击的 linkspan');
  await span.scrollIntoViewIfNeeded().catch(() => {});
  await span.click({ timeout: 15000 });

  // 菜单是 FineUI 菜单：.fr-ui-core-menu .menu-item > .menu-text
  const menuItem = await raceVisible(
    pageScopes(page).flatMap((scope) => [
      scope.locator('.fr-ui-core-menu.menu .menu-item:has-text("订单明细（下载）")'),
      scope.locator('.menu-item:has-text("订单明细（下载）")'),
    ]),
    15000
  );
  if (!menuItem) throw new Error('点击站点名称后未出现【订单明细（下载）】菜单');

  const downloadPromise = page.waitForEvent('download', { timeout: FINEBI_DETAIL_TIMEOUT_MS });
  downloadPromise.catch(() => {});
  await menuItem.click({ timeout: 10000 });
  return downloadPromise;
}

/** FineBI 主流程 */
async function runFinebiFlow(page, ctx, filters) {
  /* 1) 进入报表页 */
  const frame = await openFinebiReport(page, ctx);
  // FineBI 交互中所有 locator 等待设上限，避免弹层重渲染后旧定位器卡 60s
  page.setDefaultTimeout(15000);
  ctx.log('已进入 FineBI【平台经营分析】报表页');

  /* 2) 设置筛选条件 */
  await applyFinebiFilters(frame, ctx, filters);

  /* 3) 查询并解析表格（含筛选/指标/维度校验） */
  ctx.setProgress('查询中，等待报表数据加载');
  await finebiQuery(frame);
  const table = await readFinebiTable(frame, filters);
  ctx.log(`报表共 ${table.siteCount} 个店铺行，已校验筛选与指标列`);

  /* 4) 汇总表 */
  ctx.setProgress('导出汇总表（原样导出）');
  await finebiExportMain(page, frame, ctx);
  if (!filters.includeDetails) {
    ctx.log('仅需汇总表：跳过店铺明细下载');
    return;
  }

  /* 5) 逐店铺明细：点击站点名称 → 订单明细（下载） */
  let doneCount = 0;
  for (let i = 0; i < table.siteCells.length; i++) {
    if (ctx.isAborted()) throw new Error('任务已被终止');
    const cell = table.siteCells[i];
    const itemName = cell.text || `第${i + 1}行`;
    ctx.setProgress(`导出店铺明细 ${i + 1}/${table.siteCells.length}：${itemName}`);

    try {
      const record = await withRetry(
        async () => {
          const download = await finebiDownloadDetail(page, frame, cell);
          const tmpFile = await withTimeout(
            download.path(),
            FINEBI_DETAIL_TIMEOUT_MS + 10000,
            '明细文件落盘超时'
          );
          const fileName = bindDetailFileName(itemName, download.suggestedFilename());
          return ctx.saveFile({ itemName, fileName, kind: 'detail', sourcePath: tmpFile });
        },
        {
          retries: 1,
          delayMs: 1000,
          label: `下载「${itemName}」订单明细`,
          onRetry: () => ctx.setProgress(`重试导出：「${itemName}」`),
        }
      );
      doneCount += 1;
      ctx.log(`店铺明细已保存：${record.fileName}`);
    } catch (err) {
      await safeEscape(page);
      await ctx.addMissing(itemName, `订单明细（下载）失败：${sanitizeError(err, 180)}`);
    }
  }

  ctx.log(
    `FineBI 导出完成：汇总表 1 份，店铺明细 ${doneCount}/${table.siteCells.length}` +
      (doneCount < table.siteCells.length ? `，缺失 ${table.siteCells.length - doneCount} 家` : '')
  );
}

/* ================================================================== */
/* 3.3 筛选条件                                                         */
/* ================================================================== */

async function applyFilters(page, ctx, filters) {
  /* 平台 / 线路 / 站长：单选下拉 */
  await selectSingleOption(page, ctx, ['平台', '平台：'], expandVariants(filters.platform), { what: '平台' });
  await selectSingleOption(page, ctx, ['线路', '线路：'], expandVariants(filters.line), { what: '线路' });
  await selectSingleOption(page, ctx, ['站长', '站长：'], expandVariants(filters.station), { what: '站长' });

  /* 维度多选：平台、线路、店铺名 */
  const dimension = await ensureCheckGroup(page, ctx, {
    groupLabels: SEL.dimensionGroupLabels,
    items: filters.dimensions,
    groupName: '维度',
  });

  /* 指标（利润分组）：毛利润、运营成本、净利润、净利率 */
  const metric = await ensureCheckGroup(page, ctx, {
    groupLabels: SEL.metricGroupLabels,
    items: filters.metrics,
    groupName: '指标（利润分组）',
    allowWholeGroupOption: ['利润分组', '利润指标', '利润'],
  });

  // 是否用了“整体分组”兜底：用于后续校验指标列真的出现，避免静默导出缺列数据
  return !!(dimension.usedWholeGroup || metric.usedWholeGroup);
}

/**
 * 单选下拉：按标签定位筛选项 -> 展开 -> 选中选项 -> 断言生效。
 * 已选中目标值时直接跳过；点击用 Playwright actionability 自动等待可用态，不做重复点击。
 */
async function selectSingleOption(page, ctx, labelTexts, optionTexts, { what }) {
  if (await hasSelectedValue(page, labelTexts, optionTexts)) {
    ctx.log(`筛选「${what}」已是目标值，跳过`);
    return;
  }

  const scope = await findFormItemByLabel(page, labelTexts, 8000).catch(() => null);

  // 1) 优先在筛选项容器内找下拉控件
  let trigger = null;
  if (scope) {
    trigger = await raceVisible(
      [
        scope.locator('.el-select').first(),
        scope.locator('.ant-select').first(),
        scope.locator('.bi-select').first(),
        scope.locator('[class*="combobox"]').first(),
        scope.locator('[class*="select"]').first(),
        scope.locator('.el-input__inner').first(),
        scope.locator('input').first(),
      ],
      6000
    );
  }
  // 2) 退化：按 placeholder / aria-label / 标签文本找输入框（有的站点不渲染可见 label）
  if (!trigger) {
    trigger = await raceVisible(
      pageScopes(page).flatMap((s) =>
        labelTexts.flatMap((l) => {
          const c = cssText(l.replace(/[:：]\s*$/, ''));
          return [
            s.locator(`input[placeholder*="${c}"]`).first(),
            s.locator(`input[aria-label*="${c}"]`).first(),
            s.locator(`.el-select:has(input[placeholder*="${c}"])`).first(),
            s.locator(`.el-input:has(input[placeholder*="${c}"])`).first(),
            s.locator(`[class*="select"]:has-text("${c}")`).first(),
          ];
        })
      ),
      5000
    );
  }
  if (!trigger) throw new Error(`未找到「${what}」筛选控件`);

  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await trigger.click({ timeout: 15000 });

  // 下拉选项可能挂载到 iframe 的 body 或顶层 body，跨 frame 查找
  const option = await raceVisible(optionLocatorsInPage(page, optionTexts), 10000);
  if (!option) {
    await safeEscape(page);
    throw new Error(`「${what}」下拉中没有选项：${optionTexts.join(' / ')}`);
  }
  await option.scrollIntoViewIfNeeded().catch(() => {});
  await option.click({ timeout: 10000 });

  // 断言选中值已生效（读 input.value / 筛选项文本；不重复点击，失败直接说明原因）
  if (!(await waitSelectedValue(page, labelTexts, optionTexts, 6000))) {
    throw new Error(`「${what}」筛选未生效（期望：${optionTexts.join(' / ')}）`);
  }
  ctx.log(`筛选「${what}」已选中：${optionTexts[0]}`);
}

/**
 * 多选组（维度 / 指标）：先直接勾选，失败再尝试展开下拉面板，最后允许按“整体分组”兜底。
 * 返回时若仍有未勾选项则抛错（宁可任务失败并说明原因，也不静默导出错误数据）。
 */
async function ensureCheckGroup(page, ctx, { groupLabels, items, groupName, allowWholeGroupOption = [] }) {
  const groupScope = await findFormItemByLabel(page, groupLabels, 5000).catch(() => null);

  // 1) 小组容器内直接勾选（维度/指标 checkbox 通常直接可见）
  const primaryScopes = groupScope ? [groupScope] : pageScopes(page);
  let missing = await checkItems(primaryScopes, items);
  if (!missing.length) return { usedWholeGroup: false };

  // 2) 选项可能在未展开的下拉面板里：点开小组内的选择控件后再试
  if (groupScope) {
    const trigger = await raceVisible(
      [
        groupScope.locator('.el-select').first(),
        groupScope.locator('.bi-select').first(),
        groupScope.locator('.el-input__inner').first(),
        groupScope.locator('input').first(),
        groupScope.locator('[class*="select"]').first(),
      ],
      4000
    );
    if (trigger) {
      await trigger.scrollIntoViewIfNeeded().catch(() => {});
      await trigger.click({ timeout: 15000 }).catch(() => {});
      missing = await checkItems(pageScopes(page), missing);
      if (!missing.length) return { usedWholeGroup: false };
      await safeEscape(page);
    }
  }

  // 3) 整页兜底（小组标签结构不同的站点）
  missing = await checkItems(pageScopes(page), missing);
  if (!missing.length) return { usedWholeGroup: false };

  // 4) 兜底：整体分组选项（例如「利润分组」一个选项代表 4 个指标）。
  //    调用方随后会校验表头是否真的出现这些指标列，避免静默导出缺列数据。
  if (allowWholeGroupOption.length && missing.length === items.length) {
    const groupOption = await raceVisible(optionLocatorsInPage(page, allowWholeGroupOption), 2500);
    if (groupOption) {
      await groupOption.click({ timeout: 15000 });
      ctx.log(`已按整体分组勾选：${allowWholeGroupOption[0]}（稍后校验指标列是否生效）`);
      return { usedWholeGroup: true };
    }
  }

  throw new Error(`${groupName}未勾选成功：${missing.join('、')}`);
}

/** 在给定作用域集合内逐个勾选 items，返回仍未勾选的项 */
async function checkItems(scopes, items) {
  const missing = [];
  for (const item of items) {
    const ok = await ensureCheckable(scopes, item).catch(() => false);
    if (!ok) missing.push(item);
  }
  return missing;
}

/** 勾选单个 checkbox / 下拉选项；找不到可勾选元素时返回 false */
async function ensureCheckable(scopes, label) {
  const c = cssText(label);

  /* 1) checkbox 语义（Element UI / Ant Design / FineUI / role / 原生 label） */
  const checkboxLocators = scopes.flatMap((scope) => [
    scope.locator(`.el-checkbox:has(.el-checkbox__label:text-is("${c}"))`),
    scope.locator(`.el-checkbox:has-text("${c}")`),
    scope.locator(`.ant-checkbox-wrapper:has-text("${c}")`),
    scope.locator(`.bi-checkbox:has-text("${c}")`),
    scope.locator(`[role="checkbox"]:has-text("${c}")`),
    scope.locator(`.el-tree-node__label:text-is("${c}")`).locator('xpath=ancestor::*[contains(@class,"el-tree-node")][1]'),
    scope.locator(`label:has-text("${c}")`),
  ]);
  const box = await raceVisible(checkboxLocators, 2000);
  if (box) {
    if (!(await isElementChecked(box))) {
      await box.scrollIntoViewIfNeeded().catch(() => {});
      await box.click({ timeout: 15000 });
      if (!(await waitChecked(box, 5000))) throw new Error(`勾选「${label}」后状态未生效`);
    }
    return true;
  }

  /* 2) 下拉选项 / 树节点语义（多选下拉面板、分组指标） */
  const optionLocators = scopes.flatMap((scope) => [
    scope.locator(`.el-select-dropdown__item:has-text("${c}")`),
    scope.locator(`.ant-select-item-option:has-text("${c}")`),
    scope.locator(`.bi-select-item:has-text("${c}")`),
    scope.locator(`[class*="option"]:has-text("${c}")`),
    scope.locator(`[role="option"]:has-text("${c}")`),
    scope.locator(`.el-dropdown-menu__item:has-text("${c}")`),
    scope.locator(`[role="treeitem"]:has-text("${c}")`),
  ]);
  const option = await raceVisible(optionLocators, 1200);
  if (!option) return false;
  if (!(await isElementChecked(option))) {
    await option.scrollIntoViewIfNeeded().catch(() => {});
    await option.click({ timeout: 15000 });
    // 单选面板点击后会关闭、元素可能被移除：状态等待失败也算点击成功（最终由查询结果校验）
    await waitChecked(option, 2500).catch(() => {});
  }
  return true;
}

/* ================================================================== */
/* 3.4 查询并等待表格数据                                                */
/* ================================================================== */

async function runQueryAndWaitResult(page, ctx) {
  /* 1) 找到【查询】按钮：点击本身会等待按钮可用态（disabled/loading 时不重复点击） */
  const queryBtn = await raceText(page, SEL.queryTexts, 15000);
  if (!queryBtn) throw new Error('未找到【查询】按钮');
  await queryBtn.scrollIntoViewIfNeeded().catch(() => ({}));
  await queryBtn.click({ timeout: CONFIG.navTimeoutMs });

  /* 2) 等加载遮罩消失（best-effort；最终以表格数据断言为准） */
  await waitMaskDisappear(page, CONFIG.navTimeoutMs);

  /* 3) 等表格数据真正渲染；空结果直接给出可读原因 */
  await waitQueryResult(page, CONFIG.navTimeoutMs);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

/** 等加载遮罩消失：跨 frame 跟踪可见遮罩，不依赖固定 sleep */
async function waitMaskDisappear(page, timeoutMs) {
  const tasks = pageScopes(page).map(async (scope) => {
    try {
      await scope.waitForFunction(
        (selectors) =>
          selectors.some((sel) =>
            Array.from(document.querySelectorAll(sel)).some((el) => el.offsetParent !== null)
          ),
        SEL.loadingMask,
        { timeout: 4000 }
      );
    } catch {
      return; // 这个 frame 没有出现遮罩
    }
    await scope.waitForFunction(
      (selectors) =>
        selectors.every((sel) =>
          Array.from(document.querySelectorAll(sel)).every(
            (el) =>
              el.offsetParent === null ||
              getComputedStyle(el).visibility === 'hidden' ||
              getComputedStyle(el).display === 'none'
          )
        ),
      SEL.loadingMask,
      { timeout: timeoutMs }
    );
  });
  // 遮罩卡住不致命：后续行数据断言会给出更准确的错误
  await Promise.allSettled(tasks);
}

/** 等表格行渲染完成（跨 frame）；识别“暂无数据”并以业务原因失败 */
async function waitQueryResult(page, timeoutMs) {
  const scopes = pageScopes(page);
  const rowWait = (scope) =>
    scope.waitForFunction(
      (cfg) =>
        cfg.rows.some((sel) =>
          Array.from(document.querySelectorAll(sel)).some((tr) => {
            if (tr.offsetParent === null) return false;
            const cells = tr.querySelectorAll('td');
            return cells.length > 0 && (tr.innerText || '').trim().length > 0;
          })
        ),
      { rows: SEL.tableRows },
      { timeout: timeoutMs }
    );

  try {
    await Promise.any(scopes.map((scope) => rowWait(scope)));
    return;
  } catch {
    // 全部 frame 都没等到行：区分“查询空结果”和“查询超时”
    for (const scope of scopes) {
      const empty = await scope
        .waitForFunction(
          (selectors) =>
            selectors.some((sel) =>
              Array.from(document.querySelectorAll(sel)).some(
                (el) =>
                  el.offsetParent !== null &&
                  /暂无数据|无数据|没有数据|No Data/i.test(el.innerText || '')
              )
            ),
          SEL.emptyTexts,
          { timeout: 1200 }
        )
        .catch(() => null);
      if (empty) throw new Error('查询结果为空（页面提示暂无数据）');
    }
    throw new Error('查询超时：等待结果表格数据加载超时');
  }
}

/** 解析报表表格：找到【站点名称】列、行选择器与每行站点名称 */
async function resolveReportTable(page, filters, usedWholeGroup, ctx) {
  const structure = await findTableStructure(page);
  if (!structure) throw new Error('未找到【站点名称】列，页面结构可能已变化');

  const rowSelector = await pickRowSelector(structure.scope);
  const siteNames = await readSiteNames(structure.scope, rowSelector, structure.columnIndex);
  if (!siteNames.length) throw new Error('查询结果为空，未生成任何报表');

  // 指标用了“整体分组”兜底时，必须确认指标列真的出现，否则宁可失败也不静默导出缺列数据
  await verifyMetricColumns(structure.scope, filters.metrics, { required: usedWholeGroup, ctx });

  return { ...structure, rowSelector, siteNames };
}

/** 校验表头里是否出现期望的指标列（无法识别表头结构时跳过） */
async function verifyMetricColumns(scope, metrics, { required, ctx }) {
  if (!Array.isArray(metrics) || !metrics.length) return;
  const headerTexts = await scope
    .locator('th')
    .evaluateAll((els) => els.map((el) => (el.innerText || '').replace(/\s+/g, '')))
    .catch(() => []);
  if (!headerTexts.length) return;

  const normalize = (text) => String(text ?? '').replace(/\s+/g, '');
  const missing = metrics.filter((metric) => !headerTexts.some((text) => text.includes(normalize(metric))));
  if (!missing.length) return;

  const message = `表头未找到指标列：${missing.join('、')}`;
  if (required) throw new Error(`指标（利润分组）未生效：${message}`);
  ctx.log(`⚠️ ${message}（可能指标未生效或列名不同，请核对导出结果）`);
}

/** 定位表格结构：跨 frame 找【站点名称】表头所在列索引 */
async function findTableStructure(page) {
  for (const scope of pageScopes(page)) {
    for (const headerSelector of SEL.tableHeaders) {
      const ths = scope.locator(headerSelector);
      const count = await ths.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const text = ((await ths.nth(i).innerText().catch(() => '')) || '').replace(/\s+/g, '');
        if (text.includes(SEL.siteNameHeader) || text === '站点') {
          return { scope, columnIndex: i, headerSelector };
        }
      }
    }
  }
  return null;
}

/** 选一个真正有数据行的行选择器（优先主表体，避免 fixed 列克隆表重复） */
async function pickRowSelector(scope) {
  for (const selector of SEL.tableRows) {
    const count = await scope.locator(selector).count().catch(() => 0);
    if (count > 0) return selector;
  }
  throw new Error('未找到结果表格数据行');
}

/** 读取每行的【站点名称】（空白归一化，作为产物 itemName） */
async function readSiteNames(scope, rowSelector, columnIndex) {
  const names = await scope
    .locator(rowSelector)
    .evaluateAll(
      (rows, idx) =>
        rows.map((row) => {
          const cell = row.querySelectorAll('td')[idx];
          if (!cell) return '';
          return (cell.innerText || '').replace(/\s+/g, ' ').trim();
        }),
      columnIndex
    )
    .catch(() => []);
  return Array.isArray(names) ? names : [];
}

/* ================================================================== */
/* 3.5 汇总表导出（原样导出）                                           */
/* ================================================================== */

async function exportMainReport(page, ctx) {
  const btn = await raceText(page, SEL.mainExportTexts, 20000);
  if (!btn) throw new Error('未找到【原样导出】按钮');
  await btn.scrollIntoViewIfNeeded().catch(() => {});

  const downloadPromise = page.waitForEvent('download', { timeout: CONFIG.navTimeoutMs });
  downloadPromise.catch(() => {});
  // 真实站点里导出可能在当前页直接下载，也可能开新标签页；两种都监听
  const popupPromise = page
    .waitForEvent('popup', { timeout: 12000 })
    .then((popup) => (popup ? { page: popup } : null))
    .catch(() => null);
  await btn.click({ timeout: CONFIG.navTimeoutMs });

  // 部分站点导出前会弹二次确认框：下载 / 新标签页 / 弹窗三者竞速
  const confirmLocators = pageScopes(page).flatMap((scope) =>
    SEL.dialogConfirmTexts.map((text) => {
      const c = cssText(text);
      return scope.locator(
        [
          `.el-message-box__btns button:has-text("${c}")`,
          `.el-dialog__footer button:has-text("${c}")`,
          `[role="dialog"] button:has-text("${c}")`,
          `[class*="dialog"] button:has-text("${c}")`,
        ].join(', ')
      );
    })
  );
  const outcome = await firstOf(
    [
      downloadPromise.then((download) => ({ download })),
      popupPromise,
      raceVisible(confirmLocators, 8000).then((confirm) => (confirm ? { confirm } : null)),
    ],
    CONFIG.navTimeoutMs,
    '汇总表导出未触发下载（导出按钮无响应，或被弹窗阻塞）'
  );

  let download = outcome.download || null;
  if (!download && outcome.confirm) {
    await outcome.confirm.click({ timeout: 15000 }).catch(() => {});
    download = await downloadPromise;
  }
  if (!download && outcome.page) {
    // 导出在新标签页里触发下载：在新页上等 download 事件
    download = await outcome.page.waitForEvent('download', { timeout: CONFIG.navTimeoutMs });
  }
  if (!download) throw new Error('汇总表导出未产生下载文件');
  const tmpFile = await withTimeout(download.path(), CONFIG.navTimeoutMs, '汇总表落盘超时');
  const fileName = safeFileName(
    download.suggestedFilename() || '平台经营分析汇总.xlsx',
    '平台经营分析汇总.xlsx'
  );
  const record = await ctx.saveFile({ itemName: null, fileName, kind: 'main', sourcePath: tmpFile });
  ctx.log(`汇总表已保存：${record.fileName}`);
}

/* ================================================================== */
/* 3.6 订单明细（逐店铺下载）                                           */
/* ================================================================== */

/**
 * 下载第 rowIndex 行的店铺订单明细：
 *   点击【站点名称】单元格 -> 菜单【订单明细（下载）】-> 等 download 事件
 * 兼容：单元格里是链接/按钮、菜单挂在其它 frame/顶层、下载发生在当前页或新标签页。
 */
async function downloadDetailForRow(page, table, rowIndex) {
  // 清掉上一行可能残留的菜单/浮层，避免点不到本行
  await safeEscape(page);

  const row = table.scope.locator(table.rowSelector).nth(rowIndex);
  const cell = row.locator('td').nth(table.columnIndex);
  await cell.scrollIntoViewIfNeeded().catch(() => {});

  const inner = cell.locator('a, button, .el-link, [class*="link"], [class*="btn"]').first();
  const target = (await inner.isVisible().catch(() => false)) ? inner : cell;

  // 先挂菜单监听和 popup 监听，再点击，避免菜单/下载事件先于监听发生
  const menuPromise = raceText(page, SEL.detailMenuTexts, 12000).then((loc) =>
    loc ? { page, loc } : null
  );
  const popupPromise = page
    .waitForEvent('popup', { timeout: 10000 })
    .then((popup) => (popup ? { page: popup } : null))
    .catch(() => null);
  await target.click({ timeout: 15000 });

  const opened = await firstOf([menuPromise, popupPromise], 15000, '点击【站点名称】后未出现【订单明细（下载）】菜单');
  const targetPage = opened.page || page;
  const menuItem =
    opened.loc || (await raceText(targetPage, SEL.detailMenuTexts, 10000));
  if (!menuItem) throw new Error('未出现【订单明细（下载）】菜单项');

  // 菜单项点击前挂下载监听（页面以实际弹出菜单所在页为准）
  const downloadPromise = targetPage.waitForEvent('download', { timeout: DETAIL_DOWNLOAD_TIMEOUT_MS });
  downloadPromise.catch(() => {});
  const popup2 = targetPage
    .waitForEvent('popup', { timeout: DETAIL_DOWNLOAD_TIMEOUT_MS })
    .then((popup) => (popup ? { page: popup } : null))
    .catch(() => null);
  await menuItem.click({ timeout: 15000 });

  const outcome = await firstOf(
    [downloadPromise.then((download) => ({ download })), popup2],
    DETAIL_DOWNLOAD_TIMEOUT_MS + 3000,
    '点击【订单明细（下载）】后未触发下载'
  );

  if (outcome.download) return outcome.download;

  // 极端情况：菜单项点开新标签页后才产生下载
  const popupPage = outcome.page;
  return popupPage.waitForEvent('download', { timeout: DETAIL_DOWNLOAD_TIMEOUT_MS });
}

/**
 * 竞速等待：第一个非空结果生效（其余 promise 挂 catch，避免未处理拒绝）。
 * @param {Promise<object>[]} promises 竞速列表（空值/拒绝会被忽略）
 * @returns {Promise<object>} 第一个非空结果
 */
async function firstOf(promises, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    const take = (value) => {
      if (settled || !value) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    for (const promise of promises || []) {
      Promise.resolve(promise).then(take).catch(() => {});
    }
  });
}

/** 明细文件名尽量带上站点名称，便于人工核对；itemName 仍以表内【站点名称】为准 */
function bindDetailFileName(itemName, suggestedFilename) {
  const siteName = safeFileName(itemName || '站点', '站点');
  const suggested = safeFileName(suggestedFilename || '订单明细.xlsx', '订单明细.xlsx');
  if (suggested.includes(siteName)) return suggested;
  const ext = path.extname(suggested) || '.xlsx';
  const stem = suggested.slice(0, suggested.length - path.extname(suggested).length) || '订单明细';
  return safeFileName(`${siteName}_${stem}${ext}`, `${siteName}_订单明细${ext}`);
}

/* ================================================================== */
/* 4. 通用页面操作辅助（全部跨 frame）                                   */
/* ================================================================== */

/** 页面作用域：主页面 + 所有子 frame（FineBI 报表通常嵌在 iframe 里） */
function pageScopes(page) {
  const scopes = [page];
  try {
    const mainFrame = page.mainFrame();
    for (const frame of page.frames()) {
      if (frame !== mainFrame) scopes.push(frame);
    }
  } catch {
    /* 页面可能正在导航 */
  }
  return scopes;
}

/** 文本 -> CSS 选择器字符串字面量（转义反斜杠/引号/换行，防止参数破坏选择器） */
function cssText(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

/** 并发等待一组定位器，返回最先可见的那个；超时返回 null（不抛错） */
async function raceVisible(locators, timeoutMs = 5000) {
  const list = (locators || []).filter(Boolean);
  if (!list.length) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    let pending = list.length;
    list.forEach((loc) => {
      loc
        .first()
        .waitFor({ state: 'visible', timeout: Math.max(timeoutMs, 1000) })
        .then(() => finish(loc.first()))
        .catch(() => {
          pending -= 1;
          if (pending === 0) finish(null);
        });
    });
  });
}

/** 一组候选文本 -> 定位器数组（role/精确文本/菜单项/包含文本） */
function textLocators(scope, texts) {
  const list = [];
  const css = [];
  for (const raw of texts || []) {
    const t = String(raw ?? '');
    if (!t) continue;
    list.push(scope.getByRole('button', { name: t, exact: true }));
    list.push(scope.getByRole('link', { name: t, exact: true }));
    list.push(scope.getByRole('menuitem', { name: t, exact: true }));
    list.push(scope.getByRole('tab', { name: t, exact: true }));
    list.push(scope.getByText(t, { exact: true }));
    const c = cssText(t);
    css.push(
      `button:text-is("${c}")`,
      `a:text-is("${c}")`,
      `.el-menu-item:has-text("${c}")`,
      `.el-submenu__title:has-text("${c}")`,
      `.el-dropdown-menu__item:has-text("${c}")`,
      `.el-button:has-text("${c}")`,
      // 注意：不能用宽泛的 li:has-text —— 子菜单外层 li.el-submenu 会因“包含子项文本”被误命中，
      // 点上去实际点到父级菜单，导致子项点不开。
      `li:not(.el-submenu):has-text("${c}")`,
      `[role="menuitem"]:has-text("${c}")`,
      `[role="option"]:has-text("${c}")`,
      `[role="tab"]:has-text("${c}")`,
      `.el-tabs__item:has-text("${c}")`,
      `:text-is("${c}")`
    );
  }
  if (css.length) list.push(scope.locator(css.join(', ')));
  return list;
}

/** 跨 frame 的文本定位器集合 */
function textLocatorsInPage(page, texts) {
  return pageScopes(page).flatMap((scope) => textLocators(scope, texts));
}

/** 跨 frame 找并点击文本入口；找不到直接抛错（由上层带上业务步骤说明原因） */
async function clickText(page, texts, { timeoutMs = 15000, what = '目标元素' } = {}) {
  const loc = await raceVisible(textLocatorsInPage(page, texts), timeoutMs);
  if (!loc) throw new Error(`未找到${what}（候选文本：${texts.join(' / ')}）`);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: Math.min(timeoutMs, CONFIG.navTimeoutMs) });
  return loc;
}

/** 跨 frame 等文本可见 */
async function raceText(page, texts, timeoutMs = 5000) {
  return raceVisible(textLocatorsInPage(page, texts), timeoutMs);
}

/** 跨 frame 文本是否可见（短等待，用于判断菜单是否已展开，避免重复点击） */
async function isTextVisible(page, texts, timeoutMs = 1500) {
  return !!(await raceText(page, texts, timeoutMs));
}

/** 下拉选项定位器（选项面板可能挂载在当前 frame 的 body） */
function optionTextLocators(scope, texts) {
  const out = [];
  for (const raw of texts || []) {
    const c = cssText(raw);
    out.push(
      scope.locator(`.el-select-dropdown__item:has-text("${c}")`),
      scope.locator(`.el-select-dropdown__item span:text-is("${c}")`),
      scope.locator(`.ant-select-item-option:has-text("${c}")`),
      scope.locator(`.bi-select-item:has-text("${c}")`),
      scope.locator(`[class*="dropdown"] :is(li,div,span):text-is("${c}")`),
      scope.locator(`[class*="option"]:has-text("${c}")`),
      scope.locator(`[role="option"]:has-text("${c}")`),
      scope.locator(`.el-dropdown-menu__item:has-text("${c}")`),
      scope.locator(`.el-checkbox:has(.el-checkbox__label:text-is("${c}"))`),
      scope.locator(`.el-checkbox:has-text("${c}")`),
      scope.locator(`.ant-checkbox-wrapper:has-text("${c}")`),
      scope.locator(`.bi-checkbox:has-text("${c}")`),
      scope.locator(`[role="checkbox"]:has-text("${c}")`),
      scope.locator(`[role="treeitem"]:has-text("${c}")`),
      scope.locator(`label:has-text("${c}")`)
    );
  }
  return out;
}

/** 跨 frame 的下拉选项定位器集合 */
function optionLocatorsInPage(page, texts) {
  return pageScopes(page).flatMap((scope) => optionTextLocators(scope, texts));
}

/** 按标签文本定位筛选项容器（.el-form-item / .ant-form-item / 通用容器） */
async function findFormItemByLabel(page, labels, timeoutMs = 8000) {
  const locators = [];
  for (const scope of pageScopes(page)) {
    for (const raw of labels || []) {
      const t = cssText(raw);
      locators.push(
        scope.locator(`.el-form-item:has(.el-form-item__label:text-is("${t}"))`),
        scope.locator(`.el-form-item:has(label:text-is("${t}"))`),
        scope.locator(`.ant-form-item:has(label:text-is("${t}"))`),
        scope.locator(`.el-form-item:has-text("${t}")`),
        scope
          .locator(`:text-is("${t}")`)
          .locator('xpath=ancestor::*[self::div or self::td or self::form or self::li][1]')
      );
    }
  }
  return raceVisible(locators, timeoutMs);
}

/**
 * 在页面内扫描“筛选值是否已生效”：先看 input.value（下拉控件把值写进 input），
 * 再看筛选项容器文本（标签/文本型控件）。作为 page/frame.evaluate / waitForFunction
 * 的注入函数，必须自包含（不能引用外部作用域）。
 */
function scanSelectedValue({ labels, expected }) {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
  const exp = (expected || []).map(norm).filter(Boolean);
  const lab = (labels || []).map(norm).filter(Boolean);
  if (!exp.length) return false;

  // 1) 输入框 value 命中：需要“能对上标签（placeholder/aria-label/name/id）或位于筛选容器内”，
  //    避免把页面里其它隐藏 input 的旧值误判成已选中。
  const filterScopeSelector =
    '.el-form-item, .ant-form-item, .filter-item, .filter-field, .search-item, form, [class*="filter"]';
  const byInput = Array.from(document.querySelectorAll('input')).some((input) => {
    const value = norm(input.value);
    if (!value || !exp.some((e) => value.includes(e))) return false;
    const hint =
      norm(input.getAttribute('placeholder')) +
      norm(input.getAttribute('aria-label')) +
      norm(input.getAttribute('name')) +
      norm(input.id);
    if (lab.some((l) => hint.includes(l))) return true;
    return !!input.closest(filterScopeSelector);
  });
  if (byInput) return true;

  // 2) 筛选项容器文本命中：部分控件把选中值渲染成 tag/文本
  const containers = Array.from(
    document.querySelectorAll(
      '.el-form-item, .ant-form-item, .filter-item, .filter-field, .search-item, [class*="filter"]'
    )
  );
  return containers.some((c) => {
    const t = norm(c.innerText);
    const hitValue = exp.some((e) => t.includes(e));
    if (!hitValue) return false;
    if (!lab.length) return true;
    return lab.some((l) => t.includes(l));
  });
}

/** 判断筛选值是否已经是目标值（一次性求值，用于“已选中则跳过”） */
async function hasSelectedValue(page, labelTexts, optionTexts) {
  const cfg = { labels: labelTexts, expected: optionTexts };
  const results = await Promise.all(
    pageScopes(page).map((scope) => scope.evaluate(scanSelectedValue, cfg).catch(() => false))
  );
  return results.some(Boolean);
}

/** 等筛选值生效（不靠固定 sleep，由各 frame 的 waitForFunction 轮询 DOM 断言） */
async function waitSelectedValue(page, labelTexts, optionTexts, timeoutMs = 6000) {
  const cfg = { labels: labelTexts, expected: optionTexts };
  try {
    await Promise.any(
      pageScopes(page).map((scope) =>
        scope.waitForFunction(scanSelectedValue, cfg, { timeout: timeoutMs })
      )
    );
    return true;
  } catch {
    return false;
  }
}

/** 元素是否处于选中/勾选态（Element UI / AntD / FineUI / role / 原生 input） */
function checkedFromElement(el) {
  if (!el) return false;
  const cls = typeof el.className === 'string' ? el.className : '';
  const tokens = cls.split(/\s+/);
  if (
    tokens.some((t) =>
      ['is-checked', 'is-selected', 'selected', 'checked', 'is-active', 'ant-checkbox-wrapper-checked'].includes(t)
    )
  ) {
    return true;
  }
  if (el.getAttribute && el.getAttribute('aria-checked') === 'true') return true;
  if (el.getAttribute && el.getAttribute('aria-selected') === 'true') return true;
  const input = el.querySelector && el.querySelector('input[type="checkbox"],input[type="radio"]');
  return !!(input && input.checked);
}

async function isElementChecked(locator) {
  return locator.evaluate(checkedFromElement).catch(() => false);
}

/**
 * 等元素进入选中态。使用 locator.evaluate 在元素所在 frame 内轮询断言
 * （跨 frame 场景下不能拿 ElementHandle 去 page.waitForFunction）。
 */
async function waitChecked(locator, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isElementChecked(locator)) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
}

/** 安全按 Esc：关闭可能残留的下拉/浮层 */
async function safeEscape(page) {
  await page.keyboard.press('Escape').catch(() => {});
}

/* ================================================================== */
/* 5. DEMO 模式：本地模拟页面跑通全链路（便于 curl 自测，无需真实站点）  */
/* ================================================================== */

/**
 * 用 page.setContent 渲染一张虚拟报表页，走完：
 * 打开页面 -> （可选）人机校验 -> 点查询 -> 等表格 -> 逐行产出文件并绑定名称 -> 汇总主文件
 * 说明：真实下载走 download 事件；演示环境用内存生成 CSV 模拟“下载产物”，
 *       文件落盘、meta.json 映射、/result 输出与真实链路完全一致。
 */
async function runDemo(page, ctx) {
  const { params } = ctx;
  const simulateVerify = params.simulateVerify === true || CONFIG.demoSilentVerify;
  const rows = buildDemoRows(params);

  ctx.setProgress('（DEMO）打开模拟报表页');
  // 演示页面由模板 + 运行时数据渲染而成，仍是真实浏览器渲染，选择器与断言逻辑与线上一致
  await page.setContent(renderDemoHtml(rows, simulateVerify), { waitUntil: 'domcontentloaded' });

  /* 5.1 可选：模拟一次人机校验，用于验证 waiting_verify 全流程 */
  if (simulateVerify) {
    const qr = page.locator('#demo-qr');
    await qr.waitFor({ state: 'visible' });
    const imageBuffer = await qr.screenshot({ type: 'png' });

    const verifyPromise = ctx.needVerify({
      imageBuffer,
      contentType: 'image/png',
      hint: '（DEMO）请扫码；或 POST /jobs/:jobId/verify 提交 code 继续',
    });
    const { code } = await verifyPromise;
    ctx.log(`（DEMO）校验通过，code=${code || '(auto)'}`);
    // 演示页没有真实跳转，这里只需把验证框收起来即可继续；
    // 真实站点应改为断言登录成功标志元素（见 doLogin）。
    await page.evaluate(() => {
      const box = document.getElementById('qr-box');
      if (box) box.hidden = true;
    });
    ctx.setProgress('（DEMO）校验通过');
  }

  /* 5.2 点查询 + 等表格（真实断言，不用 sleep） */
  ctx.setProgress('（DEMO）查询中，等待表格数据');
  await page.click('#btn-search');
  await page.locator('.loading-mask').waitFor({ state: 'hidden' });
  await page.waitForSelector('#rows tr');

  const count = await page.locator('#rows tr').count();
  if (count === 0) throw new Error('（DEMO）查询结果为空');

  /* 5.3 逐行导出：当场绑定业务名称 */
  const items = await page.locator('#rows tr').evaluateAll((trs) =>
    trs.map((tr) => ({
      name: tr.querySelector('td.name')?.textContent?.trim() || '',
      amount: tr.querySelector('td.amount')?.textContent?.trim() || '0',
      date: tr.querySelector('td.date')?.textContent?.trim() || '',
    }))
  );

  for (let i = 0; i < items.length; i++) {
    if (ctx.isAborted()) throw new Error('任务已被终止');
    const it = items[i];
    ctx.setProgress(`（DEMO）导出明细 ${i + 1}/${items.length}：${it.name}`);

    // 演示用：指定 skipNames 可模拟"该行数据导出失败"，用于验证 missingItems
    const skip = (params.skipNames || []).includes(it.name);
    if (skip) {
      await ctx.addMissing(it.name, '（DEMO）模拟该行导出失败');
      continue;
    }

    const csv = ['名称,金额,日期', `${it.name},${it.amount},${it.date}`].join('\n');
    await ctx.saveFile({
      itemName: it.name,
      fileName: `${safeFileName(it.name)}.csv`,
      kind: 'detail',
      content: csv,
    });
  }

  /* 5.4 主报表 */
  ctx.setProgress('（DEMO）导出汇总主报表');
  const total = items.reduce((s, it) => s + Number(it.amount || 0), 0);
  const mainCsv = [
    '名称,金额,日期',
    ...items.map((it) => `${it.name},${it.amount},${it.date}`),
    `合计,${total},`,
  ].join('\n');
  await ctx.saveFile({
    itemName: null,
    fileName: '汇总报表.csv',
    kind: 'main',
    content: mainCsv,
  });

  ctx.log(`（DEMO）完成：${items.length} 行明细 + 1 个主报表`);
}

/** 生成演示数据：params.rowCount 可控制行数 */
function buildDemoRows(params = {}) {
  const n = Math.min(Math.max(Number(params.rowCount) || 6, 1), 50);
  const names = ['华东区-日销', '华北区-日销', '华南区-日销', '西南区-日销', '线上旗舰店', '线下直营', '分销渠道', '海外站点'];
  return Array.from({ length: n }, (_, i) => ({
    name: `${names[i % names.length]}-${String(i + 1).padStart(2, '0')}`,
    amount: (1000 + i * 137) % 9999,
  }));
}

const DEMO_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DEMO 报表页</title>
<style>
  body{font-family:system-ui,"Microsoft YaHei",sans-serif;margin:0;padding:24px;background:#f6f7f9;color:#1f2328}
  h1{font-size:18px;margin:0 0 16px}
  .panel{background:#fff;border:1px solid #e4e6eb;border-radius:8px;padding:16px}
  button{padding:6px 14px;border:1px solid #d0d3d9;background:#fff;border-radius:6px;cursor:pointer}
  table{border-collapse:collapse;width:100%;margin-top:12px;font-size:13px}
  th,td{border-bottom:1px solid #eceef1;padding:8px 10px;text-align:left}
  .loading-mask{display:none;position:fixed;inset:0;background:rgba(255,255,255,.6);align-items:center;justify-content:center}
  .loading-mask.on{display:flex}
  #qr-box{margin-top:12px}
  #demo-qr{width:160px;height:160px;display:grid;grid-template-columns:repeat(8,1fr);
    background:#fff;border:6px solid #fff;box-shadow:0 0 0 1px #ddd}
  #demo-qr i{background:#111}
</style></head><body>
<h1>DEMO · 区域销售报表（模拟页面）</h1>
<div class="panel">
  <button id="btn-search">查询</button>
  <div id="qr-box" hidden>
    <div>（DEMO）请扫码验证</div>
    <div id="demo-qr"></div>
  </div>
  <table><thead><tr><th>名称</th><th>金额</th><th>日期</th></tr></thead>
  <tbody id="rows"></tbody></table>
</div>
<div class="loading-mask" id="mask"></div>
<script>
  // 画一个假二维码（纯视觉，仅用于演示 /verify 返回的图片流）
  const qr = document.getElementById('demo-qr');
  for (let i = 0; i < 64; i++) { const b = document.createElement('i');
    b.style.visibility = (i * 7 + 3) % 3 ? 'visible' : 'hidden'; qr.appendChild(b); }
  const ROWS = __ROWS__;
  document.getElementById('btn-search').addEventListener('click', () => {
    const mask = document.getElementById('mask');
    mask.classList.add('on');                 // 模拟异步加载遮罩
    setTimeout(() => {
      document.getElementById('rows').innerHTML = ROWS.map(r =>
        '<tr><td class="name">' + r.name + '</td><td class="amount">' + r.amount +
        '</td><td class="date">' + new Date().toISOString().slice(0,10) + '</td></tr>').join('');
      mask.classList.remove('on');
    }, 300);
  });
  if (__SIMULATE_VERIFY__) {
    document.getElementById('qr-box').hidden = false;
  }
</script>
</body></html>`;

/* ================================================================== */
/* 6. 站点无关的辅助                                                   */
/* ================================================================== */

/** 截图留证（失败时便于排查，保存到 job 目录，不进 /result） */
async function dumpDebugScreenshot(page, jobDir, tag = 'debug') {
  try {
    await fs.mkdir(jobDir, { recursive: true });
    const file = path.join(jobDir, `${tag}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return null;
  }
}

/** 把运行时数据注入演示页面模板 */
function renderDemoHtml(rows, simulateVerify) {
  return DEMO_HTML.replace('__ROWS__', JSON.stringify(rows)).replace(
    '__SIMULATE_VERIFY__',
    String(!!simulateVerify)
  );
}

module.exports = {
  runJob,
  getBrowser,
  closeBrowser,
  dumpDebugScreenshot,
  renderDemoHtml,
  SEL,
  // 供 server 在启动日志里打印模式
  isDemo: () => CONFIG.demoMode,
};
