'use strict';
// hr-resume-screen —— 简历筛选/面试安排（本地 fixture，可换成 ATS 导出的 JSON）
const fs = require('node:fs');
const path = require('node:path');
const norm = (s) => String(s || '').trim().toLowerCase();
const has = (skills, k) => (skills || []).some((s) => norm(s) === norm(k));

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const jd = data.job || {};
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  if (!candidates.length) throw new Error('candidates 为空');
  ctx.setProgress(`评估 ${candidates.length} 份简历`);

  const slots = Array.isArray(jd.slots) ? [...jd.slots] : [];
  const scored = candidates.map((c) => {
    const skills = c.skills || [];
    const must = jd.must_have || [];
    const nice = jd.nice_have || [];
    const missingMust = must.filter((m) => !has(skills, m));
    const matchedNice = nice.filter((m) => has(skills, m));
    const years = Number(c.years) || 0;
    const salary = Number(c.salary_expect) || 0;
    const locationOk = !jd.location || norm(c.location) === norm(jd.location);
    const salaryOk = !jd.max_salary || salary <= Number(jd.max_salary);
    let score = 35;
    score += must.length ? ((must.length - missingMust.length) / must.length) * 35 : 0;
    score += Math.min(8, years) * 2.5;
    score += matchedNice.length * 5;
    if (locationOk) score += 5;
    if (c.availability === '随时' || c.availability === '两周内') score += 3;
    score = Math.max(0, Math.min(100, Math.round(score)));
    let decision = 'shortlist';
    let reason = '';
    if (missingMust.length) { decision = 'reject'; reason = `缺硬性技能：${missingMust.join('、')}`; }
    else if (!salaryOk) { decision = 'hold'; reason = `期望薪资 ${salary} 超预算 ${jd.max_salary}`; }
    else if (!locationOk) { decision = 'hold'; reason = `地点不匹配：${c.location}`; }
    else if (years < Number(jd.min_years || 0)) { decision = 'reject'; reason = `经验 ${years} 年低于 ${jd.min_years} 年`; }
    return { ...c, score, decision, reason, missing_must: missingMust.join('、'), matched_nice: matchedNice.join('、') };
  }).sort((a, b) => b.score - a.score);

  const shortlist = scored.filter((c) => c.decision === 'shortlist');
  shortlist.forEach((c, i) => { c.interview_slot = slots[i] || '待排期'; });
  const rows = scored.map((c) => ({
    name: c.name, score: c.score, decision: c.decision, years: c.years,
    matched_nice: c.matched_nice, missing_must: c.missing_must,
    salary_expect: c.salary_expect, location: c.location,
    interview_slot: c.interview_slot || '', reason: c.reason,
  }));
  const avg = Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length);
  const dataset = {
    task: 'hr_resume_screen', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: `${jd.title || '岗位'}简历筛选`,
      columns: ['name', 'score', 'decision', 'years', 'missing_must', 'matched_nice', 'salary_expect', 'location', 'interview_slot', 'reason'],
      labels: { name: '候选人', score: '匹配分', decision: '结论', years: '经验(年)', missing_must: '缺硬性技能', matched_nice: '加分技能', salary_expect: '期望薪资', location: '地点', interview_slot: '面试时段', reason: '原因' },
      summary: [
        { k: '简历数', v: scored.length, s: '本地 fixture' },
        { k: '进入面试', v: shortlist.length, s: `${slots.length} 个时段` },
        { k: '待定/淘汰', v: scored.filter((c) => c.decision !== 'shortlist').length, s: '需人工复核' },
        { k: '平均匹配分', v: avg, s: '满分 100' },
      ],
      conclusion: `${jd.title || '岗位'}共评估 ${scored.length} 份简历，${shortlist.length} 人进入面试，${scored.filter((c) => c.decision === 'hold').length} 人待定，${scored.filter((c) => c.decision === 'reject').length} 人淘汰。`,
      recommendations: [
        '优先约面匹配分最高且可快速到岗的候选人，避免名额被竞品锁定。',
        '对“待定”候选人先确认薪资/地点，再决定是否占用面试时段。',
        '淘汰原因回写到 ATS，便于后续人才库复用与招聘漏斗分析。',
      ],
    },
    total: scored.length, totalPages: 1, pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'hr_resume_screen_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：${shortlist.length}/${scored.length} 进入面试`);
}
module.exports = { runJob };
