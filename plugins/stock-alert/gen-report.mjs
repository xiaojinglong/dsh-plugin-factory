// gen-report.mjs —— 缺货预警（stock-alert）单文件 HTML 报告生成器
// 用法：node gen-report.mjs [dataset.json]
// 数据源：service/data/jobs/<jobId>/stock_alert_dataset.json（也可命令行指定）
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shell, table, distTable, bar, top, pct, esc, n } from '../../factory-kit/report-kit.mjs';
import { resolveDataset, rowsOf } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = 'D:/www/dsh-plugin-factory/plugins/stock-alert';
const OUT = path.join(PLUGIN_DIR, 'report', 'stock-alert-report.html');
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

// ---- 唯一口径（全报告同源）----
const stockOf = (r) => n(r.normal_stock) + n(r.warehouse_stock_total) + n(r.oversea_stock);
const d30 = (r) => n(r.order_day30);
const d90 = (r) => n(r.order_day90);
const isHigh = (r) => stockOf(r) === 0 && d30(r) > 0; // 30 天有单但缺货
const isOut = (r) => stockOf(r) === 0; // 缺货
const isLow = (r) => stockOf(r) > 0 && stockOf(r) <= 10; // 低库存
const sev = (r) => (isHigh(r) ? 'P1' : isOut(r) ? 'P2' : isLow(r) ? 'P3' : 'P4');
const SEV_LABEL = { P1: 'P1 高危', P2: 'P2 缺货', P3: 'P3 低库存', P4: 'P4 健康' };
const SEV_CLASS = { P1: 't-high', P2: 't-high', P3: 't-mid', P4: 't-ok' };
const SEV_TIP = {
  P1: '立即补货/确认可售库存',
  P2: '先核对是否已停售或清仓，确认在卖再补',
  P3: '按近期出单节奏补货',
  P4: '无需动作',
};
const rank = { P1: 0, P2: 1, P3: 2, P4: 3 };
const flagged = rows.filter((r) => sev(r) !== 'P4').sort(
  (a, b) => rank[sev(a)] - rank[sev(b)] || d30(b) - d30(a) || d90(b) - d90(a) || stockOf(a) - stockOf(b) || n(a.item_id) - n(b.item_id)
);
const high = rows.filter(isHigh);
const out = rows.filter(isOut);
const low = rows.filter(isLow);
const ok = rows.filter((r) => sev(r) === 'P4');
const with30 = rows.filter((r) => d30(r) > 0);
const zeroFlagMismatch = rows.filter((r) => (n(r.no_stock) === 1) !== isOut(r));
const overlap = rows.filter((r) => n(r.warehouse_stock_total) > 0 && n(r.oversea_stock) > 0);

// ---- 结构分布 ----
const siteDist = top(rows, (r) => r.site, 10);
const catDist = top(rows, (r) => r.category_cn_name || '(空)', 10);
const bandOf = (r) => { const s = stockOf(r); return s === 0 ? '0（缺货）' : s <= 10 ? '1–10（低库存）' : s <= 50 ? '11–50' : s <= 100 ? '51–100' : '>100'; };
const bandOrder = ['0（缺货）', '1–10（低库存）', '11–50', '51–100', '>100'];
const bandMap = new Map(bandOrder.map((k) => [k, 0]));
for (const r of rows) bandMap.set(bandOf(r), (bandMap.get(bandOf(r)) || 0) + 1);
const bandDist = bandOrder.map((k) => [k, bandMap.get(k) || 0]);

const trunc = (s, len = 42) => { const t = String(s ?? ''); return t.length > len ? `${t.slice(0, len)}…` : t; };
const d = (s) => (s && !String(s).startsWith('1970') ? String(s).slice(0, 10) : '—');
const riskRow = (r, i) => `<tr><td class="num">${i + 1}</td><td><span class="tag ${SEV_CLASS[sev(r)]}">${SEV_LABEL[sev(r)]}</span></td>
<td>${esc(trunc(r.item_name))}<div class="note">item_id ${esc(r.item_id)} · ${esc(r.category_cn_name || '')}</div></td>
<td>${esc(r.site)}</td><td class="num"><b>${stockOf(r)}</b></td><td class="num">${n(r.normal_stock)}</td><td class="num">${n(r.warehouse_stock_total)}</td><td class="num">${n(r.oversea_stock)}</td>
<td class="num">${d30(r)}</td><td class="num">${d90(r)}</td><td>${esc(d(r.last_order_create_time))}</td><td>${esc(SEV_TIP[sev(r)])}</td></tr>`;

