'use strict';
// cs-ticket-triage —— 客服工单分诊/SLA/回复建议（本地 fixture）
const fs = require('node:fs');
const path = require('node:path');
const SLA = { P1: 2, P2: 8, P3: 24 };
const hours = (a, b) => (new Date(b) - new Date(a)) / 3600000;
const rules = [
  { intent: '退款/售后', re: /退款|退货|破损|少发|缺件|赔偿/i, reply: '已收到您的售后申请，我们会在 24 小时内给出处理方案，请保留外包装与照片。' },
  { intent: '物流异常', re: /物流|快递|没更新|包裹|清关|派送/i, reply: '已为您核查物流节点，若 48 小时无更新将主动为您补发或退款。' },
  { intent: '账号安全', re: /被盗|冻结|登录|地址被改|安全/i, reply: '已触发账号安全流程，请立即修改密码并开启二次验证，我们同步冻结异常会话。' },
  { intent: '产品咨询', re: /怎么用|安装|说明书|尺码|适配|功能/i, reply: '已为您整理使用/安装说明，若仍无法解决可安排远程指导。' },
  { intent: '发票/财务', re: /发票|抬头|税号|退款到账/i, reply: '已登记您的票据/到账查询，财务会在 1 个工作日内回复。' },
];
async function runJob(job, ctx) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data.json'), 'utf8'));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new Error('工单数据为空');
  ctx.setProgress(`分诊 ${rows.length} 个工单`);

  const out = rows.map((r) => {
    const rule = rules.find((x) => x.re.test(`${r.subject} ${r.message}`)) || { intent: '其他', reply: '已收到，我们会尽快人工跟进。' };
    const age = hours(r.created_at, r.first_reply_at || new Date().toISOString());
    const limit = SLA[r.priority] || 24;
    const breached = age > limit;
    const angry = /生气|投诉|差评|骗子|垃圾|愤怒|曝光/i.test(`${r.subject} ${r.message}`);
    const highValue = Number(r.order_value) >= 100;
    let severity = 'P3';
    if (breached && (r.priority === 'P1' || angry || highValue)) severity = 'P1';
    else if (breached || angry || r.priority === 'P1') severity = 'P2';
    return {
      ticket_id: r.ticket_id, customer: r.customer, channel: r.channel, priority: r.priority,
      intent: rule.intent, severity, sla_limit_h: limit,
      first_reply_h: Math.round(age * 10) / 10, sla_status: breached ? '超时' : '达标',
      order_value: r.order_value, angry: angry ? '是' : '否',
      suggested_reply: rule.reply, escalate: severity === 'P1' ? '立即升级主管' : severity === 'P2' ? '当班组长复核' : '按话术回复',
    };
  }).sort((a, b) => (a.severity > b.severity ? -1 : a.severity < b.severity ? 1 : b.first_reply_h - a.first_reply_h));

  const breached = out.filter((x) => x.sla_status === '超时');
  const p1 = out.filter((x) => x.severity === 'P1');
  const dataset = {
    task: job.task || 'cs_ticket_triage', fetchedAt: new Date().toISOString(), params: ctx.params || {},
    extra: {
      title: '客服工单分诊',
      columns: ['ticket_id', 'customer', 'channel', 'priority', 'intent', 'severity', 'sla_limit_h', 'first_reply_h', 'sla_status', 'order_value', 'escalate', 'suggested_reply'],
      labels: { ticket_id: '工单', customer: '客户', channel: '渠道', priority: '优先级', intent: '意图', severity: '风险', sla_limit_h: 'SLA(h)', first_reply_h: '首响(h)', sla_status: 'SLA', order_value: '订单额', escalate: '升级', suggested_reply: '建议回复' },
      summary: [
        { k: '工单数', v: out.length, s: '多渠道路由' },
        { k: 'SLA 超时', v: breached.length, s: '需优先处理' },
        { k: 'P1 风险', v: p1.length, s: '升级主管' },
        { k: '高价值工单', v: out.filter((x) => Number(x.order_value) >= 100).length, s: '≥100' },
      ],
      conclusion: `共 ${out.length} 个工单，${breached.length} 个 SLA 超时，${p1.length} 个 P1 需立即升级。`,
      recommendations: [
        'P1 工单按“超时+情绪+订单额”排序，先回后升级，避免差评。',
        '物流/售后意图可接自动回复，账号安全必须人工二次确认。',
        '把首响时长按渠道拆分，找出 SLA 的系统性瓶颈。',
      ],
    },
    total: out.length, totalPages: 1, pages: [{ page: 1, rows: out }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'cs_ticket_triage_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：SLA 超时 ${breached.length}，P1 ${p1.length}`);
}
module.exports = { runJob };
