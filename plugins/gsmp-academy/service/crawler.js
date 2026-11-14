'use strict';

/**
 * crawler.js —— gsmp-academy 执行层（浏览器自动化：登录态复用 + 新标签页 + 视频播放控制）
 *
 * 流程：打开 AI学苑（gsmp 首页导航 → 新标签页 AI学堂）→ 进入课程 → 逐节 2x 播放 N 秒 → 采集标题 → 落盘。
 * 登录：复用 storageState（SESSION_FILE）；过期时抛错提示"扫码后重试"（人工介入点）。
 */

const { chromium } = require('playwright');

const HOME = 'https://gsmp.giikin.com/home';
const ACADEMY = 'https://manage.giikin.com/fe/shop/wbw/video-learning';
const DEFAULT_COURSE = 'FDE企业AI项目实战：从需求挖掘到项目交付';

let browserPromise = null;
async function getBrowser() {
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

async function videoState(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return { found: false };
    return { found: true, src: v.currentSrc || v.src, duration: v.duration, current: v.currentTime, rate: v.playbackRate, paused: v.paused, readyState: v.readyState };
  });
}

async function runJob(job, ctx) {
  clearTimeout(__idleTimer);
  const p = ctx.params || {};
  const course = String(p.course || DEFAULT_COURSE);
  const speed = Math.max(1, Math.min(4, Number(p.speed) || 2));
  const seconds = Math.max(2, Math.min(60, Number(p.seconds_per_lesson) || 5));
  const sessionFile = String(process.env.SESSION_FILE || 'D:/www/dsh-plugin-factory/data/sessions/default.json');

  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'zh-CN', storageState: sessionFile });
  const page = await context.newPage();
  const rows = [];
  const started = Date.now();

  try {
    ctx.setProgress('打开 AI学苑');
    // 先访问 gsmp 首页（校验登录态），再进 AI学堂
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    if (/login\.dingtalk\.com|guard\/sso/.test(page.url())) {
      throw new Error('登录态已过期：请在该浏览器窗口扫码登录后，重新保存 data/sessions/default.json 再跑');
    }

    // 进入 AI学堂（首页导航是 window.open 新标签页；直接打开目标地址更稳）
    await page.goto(ACADEMY, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    const onAcademy = await page.getByText('AI学堂', { exact: false }).count();
    if (!onAcademy) throw new Error('未进入 AI学堂（可能登录态失效或页面结构变化）');

    ctx.setProgress('进入课程：' + course.slice(0, 20));
    await page.getByText(course.slice(0, 10), { exact: false }).first().click({ timeout: 20000 });
    await page.waitForTimeout(5000);
    const lessonCount = await page.locator('.lesson-item').count();
    if (!lessonCount) throw new Error('课程目录为空：未找到 .lesson-item（课程名或页面结构可能变化）');
    ctx.log(`课程 ${course} 共 ${lessonCount} 节`);

    const limit = Math.max(1, Math.min(lessonCount, Number(p.max_lessons) || lessonCount));
    for (let i = 0; i < limit; i += 1) {
      if (ctx.isAborted()) throw new Error('任务已被终止');
      ctx.setProgress(`第 ${i + 1}/${limit} 节：2x 播放 ${seconds}s`);
      // 每节重新进入课程页，避免播放器覆盖课程列表导致点击被拦截
      await page.goto(ACADEMY, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3500);
      await page.getByText(course.slice(0, 10), { exact: false }).first().click({ timeout: 20000 });
      await page.waitForTimeout(3500);

      const item = page.locator('.lesson-item').nth(i);
      const raw = ((await item.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      const m = raw.match(/Lesson\s*(\d+)[.．]?\s*(.*?)(?:\s*\d+:\d+|\s*可获得|$)/i);
      const title = m ? m[2].trim() : raw.slice(0, 80);
      const rec = { seq: i + 1, raw, title, status: 'failed', note: '' };
      try {
        await item.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await item.click({ timeout: 20000 });
        const deadline = Date.now() + 30000;
        let st = { found: false };
        while (Date.now() < deadline) {
          await sleep(1200);
          st = await videoState(page);
          if (st.found && st.readyState >= 2) break;
        }
        if (!st.found) throw new Error('未找到 video 元素');
        const playRes = await page.evaluate(async (sec) => {
          const v = document.querySelector('video');
          v.muted = true;
          v.playbackRate = 2;
          try { await v.play(); } catch (e) { return { ok: false, reason: e.message }; }
          const t0 = v.currentTime;
          await new Promise((r) => setTimeout(r, sec * 1000));
          return { ok: true, t0, t1: v.currentTime, rate: v.playbackRate, duration: v.duration };
        }, seconds);
        rec.status = playRes.ok ? 'played' : 'failed';
        rec.rate = playRes.ok ? playRes.rate : null;
        rec.advanced = playRes.ok ? Number((playRes.t1 - playRes.t0).toFixed(2)) : 0;
        rec.duration = playRes.ok ? Number((playRes.duration || 0).toFixed(0)) : null;
        rec.src = (st.src || '').slice(0, 120);
        rec.note = playRes.ok ? `${playRes.rate}x 播放 ${seconds}s，进度前进 ${rec.advanced}s` : '播放失败：' + (playRes.reason || '');
        ctx.log(`#${i + 1} ${title} → ${rec.status}（+${rec.advanced}s）`);
      } catch (e) {
        rec.note = '异常：' + e.message.slice(0, 120);
        ctx.log(`#${i + 1} 失败：${e.message.slice(0, 80)}`);
      }
      rows.push(rec);
      await sleep(1200);
    }
  } finally {
    await context.close().catch(() => {});
    scheduleIdleClose();
  }

  const played = rows.filter((r) => r.status === 'played').length;
  const dataset = {
    task: 'gsmp_academy',
    fetchedAt: new Date().toISOString(),
    params: { course, speed, seconds_per_lesson: seconds, max_lessons: rows.length },
    extra: { site: ACADEMY, course, lessons: rows.length, played, elapsedMs: Date.now() - started },
    total: played,
    totalPages: '-',
    pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'gsmp_academy_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：${played}/${rows.length} 节课 ${speed}x 播放 ${seconds}s`);
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
