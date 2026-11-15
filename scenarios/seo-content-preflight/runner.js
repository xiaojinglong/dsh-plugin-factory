'use strict';
// seo-content-preflight —— 网站编辑/SEO 发布前检查（本地 fixture）
const fs = require('node:fs');
const path = require('node:path');

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new Error('页面数据为空');
  ctx.setProgress(`检查 ${rows.length} 个页面`);

  const out = rows.map((r) => {
    const issues = [];
    const titleLen = String(r.title || '').length;
    const metaLen = String(r.meta_description || '').length;
    if (titleLen < 30 || titleLen > 60) issues.push(`标题长度 ${titleLen}（建议 30–60）`);
    if (metaLen < 80 || metaLen > 160) issues.push(`Meta 长度 ${metaLen}（建议 80–160）`);
    if (Number(r.h1) !== 1) issues.push(`H1 数量 ${r.h1}（应为 1）`);
    if (Number(r.word_count) < 600) issues.push(`正文 ${r.word_count} 字（建议 ≥600）`);
    if (Number(r.images_missing_alt) > 0) issues.push(`${r.images_missing_alt} 张图缺 alt`);
    if (Number(r.internal_links) === 0) issues.push('无内链');
    if (Number(r.status_code) !== 200) issues.push(`HTTP ${r.status_code}`);
    if (Number(r.sensitive_words) > 0) issues.push(`敏感词 ${r.sensitive_words} 处`);
    const kd = Number(r.keyword_density);
    if (kd < 0.5 || kd > 2.5) issues.push(`关键词密度 ${kd}%（建议 0.5–2.5）`);
    let severity = 'P3';
    if (Number(r.status_code) !== 200 || Number(r.sensitive_words) > 0) severity = 'P1';
    else if (issues.length >= 3 || Number(r.h1) !== 1 || titleLen < 30) severity = 'P2';
    else if (issues.length) severity = 'P3';
    const score = Math.max(0, 100 - issues.length * 12 - (severity === 'P1' ? 20 : 0));
    return {
      url: r.url, title: r.title, title_len: titleLen, meta_len: metaLen, h1: r.h1,
      word_count: r.word_count, images_missing_alt: r.images_missing_alt,
      internal_links: r.internal_links, keyword: r.keyword, keyword_density: kd,
      status_code: r.status_code, severity, score,
      decision: severity === 'P1' ? '禁止发布' : severity === 'P2' ? '修改后发布' : '可发布',
      issues: issues.join('；') || '通过',
    };
  }).sort((a, b) => (a.severity > b.severity ? -1 : a.severity < b.severity ? 1 : a.score - b.score));

  const blocked = out.filter((x) => x.decision === '禁止发布');
  const fix = out.filter((x) => x.decision === '修改后发布');
  const avg = Math.round(out.reduce((s, x) => s + x.score, 0) / out.length);
  const dataset = {
    task: job.task || 'seo_content_preflight', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '内容发布前检查',
      columns: ['url', 'title', 'title_len', 'meta_len', 'h1', 'word_count', 'images_missing_alt', 'internal_links', 'keyword', 'keyword_density', 'status_code', 'severity', 'score', 'decision', 'issues'],
      labels: { url: 'URL', title: '标题', title_len: '标题长', meta_len: 'Meta 长', h1: 'H1', word_count: '字数', images_missing_alt: '缺 alt', internal_links: '内链', keyword: '关键词', keyword_density: '密度%', status_code: 'HTTP', severity: '风险', score: '得分', decision: '发布结论', issues: '问题' },
      summary: [
        { k: '页面数', v: out.length, s: '待发布/巡检' },
        { k: '禁止发布', v: blocked.length, s: 'P1' },
        { k: '修改后发布', v: fix.length, s: 'P2' },
        { k: '平均得分', v: avg, s: '满分 100' },
      ],
      conclusion: `检查 ${out.length} 个页面，${blocked.length} 个禁止发布，${fix.length} 个修改后发布，平均得分 ${avg}。`,
      recommendations: [
        'P1（404/敏感词）先修再发，避免收录与合规风险。',
        '标题/Meta/H1 按模板批量修正，优先处理流量页。',
        '图片 alt 与内链纳入编辑发布 checklist，减少复审。',
      ],
    },
    total: out.length, totalPages: 1, pages: [{ page: 1, rows: out }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'seo_content_preflight_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：禁止 ${blocked.length}，修改 ${fix.length}`);
}
module.exports = { runJob };
