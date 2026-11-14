// gen-report-fs.mjs —— 本地台账核对（文件系统型）报告
// 用法：node gen-report-fs.mjs [dataset.json]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shell, table, distTable, top, pct, esc, n } from '../../factory-kit/report-kit.mjs';
import { resolveDataset, rowsOf } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = 'D:/www/dsh-plugin-factory/plugins/fs-ledger';
const OUT = path.join(PLUGIN_DIR, 'report', 'fs-ledger-report.html');
const { ds, jobId = '', source } = await resolveDataset(PLUGIN_DIR);
const rows = rowsOf(ds);
if (!rows.length) {
  console.error('[SKIP] 数据集为空（0 条）：不生成报告，保留旧报告。');
  process.exit(2);
}
const total = Number(ds.total ?? rows.length);
const fetchedAt = ds.fetchedAt || '';
const jobLabel = jobId || path.basename(path.dirname(source || ''));
const extra = ds.extra || {};
const files = Array.isArray(extra.files) ? extra.files : [];

const RULE_LABEL = {
  MISSING_SKU: '缺少主键 SKU', DUPLICATE_SKU: 'SKU 重复', NEGATIVE_QTY: '数量为负', MISSING_QTY: '数量缺失/非法',
  MISSING_PRICE: '价格缺失/非法', NEGATIVE_PRICE: '价格为负', NEGATIVE_STOCK: '库存为负', SHORT_TITLE: '标题过短',
  MISSING_COLUMN: '缺少必需列', INVALID_JSON: 'JSON 解析失败', UNSUPPORTED_TYPE: '不支持的文件类型',
};
const levelRank = { P1: 0, P2: 1, P3: 2 };
const sorted = [...rows].sort((a, b) => (levelRank[a.level] ?? 9) - (levelRank[b.level] ?? 9) || String(a.file).localeCompare(String(b.file)) || n(a.row) - n(b.row));
const byFile = top(rows, (r) => r.file);
const byRule = top(rows, (r) => RULE_LABEL[r.rule] || r.rule);
const byLevel = top(rows, (r) => r.level);
const fileRow = (f) => `<tr><td><code>${esc(f.file)}</code></td><td>${esc(f.type || '-')}</td><td class="num">${n(f.rows)}</td>
<td class="num">${n(f.anomalies)}</td><td>${f.status === 'read' ? '<span class="tag t-ok">已解析</span>' : f.status === 'skipped' ? '<span class="tag t-mid">跳过</span>' : '<span class="tag t-high">不可读</span>'}</td></tr>`;
const anomalyRow = (r, i) => `<tr><td class="num">${i + 1}</td><td><span class="tag ${r.level === 'P1' ? 't-high' : r.level === 'P2' ? 't-mid' : 't-ok'}">${esc(r.level)}</span></td>
<td><code>${esc(r.file)}</code></td><td class="num">${n(r.row)}</td><td>${esc(r.sku || '—')}</td><td>${esc(RULE_LABEL[r.rule] || r.rule)}</td><td>${esc(r.detail)}</td></tr>`;

