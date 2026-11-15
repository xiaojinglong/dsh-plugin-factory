'use strict';
// dev-repo-audit —— 代码仓库健康/密钥/TODO/测试/依赖风险（本地 fixture）
const fs = require('node:fs');
const path = require('node:path');

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new Error('仓库文件清单为空');
  ctx.setProgress(`扫描 ${rows.length} 个文件`);

  const out = rows.map((r) => {
    const issues = [];
    if (Number(r.secrets_hits) > 0) issues.push(`疑似密钥 ${r.secrets_hits} 处`);
    if (Number(r.size_kb) > 500) issues.push(`超大文件 ${r.size_kb}KB`);
    if (!r.has_test && /\.(js|cjs|ts|py)$/.test(r.path)) issues.push('无对应测试');
    if (String(r.license || '').toLowerCase() === 'none') issues.push('缺 License 头');
    if (Number(r.todos) >= 5) issues.push(`TODO ${r.todos} 处`);
    if (Number(r.last_commit_days) > 180) issues.push(`超 180 天未更新`);
    let severity = 'P3';
    if (Number(r.secrets_hits) > 0) severity = 'P1';
    else if (issues.length >= 3 || Number(r.todos) >= 5) severity = 'P2';
    else if (issues.length) severity = 'P3';
    return {
      path: r.path, language: r.language, lines: r.lines, size_kb: r.size_kb,
      todos: r.todos, secrets_hits: r.secrets_hits, has_test: r.has_test ? '有' : '无',
      license: r.license, last_commit_days: r.last_commit_days,
      severity, issue_count: issues.length, issues: issues.join('；') || '正常',
      action: severity === 'P1' ? '立即轮换密钥并清理历史' : severity === 'P2' ? '本迭代修复' : severity === 'P3' ? '排期优化' : '保持',
    };
  }).sort((a, b) => (a.severity > b.severity ? -1 : a.severity < b.severity ? 1 : b.issue_count - a.issue_count));

  const p1 = out.filter((x) => x.severity === 'P1');
  const p2 = out.filter((x) => x.severity === 'P2');
  const secrets = out.filter((x) => Number(x.secrets_hits) > 0);
  const dataset = {
    task: job.task || 'dev_repo_audit', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '代码仓库健康审计',
      columns: ['path', 'language', 'lines', 'size_kb', 'todos', 'secrets_hits', 'has_test', 'license', 'last_commit_days', 'severity', 'issues', 'action'],
      labels: { path: '文件', language: '语言', lines: '行数', size_kb: '大小KB', todos: 'TODO', secrets_hits: '疑似密钥', has_test: '测试', license: 'License', last_commit_days: '未更新天数', severity: '风险', issues: '问题', action: '动作' },
      summary: [
        { k: '文件数', v: out.length, s: '仓库抽样' },
        { k: 'P1 密钥', v: p1.length, s: '立即处理' },
        { k: 'P2 质量', v: p2.length, s: '本迭代' },
        { k: '疑似密钥文件', v: secrets.length, s: '需轮换' },
      ],
      conclusion: `扫描 ${out.length} 个文件，${p1.length} 个 P1、${p2.length} 个 P2；${secrets.length} 个文件疑似含密钥。`,
      recommendations: [
        'P1 立即轮换密钥并清理 Git 历史，不能只删当前文件。',
        '无测试的核心文件先补冒烟测试，再改逻辑。',
        '超大文件/旧代码加 owner 与下线计划，避免仓库继续膨胀。',
      ],
    },
    total: out.length, totalPages: 1, pages: [{ page: 1, rows: out }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'dev_repo_audit_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：P1 ${p1.length}，P2 ${p2.length}`);
}
module.exports = { runJob };
