'use strict';
// admin-asset-audit —— 固定资产盘点/维保/责任归属（本地 fixture）
const fs = require('node:fs');
const path = require('node:path');
const DAY = 86400000;
const today = () => new Date('2026-11-15T00:00:00Z');

async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new Error('资产数据为空');
  ctx.setProgress(`盘点 ${rows.length} 项资产`);

  const seen = new Map();
  const out = rows.map((r, i) => {
    const issues = [];
    const id = String(r.asset_id || '');
    if (!id) issues.push('缺少资产编号');
    if (!r.owner) issues.push('无责任人');
    if (!r.category) issues.push('缺分类');
    if (id && seen.has(id)) issues.push(`资产编号重复（首次第 ${seen.get(id)} 行）`);
    else if (id) seen.set(id, i + 1);

    const warranty = r.warranty_end ? new Date(`${r.warranty_end}T00:00:00Z`) : null;
    if (warranty && warranty < today()) issues.push('已过保');
    else if (warranty && (warranty - today()) / DAY <= 60) issues.push('60 天内过保');
    if (r.status === '已报废' && r.owner) issues.push('已报废仍挂责任人');
    if (r.status === '在用' && !r.owner) issues.push('在用但无责任人');
    if (r.purchase_date) {
      const years = (today() - new Date(`${r.purchase_date}T00:00:00Z`)) / (DAY * 365);
      if (years >= 3) issues.push('已提足 3 年折旧');
    }
    const last = r.last_check ? new Date(`${r.last_check}T00:00:00Z`) : null;
    if (!last || (today() - last) / DAY > 180) issues.push('超 180 天未盘点');

    let severity = 'P3';
    if (issues.some((x) => /重复|无责任人|缺少资产编号/.test(x))) severity = 'P1';
    else if (issues.some((x) => /过保|维修中|报废/.test(x))) severity = 'P2';
    return {
      asset_id: id, name: r.name, category: r.category, owner: r.owner || '未登记',
      location: r.location, status: r.status, cost: r.cost, warranty_end: r.warranty_end,
      last_check: r.last_check, severity, issue_count: issues.length, issues: issues.join('；') || '正常',
    };
  }).sort((a, b) => (a.severity > b.severity ? -1 : a.severity < b.severity ? 1 : b.issue_count - a.issue_count));

  const abnormal = out.filter((x) => x.issue_count > 0);
  const p1 = out.filter((x) => x.severity === 'P1');
  const totalCost = out.reduce((s, x) => s + Number(x.cost || 0), 0);
  const dataset = {
    task: job.task || 'admin_asset_audit', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '固定资产盘点',
      columns: ['asset_id', 'name', 'category', 'owner', 'location', 'status', 'cost', 'warranty_end', 'last_check', 'severity', 'issues'],
      labels: { asset_id: '资产编号', name: '名称', category: '分类', owner: '责任人', location: '位置', status: '状态', cost: '原值', warranty_end: '保修到期', last_check: '最近盘点', severity: '风险级', issues: '问题' },
      summary: [
        { k: '资产数', v: out.length, s: '含重复编号' },
        { k: '异常项', v: abnormal.length, s: '需行政处理' },
        { k: 'P1 责任/编号', v: p1.length, s: '优先修正' },
        { k: '资产原值', v: `¥${totalCost.toLocaleString('zh-CN')}`, s: '账面合计' },
      ],
      conclusion: `盘点 ${out.length} 项资产，${abnormal.length} 项存在异常，其中 ${p1.length} 项为责任/编号类 P1。`,
      recommendations: [
        '先处理无责任人/重复编号，避免盘点差异无法追责。',
        '60 天内过保设备统一续保或安排替换，避免停机。',
        '对超 180 天未盘点资产发起线上盘点任务并留痕。',
      ],
    },
    total: out.length, totalPages: 1, pages: [{ page: 1, rows: out }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'admin_asset_audit_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：异常 ${abnormal.length} 项`);
}
module.exports = { runJob };
