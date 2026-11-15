'use strict';
// assistant-account-audit —— 账号助理：账号资产/权限/安全审计（本地 fixture）
const fs = require('node:fs');
const path = require('node:path');

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new Error('账号数据为空');
  ctx.setProgress(`审计 ${rows.length} 个账号`);

  const out = rows.map((r) => {
    const issues = [];
    if (!r.owner) issues.push('无负责人');
    if (r.owner && /离职|外部/.test(String(r.owner))) issues.push(`负责人异常：${r.owner}`);
    if (r.admin) issues.push('管理员权限');
    if (!r.two_factor) issues.push('未开 2FA');
    if (Number(r.password_age_days) > 90) issues.push(`密码 ${r.password_age_days} 天未换`);
    if (Number(r.last_login_days) > 60) issues.push(`${r.last_login_days} 天未登录`);
    if (r.shared) issues.push('多人共用');
    if (r.status === 'locked') issues.push('账号锁定');
    let severity = 'P3';
    if (issues.some((x) => /无负责人|负责人异常|未开 2FA|共用|管理员/.test(x))) severity = 'P1';
    else if (issues.some((x) => /未登录|密码/.test(x))) severity = 'P2';
    const risk = Math.min(100, issues.length * 18 + (r.admin ? 10 : 0));
    return {
      platform: r.platform, account: r.account, owner: r.owner || '未登记', admin: r.admin ? '是' : '否',
      two_factor: r.two_factor ? '是' : '否', password_age_days: r.password_age_days,
      last_login_days: r.last_login_days, shared: r.shared ? '是' : '否', status: r.status,
      risk, severity, issues: issues.join('；') || '正常',
      action: severity === 'P1' ? '立即收口权限/补 2FA' : severity === 'P2' ? '本周改密/清理' : '保持',
    };
  }).sort((a, b) => (a.severity > b.severity ? -1 : a.severity < b.severity ? 1 : b.risk - a.risk));

  const p1 = out.filter((x) => x.severity === 'P1');
  const admin = out.filter((x) => x.admin === '是');
  const shared = out.filter((x) => x.shared === '是');
  const dataset = {
    task: 'assistant_account_audit', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '账号资产与权限审计',
      columns: ['platform', 'account', 'owner', 'admin', 'two_factor', 'password_age_days', 'last_login_days', 'shared', 'status', 'risk', 'severity', 'issues', 'action'],
      labels: { platform: '平台', account: '账号', owner: '负责人', admin: '管理员', two_factor: '2FA', password_age_days: '密码天数', last_login_days: '未登录天数', shared: '共用', status: '状态', risk: '风险分', severity: '级别', issues: '问题', action: '动作' },
      summary: [
        { k: '账号数', v: out.length, s: '多平台' },
        { k: 'P1 风险', v: p1.length, s: '立即处理' },
        { k: '管理员账号', v: admin.length, s: '权限收敛' },
        { k: '共用账号', v: shared.length, s: '需拆分' },
      ],
      conclusion: `审计 ${out.length} 个账号，${p1.length} 个 P1，${admin.length} 个管理员账号，${shared.length} 个共用账号。`,
      recommendations: [
        'P1 先处理无负责人/共用/未开 2FA 的账号，尤其是广告与邮箱。',
        '管理员账号单独清单化，按最小权限原则收敛。',
        '密码>90 天、长期不登录的账号统一改密或停用。',
      ],
    },
    total: out.length, totalPages: 1, pages: [{ page: 1, rows: out }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'assistant_account_audit_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：P1 ${p1.length}，管理员 ${admin.length}`);
}
module.exports = { runJob };