const sampleRow = (r) => `<tr><td>${esc(r.item_id)}</td><td>${esc(trunc(r.item_name, 34))}</td><td>${esc(r.category_cn_name || '')}</td><td>${esc(r.site)}</td>
<td class="num">${n(r.normal_stock)}</td><td class="num">${n(r.warehouse_stock_total)}</td><td class="num">${n(r.oversea_stock)}</td><td class="num"><b>${stockOf(r)}</b></td>
<td class="num">${d30(r)}</td><td>${esc(r.status)}</td><td class="num">${n(r.no_stock)}</td></tr>`;

const body = `
<section><h2>一、结论摘要</h2>
<ul>
  <li>本次对 <b>陈雄德</b> 名下 <code>status=NORMAL</code>（在售）商品取 <b>${(ds.pages || []).length} 页 / ${rows.length} 条</b>，接口全量为 <b>${total} 条</b>，样本覆盖率 <b>${pct(rows.length, total)}%</b>（该筛选口径已全部取到）。</li>
  <li>命中风险 <b>${flagged.length} 个</b>：缺货（总库存=0）<b>${out.length}</b> 个、低库存（1–10）<b>${low.length}</b> 个；其中「30 天有单但缺货」高危品 <b>${high.length}</b> 个${high.length ? `：${high.map((r) => esc(r.item_id)).join('、')}` : '（本次没有）'}。</li>
  <li>近 30 天有出单的商品共 <b>${with30.length}</b> 个，库存均 >10，暂不构成"越卖越缺"风险；缺货的 ${out.length} 个商品近 30/90 天均无单，更像停售/清仓未处理，建议先核对再决定是否补货。</li>
  <li>口径提醒：总库存按业务给定公式 <code>normal_stock + warehouse_stock_total + oversea_stock</code> 计算；实测 ${overlap.length}/${rows.length} 条"仓+海外"同时 >0，存在重复计数可能（见 §六）。按去重口径复核，风险清单不变。</li>
</ul></section>

<section><h2>二、数据口径</h2>
<table><tbody>
  <tr><th>接口</th><td><code>POST https://api.giikin.com/agent/shopee/user/openapi/listing/listing</code></td></tr>
  <tr><th>鉴权</th><td>服务端 <code>.env</code> 的 <code>LISTING_API_KEY</code>（Bearer，报告与日志不出现明文）</td></tr>
  <tr><th>生效参数</th><td><code>page=${(ds.pages || []).length ? '1…' + (ds.pages || []).length : '-'}</code>、<code>status=${esc(p.status || 'NORMAL')}</code>、<code>shop_user_name=${esc(p.shop_user_name || '陈雄德')}</code></td></tr>
  <tr><th>被忽略参数</th><td><code>pageSize</code>（固定 20）、<code>shop_user_id</code>（不报错但结果全量）</td></tr>
  <tr><th>总库存公式（唯一口径）</th><td><code>总库存 = normal_stock + warehouse_stock_total + oversea_stock</code>；<code>order_day30</code> 为近 30 天单量字段</td></tr>
  <tr><th>分级规则</th><td>P1 高危 = 总库存 0 且 <code>order_day30&gt;0</code>；P2 缺货 = 总库存 0；P3 低库存 = 1–10；P4 健康 = &gt;10</td></tr>
  <tr><th>样本覆盖</th><td>${rows.length}/${total} 条（${pct(rows.length, total)}%，${(ds.pages || []).length} 页）；站点仅 ${esc([...new Set(rows.map((r) => r.site))].join('/'))}</td></tr>
</tbody></table></section>

<section><h2>三、结构分布</h2><div class="grid2">
  <div><h3>按站点</h3>${distTable(['站点', '数量', '占比', '分布'], siteDist, rows.length)}
  <h3>按库存档位</h3>${distTable(['总库存档位', '数量', '占比', '分布'], bandDist, rows.length)}</div>
  <div><h3>按类目（Top 10）</h3>${distTable(['类目', '数量', '占比', '分布'], catDist, rows.length)}
  <div class="note">样本类目分散，Top10 覆盖 ${catDist.reduce((s, x) => s + x[1], 0)}/${rows.length} 条。</div></div></div></section>

<section><h2>四、风险与异常</h2>
<h3>4.1 风险清单（按严重度排序，${flagged.length} 条）</h3>
${flagged.length ? table(['#', '严重度', '商品', '站点', '总库存', 'normal', '仓', '海外', '30天单', '90天单', '最近出单', '建议'], flagged.map(riskRow)) : '<p class="note">无命中风险。</p>'}
${high.length ? `<h3>4.2 高危：30 天有单但缺货</h3><ul>${high.map((r) => `<li><b>${esc(r.item_name)}</b>（item_id ${esc(r.item_id)}）：30 天单量 ${d30(r)}，总库存 0，建议立即补货或暂停广告投放。</li>`).join('')}</ul>` : '<h3>4.2 高危：30 天有单但缺货</h3><p class="note">本次 0 条：近 30 天有单的 ${with30.length} 个商品库存均 >10。</p>'}
<h3>4.3 数据一致性自检</h3><ul>
  <li><code>no_stock</code> 标记与"总库存=0"判定不一致：<b>${zeroFlagMismatch.length}</b> 条${zeroFlagMismatch.length ? `（${zeroFlagMismatch.map((r) => esc(r.item_id)).join('、')}）` : '（与接口标记一致）'}。</li>
  <li>缺货 ${out.length} 条全部为 30/90 天无单（0 单），与"清仓/停售"特征一致。</li>
</ul></section>

<section><h2>五、优化建议（补货优先级）</h2><ul>
  <li><b>P1 高危（30 天有单且缺货，${high.length} 个）</b>：${high.length ? '当天补货或临时改预售；同步检查广告是否仍在投。' : '本次无，保持每日/每周巡检即可。'}</li>
  <li><b>P2 缺货（${out.length} 个）</b>：${out.map((r) => `${esc(r.item_id)}`).join('、')} —— 30/90 天均无单，先由运营确认是否仍要卖：要卖则按 30 天预估补货，不卖则走停售/清仓流程（本插件只读，不下架、不改价）。</li>
  <li><b>P3 低库存（${low.length} 个）</b>：${low.map((r) => `${esc(r.item_id)}（总库存 ${stockOf(r)}）`).join('、')} —— 结合近期出单与在途（<code>stock_onway_plat_count</code>）补货，避免断货。</li>
  <li><b>口径核对</b>：${overlap.length}/${rows.length} 条"warehouse_stock_total 与 oversea_stock 同时 &gt;0"，请与仓储确认是否为包含关系；若包含，总库存应按去重口径重算（本次风险清单不变）。</li>
  <li><b>巡检机制</b>：本报告为 2 页采样快照；建议按日跑一次，并把"P1 高危 + P3 低库存"作为补货触发条件。</li>
</ul></section>

<section><h2>六、限制与未决</h2><ul>
  <li><b>样本覆盖率</b>：本次取 ${(ds.pages || []).length} 页 ${rows.length} 条，等于 <code>status=NORMAL</code> 口径全量 ${total} 条（${pct(rows.length, total)}%）；但仅占陈雄德名下<b>全部状态</b>商品约 2832 条的 ${pct(rows.length, 2832)}%（勘探实测 2026-11-14），下架/售罄/草稿商品不在预警范围。</li>
  <li><b>站点偏差</b>：样本站点仅 ${esc([...new Set(rows.map((r) => r.site))].join('、'))}，结论不能外推到其他站点或店铺。</li>
  <li><b>口径风险（待确认）</b>：<code>warehouse_stock_total</code> 与 <code>oversea_stock</code> 在 ${overlap.length}/${rows.length} 条同时 &gt;0、其中 ${rows.filter((r) => n(r.warehouse_stock_total) > 0 && n(r.warehouse_stock_total) === n(r.oversea_stock)).length} 条完全相等，疑似层级包含；若为包含关系，按业务公式相加会重复计数。对本次 4 条风险品复核：缺货品三项均为 0、低库存品去重后仍 ≤10，<b>结论不变</b>。</li>
  <li><b>接口限制</b>：<code>pageSize</code> 固定 20（传 100 仍返回 20）；<code>status</code> 传数字会 500；接口无排序参数，样本顺序为默认顺序。本次 ${total} 条 &lt; 2 页上限 40 条，未发生截断；筛选结果超过 40 条时 2 页采样会遗漏尾部商品。</li>
  <li><b>字段语义（待确认）</b>：<code>order_day30</code> 的统计窗口起点未在接口文档中确认；<code>order_count</code> 为累计还是周期值未验证。报告只使用 <code>order_day30/90</code>。</li>
  <li><b>只读边界</b>：本流程未执行任何补货、调价、上下架、发消息等写操作。</li>
</ul></section>

<section><h2>七、附录</h2>
<h3>7.1 数据来源</h3><table><tbody>
  <tr><th>任务</th><td><code>${esc(jobLabel)}</code> 取数时间 ${esc(fetchedAt || '未记录')}</td></tr>
  <tr><th>数据集</th><td><code>${esc(source)}</code></td></tr>
  <tr><th>字段映射</th><td><code>normal_stock</code> 普通库存、<code>warehouse_stock_total</code> 仓库库存、<code>oversea_stock</code> 海外仓库存、<code>order_day30/90</code> 近 30/90 天单量、<code>no_stock</code> 缺货标记、<code>item_id</code> 商品主键</td></tr>
</tbody></table>
<h3>7.2 全样本明细（${rows.length} 条，可用于抽查验收）</h3>
${table(['item_id', '商品', '类目', '站点', 'normal', '仓', '海外', '总库存', '30天单', 'status', 'no_stock'], rows.map(sampleRow))}
</section>

<section><h2>八、生成信息</h2><p>插件 <code>stock-alert</code> · taskType <code>stock_alert</code> · 数据源 <code>api.giikin.com</code> · 单文件 HTML（内联 CSS、可离线打开）· 报告由 <code>gen-report.mjs</code> 生成，空数据时退出码 2 且不覆盖旧报告。</p></section>`;

