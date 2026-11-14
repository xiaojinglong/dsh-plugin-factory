'use strict';

/**
 * crawler.js —— haina-comment 执行层（浏览器自动化 + 写操作）
 *
 * 业务：登录海纳技术博客 → 找文章 → 发表评论 → 记录审计 → 出汇总报告。
 * 写操作保护：
 *   - 必须 params.confirm_write === true 才真正提交（否则抛错，提示先 dry_run）；
 *   - params.dry_run === true 时只生成计划，不提交；
 *   - 每条评论逐条记录（文章/内容/状态/响应/时间），失败连续 3 条即停止。
 */

const { chromium } = require('playwright');

const HOME = 'http://www.hainaerp.com';
const ARTICLE_API = 'http://api.hainaerp.com/api/article/list?page=1&per_page=20';

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.isConnected()) return b;
      browserPromise = null;
    } catch {
      browserPromise = null;
    }
  }
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ headless: String(process.env.HEADLESS || 'true') !== 'false', args: ['--no-sandbox', '--disable-gpu'] })
      .then((b) => {
        b.on('disconnected', () => { browserPromise = null; });
        return b;
      });
  }
  return browserPromise;
}

async function closeBrowser() {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  try { const b = await p; await b.close(); } catch { /* ignore */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 登录：点【登录】→ 填邮箱/密码 → 点弹窗内【登录】→ 校验 localStorage.user_token */
async function login(page, ctx) {
  ctx.setProgress('打开站点并登录');
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);

  await page.getByRole('button', { name: '登录', exact: true }).first().click({ timeout: 15000 });
  await page.waitForTimeout(900);
  await page.locator('input[placeholder*="邮箱"]').first().fill(String(process.env.HAINA_EMAIL || ''));
  await page.locator('input[type="password"]').first().fill(String(process.env.HAINA_PASSWORD || ''));
  await page.locator('.el-dialog button.el-button--primary').last().click({ timeout: 15000 });
  await page.waitForTimeout(2500);

  const token = await page.evaluate(() => localStorage.getItem('user_token') || '');
  if (!token) throw new Error('登录失败：localStorage 无 user_token（账号密码或登录页结构可能变化）');
  ctx.log('登录成功');
  return token;
}

/** 文章列表：公开接口，返回 [{id,title,slug,url}] */
async function fetchArticles() {
  const res = await fetch(ARTICLE_API, { signal: AbortSignal.timeout(20000) });
  const json = await res.json();
  const list = json?.data?.list || [];
  return list.map((a) => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    url: `${HOME}/article/${encodeURIComponent(a.slug)}`,
  }));
}

/** 评论文案模板（与文章主题相关、逐条不同） */
const TEMPLATES = [
  '按文章步骤操作了一遍，环境正常启动，外网访问也通了，收藏了。（自动化测试评论）',
  '写得很细，尤其是排错部分，之前卡在这很久，感谢分享。（自动化测试评论）',
  '补充一点：按文中顺序执行基本不会踩坑，版本号记得对齐。（自动化测试评论）',
  '照着配置跑通了，思路清晰，适合新手对照排查。（自动化测试评论）',
  '这篇的踩坑清单很实用，已转给同事参考，期待后续更新。（自动化测试评论）',
];

/** 打开文章 → 填评论 → 提交 → 捕获 /comment/create 响应 */
async function postComment(page, article, content, ctx) {
  const respPromise = page
    .waitForResponse((r) => /\/api\/comment\/create/.test(r.url()), { timeout: 20000 })
    .catch(() => null);
  await page.goto(article.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const ta = page.locator('textarea[placeholder*="评论"]').first();
  await ta.waitFor({ state: 'visible', timeout: 15000 });
  await ta.click();
  await ta.fill(content);
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: '发表评论' }).first().click({ timeout: 15000 });
  const resp = await respPromise;
  let status = 0;
  let message = '';
  if (resp) {
    status = resp.status();
    try {
      const json = await resp.json();
      message = String(json?.message || '');
    } catch { /* ignore */ }
  }
  await page.waitForTimeout(800);
  const toast = await page.evaluate(() => [...document.querySelectorAll('.el-message,[class*="toast"]')].map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 160));
  const ok = status === 200 && /评论成功|等待审核/.test(message + toast);
  return { ok, status, message, toast };
}

