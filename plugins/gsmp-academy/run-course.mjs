// run-course.mjs —— 全流程：进入 FDE 课程 → 每节课 2 倍速播 5 秒 → 采集标题 → 落盘
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = 'D:/www/dsh-plugin-factory/plugins/gsmp-academy/data';
await mkdir(OUT, { recursive: true });
const STATE = 'D:/www/dsh-plugin-factory/data/sessions/default.json';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'zh-CN', storageState: STATE });
const page = await ctx.newPage();
const started = Date.now();
const rows = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function videoState() {
  return page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return { found: false };
    return { found: true, src: v.currentSrc || v.src, duration: v.duration, current: v.currentTime, rate: v.playbackRate, paused: v.paused, readyState: v.readyState };
  });
}

try {
  await page.goto('https://manage.giikin.com/fe/shop/wbw/video-learning', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const courseTitle = 'FDE企业AI项目实战：从需求挖掘到项目交付';
  await page.getByText('FDE企业AI项目实战', { exact: false }).first().click({ timeout: 15000 });
  await page.waitForTimeout(5000);

  const lessonCount = await page.locator('.lesson-item').count();
  console.log('lessons:', lessonCount);

  for (let i = 0; i < lessonCount; i += 1) {
    // 每节课重新进入课程页，避免播放器覆盖导致后续点击被拦截
    await page.goto('https://manage.giikin.com/fe/shop/wbw/video-learning', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.getByText('FDE企业AI项目实战', { exact: false }).first().click({ timeout: 15000 });
    await page.waitForTimeout(4000);

    const item = page.locator('.lesson-item').nth(i);
    const raw = ((await item.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const m = raw.match(/Lesson\s*(\d+)[.．]?\s*(.*?)(?:\s*\d+:\d+|\s*可获得|$)/i);
    const title = m ? m[2].trim() : raw.slice(0, 80);
    const rec = { seq: i + 1, raw, title, status: 'failed', note: '' };
    try {
      await item.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await item.click({ timeout: 15000 });
      // 等视频可播
      const deadline = Date.now() + 30000;
      let st = { found: false };
      while (Date.now() < deadline) {
        await sleep(1200);
        st = await videoState();
        if (st.found && st.readyState >= 2) break;
      }
      if (!st.found) throw new Error('未找到 video 元素');
      const before = st.current;
      const playRes = await page.evaluate(async () => {
        const v = document.querySelector('video');
        v.muted = true;
        v.playbackRate = 2;
        try { await v.play(); } catch (e) { return { ok: false, reason: e.message }; }
        const t0 = v.currentTime;
        await new Promise((r) => setTimeout(r, 5000));
        return { ok: true, t0, t1: v.currentTime, rate: v.playbackRate, duration: v.duration };
      });
      rec.status = playRes.ok ? 'played' : 'failed';
      rec.before = before;
      rec.after = playRes.t1;
      rec.advanced = playRes.ok ? Number((playRes.t1 - playRes.t0).toFixed(2)) : 0;
      rec.rate = playRes.ok ? playRes.rate : null;
      rec.duration = playRes.ok ? Number((playRes.duration || 0).toFixed(0)) : null;
      rec.src = (st.src || '').slice(0, 120);
      rec.note = playRes.ok ? `2x 播放 5s，进度前进 ${rec.advanced}s` : '播放失败：' + (playRes.reason || '');
      console.log(`#${i + 1} ${title} → ${rec.status} advanced=${rec.advanced}s`);
    } catch (e) {
      rec.note = '异常：' + e.message.slice(0, 120);
      console.log(`#${i + 1} 失败：${e.message.slice(0, 80)}`);
    }
    rows.push(rec);
    await sleep(1200);
  }

  const played = rows.filter((r) => r.status === 'played').length;
  const dataset = {
    task: 'gsmp_academy',
    fetchedAt: new Date().toISOString(),
    params: { course: courseTitle, speed: 2, seconds_per_lesson: 5 },
    extra: { site: 'https://manage.giikin.com/fe/shop/wbw/video-learning', course: courseTitle, lessons: lessonCount, elapsedMs: Date.now() - started },
    total: played,
    totalPages: '-',
    pages: [{ page: 1, rows }],
  };
  await writeFile(`${OUT}/dataset.json`, JSON.stringify(dataset, null, 2), 'utf8');
  console.log(`\n完成：${played}/${lessonCount} 节课 2x 播放 5s，耗时 ${Math.round((Date.now() - started) / 1000)}s`);
} catch (e) {
  console.log('ERROR:', e.message);
  await writeFile(`${OUT}/dataset.json`, JSON.stringify({ task: 'gsmp_academy', error: e.message, pages: [{ page: 1, rows }] }, null, 2), 'utf8');
} finally {
  await browser.close();
}
