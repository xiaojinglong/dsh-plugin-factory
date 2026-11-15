'use strict';
// boss-candidate-score —— 候选人 CSV/JSON 过滤、关键词评分、排名报告
const fs = require('node:fs');
const path = require('node:path');

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const jobCfg = data.job || {};
  const list = Array.isArray(data.candidates) ? data.candidates : [];
  if (!list.length) throw new Error('candidates 为空');
  ctx.setProgress(`评分 ${list.length} 位候选人`);

  const keywords = jobCfg.keywords || [];
  const rows = list.map((c) => {
    const skills = c.skills || [];
    const matched = keywords.filter((k) => skills.some((s) => String(s).toLowerCase().includes(String(k).toLowerCase())));
    const filterReason = [];
    if (Number(c.age) > Number(jobCfg.age_max || 999)) filterReason.push(`年龄 ${c.age} 超 ${jobCfg.age_max}`);
    if (Number(c.salary_expect) > Number(jobCfg.salary_max || 1e9)) filterReason.push(`薪资 ${c.salary_expect} 超 ${jobCfg.salary_max}`);
    if (/暂不|不考虑|已入职/.test(String(c.status))) filterReason.push(`求职状态：${c.status}`);
    const domainOk = /跨境/.test(String(c.domain));
    const statusBonus = /随时/.test(String(c.status)) ? 8 : /月内/.test(String(c.status)) ? 5 : 2;
    const score = Math.round(matched.length * 12 + Math.min(10, Number(c.years) || 0) * 2.5 + statusBonus + (domainOk ? 8 : 0));
    return {
      name: c.name, age: c.age, years: c.years, salary_expect: c.salary_expect,
      status: c.status, domain: c.domain, matched: matched.join('、'),
      score, decision: filterReason.length ? '过滤' : '通过', filter_reason: filterReason.join('；') || '',
      link: c.link,
    };
  }).sort((a, b) => (a.decision === b.decision ? b.score - a.score : a.decision === '通过' ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });

  const pass = rows.filter((x) => x.decision === '通过');
  const reportRows = pass.slice(0, 15);
  const dataset = {
    task: job.task || 'boss_candidate_score', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: `${jobCfg.title || '岗位'}候选人评分`,
      columns: ['rank', 'name', 'score', 'decision', 'matched', 'age', 'years', 'salary_expect', 'status', 'domain', 'filter_reason', 'link'],
      labels: { rank: '排名', name: '姓名', score: '评分', decision: '结论', matched: '命中关键词', age: '年龄', years: '经验', salary_expect: '期望薪资', status: '求职状态', domain: '领域', filter_reason: '过滤原因', link: '链接' },
      summary: [
        { k: '候选人', v: rows.length, s: '原始' },
        { k: '通过', v: pass.length, s: `保留 ${Math.round((pass.length / rows.length) * 100)}%` },
        { k: '报告人数', v: reportRows.length, s: 'Top 15' },
        { k: '平均分', v: Math.round(pass.reduce((s, x) => s + x.score, 0) / Math.max(1, pass.length)), s: '通过者' },
      ],
      conclusion: `评分 ${rows.length} 人，${pass.length} 人通过硬性过滤（${Math.round((pass.length / rows.length) * 100)}%），报告展示 Top ${reportRows.length}；每人保留可点击链接。`,
      recommendations: [
        '先按年龄/薪资/求职状态硬过滤，再按关键词+经验排序。',
        'Top 15 优先跟进；被过滤者保留原因，便于复盘。',
        '报告中的链接用于人工复核，不自动群发。',
      ],
    },
    total: rows.length, totalPages: 1, pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'boss_candidate_score_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：通过 ${pass.length}/${rows.length}`);
}
module.exports = { runJob };