async function runJob(job, ctx) {
  clearTimeout(__idleTimer);
  const p = ctx.params || {};
  const email = String(process.env.HAINA_EMAIL || '').trim();
  const password = String(process.env.HAINA_PASSWORD || '').trim();
  if (!email || !password) throw new Error('缺少账号：请在 service/.env 配置 HAINA_EMAIL / HAINA_PASSWORD');

  const maxComments = Math.max(1, Math.min(20, Number(p.max_comments) || 10));
  const dryRun = p.dry_run === true;
  const confirmWrite = p.confirm_write === true;
  if (!dryRun && !confirmWrite) {
    throw new Error('写操作保护：需显式传 confirm_write=true 才会真正发表评论（可先用 dry_run=true 预演）');
  }

  ctx.setProgress('拉取文章列表');
  const articles = await fetchArticles();
  if (!articles.length) throw new Error('文章列表为空：接口 /api/article/list 无数据');
  ctx.log(`文章数：${articles.length}`);

  // 计划：按文章轮转分配 maxComments 条
  const plan = [];
  for (let i = 0; i < maxComments; i += 1) {
    const a = articles[i % articles.length];
    plan.push({ seq: i + 1, article: a, content: TEMPLATES[i % TEMPLATES.length] });
  }

  if (dryRun) {
    ctx.setProgress('预演模式：只生成计划，不发表评论');
  }

  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();
  const comments = [];

  try {
    await login(page, ctx);

    for (const item of plan) {
      if (ctx.isAborted()) throw new Error('任务已被终止');
      ctx.setProgress(`评论 ${item.seq}/${plan.length}：${item.article.title.slice(0, 20)}`);
      if (dryRun) {
        comments.push({ ...item.article, seq: item.seq, content: item.content, status: 'planned', http_status: 0, message: 'dry_run 未提交', toast: '', at: new Date().toISOString() });
        continue;
      }
      let r;
      try {
        r = await postComment(page, item.article, item.content, ctx);
      } catch (err) {
        r = { ok: false, status: 0, message: '异常：' + err.message.slice(0, 120), toast: '' };
      }
      comments.push({
        ...item.article, seq: item.seq, content: item.content,
        status: r.ok ? 'submitted' : 'failed', http_status: r.status, message: r.message, toast: r.toast,
        at: new Date().toISOString(),
      });
      ctx.log(`#${item.seq} ${r.ok ? '提交成功（待审核）' : '失败：' + r.message}`);
      if (comments.filter((c) => c.status === 'failed').length >= 3) {
        ctx.log('连续失败达 3 条，停止剩余评论');
        break;
      }
      await sleep(2500 + Math.floor(Math.random() * 1500));
    }
  } finally {
    await context.close().catch(() => {});
    scheduleIdleClose();
  }

  const submitted = comments.filter((c) => c.status === 'submitted').length;
  const failed = comments.filter((c) => c.status === 'failed').length;
  const planned = comments.filter((c) => c.status === 'planned').length;
  const dataset = {
    task: 'haina_comment',
    fetchedAt: new Date().toISOString(),
    params: { max_comments: maxComments, dry_run: dryRun, confirm_write: confirmWrite },
    extra: { site: HOME, account: email.replace(/(.{3}).*(@.*)/, '$1***$2'), articles: articles.map((a) => ({ id: a.id, title: a.title })) },
    total: submitted + planned,
    totalPages: '-',
    pages: [{ page: 1, rows: comments }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'haina_comment_audit.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：计划 ${comments.length}，成功 ${submitted}，失败 ${failed}，预演 ${planned}`);
}


let __idleTimer = null;
/** 空闲 N 毫秒后自动关闭浏览器（默认 10 分钟），避免 chrome-headless-shell 常驻 */
function scheduleIdleClose() {
  clearTimeout(__idleTimer);
  const ms = Number(process.env.BROWSER_IDLE_MS || 600000);
  __idleTimer = setTimeout(() => { closeBrowser().catch(() => {}); }, ms);
  if (__idleTimer.unref) __idleTimer.unref();
}

module.exports = { runJob, getBrowser, closeBrowser, scheduleIdleClose };
