'use strict';
// log-anomaly-audit —— 1M 级日志流式审计（NDJSON，只保留异常样本与聚合）
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

async function* readRecords(file) {
  // 小文件：支持 JSON 数组 / {rows:[]}（工厂 staging 用）
  const size = fs.statSync(file).size;
  if (size < 5 * 1024 * 1024) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const arr = Array.isArray(data) ? data : data.rows;
      if (Array.isArray(arr)) {
        for (const rec of arr) yield rec;
        return;
      }
    } catch { /* fall through to NDJSON */ }
  }
  // 大文件 / NDJSON：逐行流式
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { yield { __badLine: true }; }
  }
}

async function runJob(job, ctx) {
  const p = ctx.params || {};
  const maxAnomalies = Math.max(1, Math.min(5000, Number(p.max_anomalies) || 1000));
  const file = path.join(__dirname, '..', 'fixtures', 'data.json');
  if (!fs.existsSync(file)) throw new Error(`日志文件不存在：${file}`);

  let total = 0; let bad = 0; let anomalyCount = 0;
  const services = new Map();
  const anomalies = [];
  for await (const r of readRecords(file)) {
    total += 1;
    if (total % 100000 === 0) ctx.setProgress(`已读取 ${total} 行`);
    if (r.__badLine) { bad += 1; continue; }
    const svc = String(r.service || 'unknown');
    const s = services.get(svc) || { service: svc, total: 0, errors: 0, max_ms: 0 };
    s.total += 1;
    const status = Number(r.status) || 0;
    const latency = Number(r.latency_ms) || 0;
    if (String(r.level).toLowerCase() === 'error' || String(r.level).toLowerCase() === 'fatal' || status >= 500) s.errors += 1;
    if (latency > s.max_ms) s.max_ms = latency;
    services.set(svc, s);
    const anomaly = status >= 500 || latency >= 1000 || /error|fatal/i.test(String(r.level));
    if (!anomaly) continue;
    anomalyCount += 1;
    if (anomalies.length < maxAnomalies) {
      anomalies.push({
        ts: r.ts || '', service: svc, level: r.level || '', status,
        latency_ms: latency, message: String(r.message || '').slice(0, 120),
      });
    }
  }

  const rows = anomalies;
  const top = [...services.values()].sort((a, b) => b.errors - a.errors || b.total - a.total).slice(0, 5);
  const dataset = {
    task: job.task || 'log_anomaly_audit',
    fetchedAt: new Date().toISOString(),
    params: { max_anomalies: maxAnomalies },
    extra: {
      title: '日志异常审计（流式）',
      columns: ['ts', 'service', 'level', 'status', 'latency_ms', 'message'],
      labels: { ts: '时间', service: '服务', level: '级别', status: 'HTTP', latency_ms: '耗时ms', message: '消息' },
      summary: [
        { k: '总日志', v: total, s: '流式读取' },
        { k: '异常日志', v: anomalyCount, s: `样本 ${rows.length}` },
        { k: '坏行', v: bad, s: '跳过' },
        { k: '涉及服务', v: services.size, s: '聚合' },
      ],
      conclusion: `流式读取 ${total} 行，异常 ${anomalyCount} 条；报告保留前 ${rows.length} 条异常样本（上限 ${maxAnomalies}），坏行 ${bad}。`,
      recommendations: [
        `优先排查错误最多的服务：${top.map((x) => `${x.service}(${x.errors})`).join('、') || '无'}。`,
        '对 5xx/超 1s 的日志建立告警阈值，避免只看总量。',
        '坏行需在采集端修复；当前审计会跳过但不阻塞。',
      ],
    },
    total,
    totalPages: 1,
    pages: [{ page: 1, rows }],
  };
  await ctx.saveFile({ kind: 'main', fileName: 'log_anomaly_audit_dataset.json', content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.setProgress(`完成：${total} 行，异常 ${anomalyCount}，样本 ${rows.length}`);
}
module.exports = { runJob };