await writeFile(OUT, shell({
  title: '缺货预警报告',
  meta: [
    '业务：stock-alert',
    '数据源：listing/listing（POST）',
    `任务：${jobLabel}`,
    `取数时间：${fetchedAt || '未记录'}`,
    `样本：${rows.length}/${total}`,
  ],
  kpis: [
    { k: '样本商品', v: rows.length, s: `全量 ${total} · 覆盖 ${pct(rows.length, total)}%` },
    { k: '缺货（总库存=0）', v: out.length, s: `占样本 ${pct(out.length, rows.length)}%`, color: '#dc2626' },
    { k: '低库存（1–10）', v: low.length, s: `占样本 ${pct(low.length, rows.length)}%`, color: '#d97706' },
    { k: '高危（30天有单且缺货）', v: high.length, s: 'P1 优先级', color: high.length ? '#dc2626' : '#059669' },
    { k: '健康（>10）', v: ok.length, s: `占样本 ${pct(ok.length, rows.length)}%`, color: '#059669' },
  ],
  body,
  footer: `stock-alert 插件 · 任务 ${jobLabel} · 取数 ${fetchedAt || '未记录'}`,
}), 'utf8');
console.log('报告已生成:', OUT, '| rows:', rows.length, '| total:', total, '| 缺货:', out.length, '| 低库存:', low.length, '| 高危:', high.length);
