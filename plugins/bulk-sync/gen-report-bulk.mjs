// gen-report-bulk.mjs —— 订单批量同步（模拟）报告：验证「分页 + 重试 + 进度 + 取消」链路
// 用法：node gen-report-bulk.mjs [dataset.json]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shell, table, distTable, top, pct, esc, n, sum } from '../../factory-kit/report-kit.mjs';
import { resolveDataset, rowsOf } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = 'D:/www/dsh-plugin-factory/plugins/bulk-sync';
const OUT = path.join(PLUGIN_DIR, 'report', 'bulk-sync-report.html');
const { ds, jobId = '', source } = await resolveDataset(PLUGIN_DIR);
const rows = rowsOf(ds);
if (!rows.length) {
  console.error('[SKIP] 数据集为空（0 条）：不生成报告，保留旧报告。');
  process.exit(2);
}
const total = Number(ds.total ?? rows.length);
const fetchedAt = ds.fetchedAt || '';
const jobLabel = jobId || path.basename(path.dirname(source || ''));
const p = ds.params || {};
const extra = ds.extra || {};
const pages = Array.isArray(ds.pages) ? ds.pages : [];

const amount = (r) => n(r.amount);
const refunded = rows.filter((r) => String(r.status).toUpperCase() === 'REFUNDED');
const amountSum = sum(rows, amount);
const amountAvg = rows.length ? amountSum / rows.length : 0;
const dupOrder = rows.length - new Set(rows.map((r) => r.order_id)).size;
const badAmount = rows.filter((r) => !Number.isFinite(Number(r.amount)) || Number(r.amount) <= 0);
const missingField = rows.filter((r) => !r.order_id || !r.site || !r.status);
const bands = [
  ['< 20', rows.filter((r) => amount(r) < 20).length],
  ['20–49.99', rows.filter((r) => amount(r) >= 20 && amount(r) < 50).length],
  ['50–99.99', rows.filter((r) => amount(r) >= 50 && amount(r) < 100).length],
  ['≥ 100', rows.filter((r) => amount(r) >= 100).length],
];
const topOrders = [...rows].sort((a, b) => amount(b) - amount(a)).slice(0, 10);

const body = `
<section><h2>一、结论摘要</h2><ul>
  <li>本次拉取 <b>${pages.length} 页 / ${rows.length} 条</b>订单，模拟上游总量 <b>${total}</b>，样本覆盖率 <b>${pct(rows.length, total)}%</b>。</li>
  <li>订单金额合计 <b>$${amountSum.toFixed(2)}</b>，客单均值 <b>$${amountAvg.toFixed(2)}</b>；状态分布见 §三。</li>
  <li>数据质量：重复 <code>order_id</code> <b>${dupOrder}</b> 条、金额非法 <b>${badAmount.length}</b> 条、关键字段缺失 <b>${missingField.length}</b> 条（详见 §四）。</li>
  <li>本插件用于验证工厂 API 执行层的「分页 / 瞬态失败自动重试 / 进度 / 取消 / 空数据」可靠性，数据为内置模拟上游生成，不代表真实业务。</li>
</ul></section>

<section><h2>二、数据口径</h2><table><tbody>
  <tr><th>数据来源</th><td>本插件内置模拟上游 <code>POST /mock/orders</code>（127.0.0.1 随机端口，不访问外部系统）</td></tr>
  <tr><th>执行层</th><td><code>platform/runtime/runner-api.js</code>：逐页请求、每页失败自动重试 1 次、每页检查 <code>ctx.isAborted()</code></td></tr>
  <tr><th>生效参数</th><td><code>pages=${pages.length}</code>、<code>pageSize=${esc(p.pageSize || '-')}</code>、<code>total_rows=${esc(p.total_rows ?? '-')}</code>、<code>delay_ms=${esc(p.delay_ms ?? '-')}</code>、<code>fail_first_n=${esc(p.fail_first_n ?? 0)}</code></td></tr>
  <tr><th>分页协议</th><td><code>{code:200,data:{list,pagination:{total,totalPages,page,pageSize}}}</code>；空结果 <code>list=[]</code></td></tr>
  <tr><th>样本覆盖</th><td>${rows.length}/${total} 条（${pct(rows.length, total)}%），${pages.length} 页；模拟上游服务端记录 <code>servedAt=${esc(extra.servedAt || '-')}</code></td></tr>
  <tr><th>金额口径</th><td><code>amount</code> 原样取自模拟行，单位为美元，不做汇率换算</td></tr>
</tbody></table></section>

<section><h2>三、结构分布</h2><div class="grid2">
  <div><h3>按站点</h3>${distTable(['站点', '订单数', '占比', '分布'], top(rows, (r) => r.site), rows.length)}
  <h3>按订单状态</h3>${distTable(['状态', '订单数', '占比', '分布'], top(rows, (r) => r.status), rows.length)}</div>
  <div><h3>按店铺</h3>${distTable(['店铺', '订单数', '占比', '分布'], top(rows, (r) => r.shop_id), rows.length)}
  <h3>按金额档位</h3>${distTable(['金额（USD）', '订单数', '占比', '分布'], bands, rows.length)}</div>
</div></section>

<section><h2>四、风险与异常</h2>
<ul>
  <li>退款订单 <b>${refunded.length}</b> 条，金额合计 <b>$${sum(refunded, amount).toFixed(2)}</b>（${pct(refunded.length, rows.length)}%）；如需核对收入应剔除退款单。</li>
  <li>重复主键 <b>${dupOrder}</b> 条（模拟上游按连续序号生成，正常应为 0）。</li>
  <li>金额 ≤0 或非数字 <b>${badAmount.length}</b> 条；关键字段缺失 <b>${missingField.length}</b> 条。</li>
  <li>失败重试：本任务 <code>fail_first_n=${esc(p.fail_first_n ?? 0)}</code>；若大于 0，说明执行层在首轮 500 后自动重试成功，任务仍为 <code>done</code>。</li>
</ul>
${table(['#', 'order_id', '站点', '店铺', '金额', '状态', '下单时间'], topOrders.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.order_id)}</td><td>${esc(r.site)}</td><td>${esc(r.shop_id)}</td><td class="num">$${amount(r).toFixed(2)}</td><td>${esc(r.status)}</td><td>${esc(String(r.created_at).slice(0, 19).replace('T', ' '))}</td></tr>`))}
<p class="note">上表为大额 Top10，用于抽查；全样本见 §七。</p></section>

