'use strict';
// opt-keyword-gap —— SEO/优化师：关键词机会与内容缺口（本地 fixture）
const fs = require('node:fs');
const path = require('node:path');
const INTENT = { transactional: 1.3, commercial: 1.15, informational: 0.9, navigational: 0.6 };

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new Error('关键词数据为空');
  ctx.setProgress(`评估 ${rows.length} 个关键词`);

  const out = rows.map((r) => {
    const volume = Number(r.volume) || 0;
    const difficulty = Number(r.difficulty) || 0;
    const rank = Number(r.current_rank) || 100;
    const ctr = rank <= 3 ? 0.25 : rank <= 10 ? 0.12 : rank <= 20 ? 0.06 : 0.03;
    const clicks = Math.round(volume * ctr);
    const revenue = Math.round((clicks * (Number(r.conversion) || 0) / 100) * 50);
    const score = Math.round((volume / 100) * (INTENT[r.intent] || 0.8) * (1 - difficulty / 100) * (rank > 20 ? 1.3 : rank > 10 ? 1.1 : 0.8));
    let priority = 'P3';
    if (score >= 35 || (difficulty < 30 && rank > 10)) priority = 'P1';
    else if (score >= 18 || rank > 20) priority = 'P2';
    const action = rank > 20 ? '新建/重写落地页' : rank > 10 ? '内容更新+内链' : '保持并加转化组件';
    return {
      keyword: r.keyword, intent: r.intent, volume, difficulty, current_rank: rank,
      ctr: `${Math.round(ctr * 100)}%`, est_clicks: clicks, est_revenue: revenue,
      score, priority, page: r.page, action,
    };
  }).sort((a, b) => (a.priority > b.priority ? -1 : a.priority < b.priority ? 1 : b.score - a.score));

  const p1 = out.filter((x) => x.priority === 'P1');
  const p2 = out.filter((x) => x.priority === 'P2');
  const revenue = out.reduce((s, x) => s + x.est_revenue, 0);
  const dataset = {
    task: 'opt_keyword_gap', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '关键词机会与内容缺口',
      columns: ['keyword', 'intent', 'volume', 'difficulty', 'current_rank', 'ctr', 'est_clicks', 'est_revenue', 'score', 'priority', 'page', 'action'],
      labels: { keyword: '关键词', intent: '意图', volume: '月搜索', difficulty: '难度', current_rank: '当前排名', ctr: '预估CTR', est_clicks: '预估点击', est_revenue: '预估月收入', score: '机会分', priority: '优先级', page: '落地页', action: '动作' },
      summary: [
        { k: '关键词数', v: out.length, s: 'SEO 机会池' },
        { k: 'P1 机会', v: p1.length, s: '优先做' },
        { k: 'P2 机会', v: p2.length, s: '排期' },
        { k: '预估月收入', v: `¥${revenue.toLocaleString('zh-CN')}`, s: '按当前转化' },
      ],
      conclusion: `共 ${out.length} 个关键词，${p1.length} 个 P1、${p2.length} 个 P2；预估月收入 ¥${revenue.toLocaleString('zh-CN')}。`,
      recommendations: [
        'P1 先做“低难度+高意图”的词，用现有页面快速抢排名。',
        '排名 11–20 的词优先做内容更新+内链，投入产出最高。',
        '排名 20 名外的商业词评估新建落地页，避免只改旧文。',
      ],
    },
    total: out.length, totalPages: 1, pages: [{ page: 1, rows: out }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'opt_keyword_gap_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：P1 ${p1.length}，P2 ${p2.length}`);
}
module.exports = { runJob };