const body = `
<section><h2>一、结论摘要</h2><ul>
  <li>扫描 <code>inbox</code> 目录 <b>${n(extra.fileCount)}</b> 个文件，解析 <b>${files.filter((f) => f.status === 'read').length}</b> 个、跳过/不可读 <b>${n(extra.unreadable)}</b> 个，命中异常 <b>${rows.length}</b> 条。</li>
  <li>异常分布：${byRule.slice(0, 4).map(([k, v]) => `${esc(k)} ${v} 条`).join('、') || '无'}。</li>
  <li>P1 ${byLevel.find(([k]) => k === 'P1')?.[1] || 0} 条（主键缺失 / 负库存 / 负价格 / 坏文件），建议优先修复后再入账。</li>
  <li>本插件只读扫描本地目录，<b>不修改/删除任何文件</b>；数据为夹具示例。</li>
</ul></section>

<section><h2>二、数据口径</h2><table><tbody>
  <tr><th>执行层</th><td><code>plugins/fs-ledger/service/runner.js</code>（Node <code>fs</code>，只读）</td></tr>
  <tr><th>扫描目录</th><td><code>${esc(extra.inbox || '-')}</code>（可用 <code>INBOX_DIR</code> 覆盖）</td></tr>
  <tr><th>支持类型</th><td><code>.csv</code>（UTF-8，逗号分隔；orders 开头文件要求 sku/title/qty/price 四列）、<code>.json</code>（数组或单对象）；其它类型记为缺失项</td></tr>
  <tr><th>规则</th><td>主键非空/唯一、数量≥0、价格>0、库存≥0、标题长度、必需列、JSON 可解析</td></tr>
  <tr><th>缺失项</th><td>坏文件、缺列、不支持类型通过 runtime 的 <code>missingItems</code> 上报（见 §四）</td></tr>
</tbody></table></section>

<section><h2>三、结构分布</h2><div class="grid2">
  <div><h3>按文件</h3>${distTable(['文件', '异常数', '占比', '分布'], byFile, rows.length)}</div>
  <div><h3>按规则</h3>${distTable(['规则', '数量', '占比', '分布'], byRule, rows.length)}
  <h3>按级别</h3>${distTable(['级别', '数量', '占比', '分布'], byLevel, rows.length)}</div>
</div>
<h3>文件解析结果</h3>${table(['文件', '类型', '记录数', '异常数', '状态'], files.map(fileRow))}</section>

<section><h2>四、风险与异常</h2>
${table(['#', '级别', '文件', '行/序号', 'SKU', '规则', '说明'], sorted.map(anomalyRow))}
<p class="note">缺失项（<code>missingItems</code>）：${extra.unreadable ? '见任务结果接口；坏文件与不支持类型已逐条登记。' : '无。'}</p></section>

<section><h2>五、优化建议</h2><ul>
  <li><b>P1 先修</b>：补 SKU 主键、修正负库存/负价格、修复坏 JSON 与缺列文件，否则对账结果不可信。</li>
  <li><b>P2 去重与补价</b>：同 SKU 重复行需确认是否为多批次；价格缺失/非法需回填后再入账。</li>
  <li><b>P3 文案</b>：过短标题不影响账务，但影响检索；可按标题规范批量修正。</li>
  <li><b>机制</b>：把本插件接到每日定时任务，异常 >0 时先出报告再由人工确认，不自动改文件。</li>
</ul></section>

<section><h2>六、限制与未决</h2><ul>
  <li><b>夹具数据</b>：<code>inbox/</code> 下为演示文件（含故意构造的异常），不是真实台账。</li>
  <li><b>CSV 解析</b>：当前为简单逗号分隔，不支持引号内逗号/换行/编码探测；真实台账需升级解析器。</li>
  <li><b>规则覆盖</b>：仅做结构性与数值性校验，不含业务对账（如订单金额与支付流水匹配）。</li>
  <li><b>只读边界</b>：不修复、不移动、不删除文件；修复动作需人工或另建写操作插件（走四道闸）。</li>
  <li><b>空目录</b>：任务仍为 <code>done</code>，报告脚本 exit 2 且不覆盖旧报告。</li>
</ul></section>

<section><h2>七、附录</h2>
<h3>7.1 任务与产物</h3><table><tbody>
  <tr><th>任务</th><td><code>${esc(jobLabel)}</code> · 取数时间 ${esc(fetchedAt || '未记录')}</td></tr>
  <tr><th>数据集</th><td><code>${esc(source)}</code></td></tr>
  <tr><th>扫描耗时</th><td>${n(extra.elapsedMs)} ms</td></tr>
</tbody></table>
<h3>7.2 全量异常明细（${rows.length} 条）</h3>
${table(['#', '级别', '文件', '行/序号', 'SKU', '规则', '说明'], sorted.map(anomalyRow))}
</section>

<section><h2>八、生成信息</h2><p>插件 <code>fs-ledger</code> · taskType <code>fs_ledger</code> · 文件系统型（只读）· 单文件 HTML · 报告由 <code>gen-report-fs.mjs</code> 生成，空数据时退出码 2 且不覆盖旧报告。</p></section>`;

await writeFile(OUT, shell({
  title: '本地台账核对报告',
  meta: [
    '业务：fs-ledger',
    '数据源：本地 inbox 目录（只读）',
    `任务：${jobLabel}`,
    `取数时间：${fetchedAt || '未记录'}`,
    `文件：${n(extra.fileCount)}`,
  ],
  kpis: [
    { k: '扫描文件', v: n(extra.fileCount), s: `不可读/跳过 ${n(extra.unreadable)}` },
    { k: '异常条数', v: rows.length, s: `P1 ${byLevel.find(([k]) => k === 'P1')?.[1] || 0}`, color: rows.length ? '#d97706' : '#059669' },
    { k: 'P1（阻断）', v: byLevel.find(([k]) => k === 'P1')?.[1] || 0, s: '主键/负值/坏文件', color: '#dc2626' },
    { k: 'P2（重要）', v: byLevel.find(([k]) => k === 'P2')?.[1] || 0, s: '重复/缺价/数量', color: '#d97706' },
    { k: 'P3（提示）', v: byLevel.find(([k]) => k === 'P3')?.[1] || 0, s: '标题/类型', color: '#2563eb' },
  ],
  body,
  footer: `fs-ledger 插件 · 任务 ${jobLabel} · 取数 ${fetchedAt || '未记录'}`,
}), 'utf8');
console.log('报告已生成:', OUT, '| files:', n(extra.fileCount), '| anomalies:', rows.length);
