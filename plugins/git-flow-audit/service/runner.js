'use strict';
// git-flow-audit —— Issue→分支→commit→PR→CI→合并 完整性审计
const fs = require('node:fs');
const path = require('node:path');

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const issues = Array.isArray(data.issues) ? data.issues : [];
  if (!issues.length) throw new Error('issues 为空');
  ctx.setProgress(`审计 ${issues.length} 个 Issue`);

  const rows = issues.map((it) => {
    const problems = [];
    const id = it.id;
    if (!it.acceptance) problems.push('缺验收标准');
    if (!it.branch) problems.push('缺分支');
    if (!(it.commits || []).some((c) => String(c).includes(`#${id}`))) problems.push('commit 未关联 Issue');
    if (!it.pr) problems.push('缺 PR');
    else {
      if (!String(it.pr.closes || '').includes(`#${id}`)) problems.push('PR 未 Closes Issue');
      if (!it.pr.reviewer) problems.push('缺审查人');
    }
    if (it.ci?.test !== 'pass' || it.ci?.lint !== 'pass') problems.push(`CI 未全绿（test=${it.ci?.test || '-'} lint=${it.ci?.lint || '-'}）`);
    if (!it.merged) problems.push('未合并');
    if (!it.branch_deleted) problems.push('分支未删除');
    let severity = 'P3';
    if (problems.some((x) => /缺分支|缺 PR|CI|未合并|commit/.test(x))) severity = 'P1';
    else if (problems.some((x) => /验收|Closes|审查人/.test(x))) severity = 'P2';
    return {
      issue: id, title: it.title, branch: it.branch || '',
      pr: it.pr?.number || '', ci: `${it.ci?.test || '-'}/${it.ci?.lint || '-'}`,
      merged: it.merged ? '是' : '否', branch_deleted: it.branch_deleted ? '是' : '否',
      severity, problem_count: problems.length, problems: problems.join('；') || '通过',
      decision: problems.length ? '不通过' : '通过',
    };
  }).sort((a, b) => (a.severity > b.severity ? -1 : a.severity < b.severity ? 1 : b.problem_count - a.problem_count));

  const pass = rows.filter((x) => x.decision === '通过');
  const ciGreen = rows.filter((x) => x.ci === 'pass/pass').length;
  const dataset = {
    task: job.task || 'git_flow_audit', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: 'Git 工作流审计',
      columns: ['issue', 'title', 'branch', 'pr', 'ci', 'merged', 'branch_deleted', 'severity', 'problem_count', 'problems', 'decision'],
      labels: { issue: 'Issue', title: '标题', branch: '分支', pr: 'PR', ci: 'test/lint', merged: '已合并', branch_deleted: '分支已删', severity: '级别', problem_count: '问题数', problems: '问题', decision: '结论' },
      summary: [
        { k: 'Issue 数', v: rows.length, s: '需求数' },
        { k: '流程通过', v: pass.length, s: '可交付' },
        { k: 'CI 全绿', v: ciGreen, s: 'test+lint' },
        { k: '不通过', v: rows.length - pass.length, s: '需返工' },
      ],
      conclusion: `审计 ${rows.length} 个 Issue，${pass.length} 个走完 Issue→分支→PR→CI→合并；CI 全绿 ${ciGreen} 个。`,
      recommendations: [
        'P1 先补分支/PR/CI/合并，缺任何一环都不能算交付。',
        'commit 与 PR 必须带 Issue 号，保证需求-代码-合并可追溯。',
        '合并后删分支，避免陈旧分支干扰后续审计。',
      ],
    },
    total: rows.length, totalPages: 1, pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'git_flow_audit_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：通过 ${pass.length}/${rows.length}`);
}
module.exports = { runJob };