<section><h2>五、优化建议</h2><ul>
  <li><b>业务侧</b>：按站点 × 状态拆分退款率与客单价，退款单不并入收入；对大额订单抽样核对。</li>
  <li><b>可靠性侧</b>：本插件已验证「N 页分页 + 首轮 500 自动重试 + 运行中取消 + 空数据 done」；建议在真实 API 插件沿用相同 <code>runner-api</code> 配置，不要各写一份 fetch 循环。</li>
  <li><b>可观测性</b>：重试次数目前未写入 dataset，只能通过日志核对；如需报告展示，应在执行层补充 <code>retryCount</code>（列入后续改进）。</li>
</ul></section>

<section><h2>六、限制与未决</h2><ul>
  <li><b>数据性质</b>：全部订单由内置模拟上游确定性生成，<b>不是真实业务数据</b>，结论仅用于验证工厂链路。</li>
  <li><b>采样</b>：最多拉取 <code>maxPages=8</code> 页；本次 ${pages.length} 页覆盖 ${pct(rows.length, total)}%，未覆盖部分不在统计内。</li>
  <li><b>重试信息</b>：<code>runner-api</code> 的自动重试未落盘重试次数，报告无法区分"一次成功"与"重试后成功"（日志可查）。</li>
  <li><b>并发</b>：服务端任务队列为单 worker 串行；并发提交会排队，报告对应任务本身的数据，不受其它任务影响。</li>
  <li><b>只读边界</b>：本插件不写任何外部系统。</li>
</ul></section>

<section><h2>七、附录</h2>
<h3>7.1 任务与产物</h3><table><tbody>
  <tr><th>任务</th><td><code>${esc(jobLabel)}</code> · 取数时间 ${esc(fetchedAt || '未记录')}</td></tr>
  <tr><th>数据集</th><td><code>${esc(source)}</code></td></tr>
  <tr><th>契约</th><td><code>10-标准产物契约.md</code>：<code>task/fetchedAt/params/extra/total/totalPages/pages[].rows[]</code></td></tr>
</tbody></table>
<h3>7.2 全样本明细（${rows.length} 条）</h3>
${table(['order_id', 'shop', '站点', '买家国家', '金额', '状态', '行数', '下单时间'], rows.map((r) => `<tr><td>${esc(r.order_id)}</td><td>${esc(r.shop_id)}</td><td>${esc(r.site)}</td><td>${esc(r.buyer_country)}</td><td class="num">$${amount(r).toFixed(2)}</td><td>${esc(r.status)}</td><td class="num">${n(r.line_items)}</td><td>${esc(String(r.created_at).slice(0, 19).replace('T', ' '))}</td></tr>`))}
</section>

<section><h2>八、生成信息</h2><p>插件 <code>bulk-sync</code> · taskType <code>bulk_sync</code> · 模拟上游（内置）· 单文件 HTML（内联 CSS、可离线打开）· 报告由 <code>gen-report-bulk.mjs</code> 生成，空数据时退出码 2 且不覆盖旧报告。</p></section>`;

await writeFile(OUT, shell({
  title: '订单批量同步报告（模拟）',
  meta: [
    '业务：bulk-sync',
    '数据源：内置模拟上游 /mock/orders',
    `任务：${jobLabel}`,
    `取数时间：${fetchedAt || '未记录'}`,
    `样本：${rows.length}/${total}`,
  ],
  kpis: [
    { k: '样本订单', v: rows.length, s: `全量 ${total} · 覆盖 ${pct(rows.length, total)}%` },
    { k: '金额合计', v: `$${amountSum.toFixed(2)}`, s: `客单均值 $${amountAvg.toFixed(2)}` },
    { k: '退款单', v: refunded.length, s: `占样本 ${pct(refunded.length, rows.length)}%`, color: '#d97706' },
    { k: '重复主键', v: dupOrder, s: '正常应为 0', color: dupOrder ? '#dc2626' : '#059669' },
    { k: '页数', v: pages.length, s: `pageSize ${esc(p.pageSize || '-')}` },
  ],
  body,
  footer: `bulk-sync 插件 · 任务 ${jobLabel} · 取数 ${fetchedAt || '未记录'}`,
}), 'utf8');
console.log('报告已生成:', OUT, '| rows:', rows.length, '| total:', total, '| pages:', pages.length);
