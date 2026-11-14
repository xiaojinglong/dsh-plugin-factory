// gen-report-ads.mjs —— 广告活动盘点报告（场景3）
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, n, f2, pct, sum, cnt, uniq, top, table, distTable, shell } from '../../factory-kit/report-kit.mjs';
import { resolveDataset } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(PLUGIN_DIR, 'report', 'ads-list-report.html');
const { ds, jobId = '', source } = await resolveDataset(PLUGIN_DIR);
const rows = (ds.pages || []).flatMap((p) => p.rows || []);
if (!rows.length) {
  console.error('[SKIP] 数据集为空（0 条）：不生成报告，保留旧报告。请换店铺/周期重跑。');
  process.exit(2);
}
const fetchedAt = ds.fetchedAt || '';
const jobLabel = jobId || path.basename(path.dirname(source || ''));
const m = (r) => r.metrics || {};
const total = ds.total || rows.length;

const expense = sum(rows, (r) => m(r).expense);
const clicks = sum(rows, (r) => m(r).clicks);
const imps = sum(rows, (r) => m(r).impression);
const directOrders = sum(rows, (r) => m(r).direct_order);
const broadGmv = sum(rows, (r) => m(r).broad_gmv);
const directGmv = sum(rows, (r) => m(r).direct_gmv);
const roi = expense ? broadGmv / expense : 0;
const ctr = imps ? (clicks / imps) * 100 : 0;
const cpc = clicks ? expense / clicks : 0;
const kinds = top(rows, (r) => r.ad_kind);
const status = top(rows, (r) => r.campaign_status);
const bidding = top(rows, (r) => r.bidding_method);
const placement = top(rows, (r) => r.campaign_placement);
const zeroClick = rows.filter((r) => n(m(r).expense) > 0 && n(m(r).clicks) === 0);
const noExpense = rows.filter((r) => n(m(r).expense) === 0);
const lowRoi = rows.filter((r) => n(m(r).expense) > 0 && n(m(r).broad_roi) < 5);
const highRoi = rows.filter((r) => n(m(r).broad_roi) >= 20);
const topExpense = [...rows].sort((a, b) => n(m(b).expense) - n(m(a).expense)).slice(0, 10);
const dateFrom = ds.extra?.date_from ?? '';
const dateTo = ds.extra?.date_to ?? '';
const fmtDate = (ts) => (ts ? new Date(Number(ts) * 1000).toLocaleDateString('zh-CN') : '-');

const risks = [];
for (const r of rows) {
  const mm = m(r);
  if (mm.expense > 0 && mm.clicks === 0) risks.push({ lv: '高', t: '有花费无点击', r, note: `花费 ${f2(mm.expense)}，点击 0` });
  if (mm.expense > 0 && mm.broad_roi < 5) risks.push({ lv: '高', t: 'ROI 偏低', r, note: `花费 ${f2(mm.expense)}，ROI ${mm.broad_roi}` });
  if (mm.impression > 10000 && mm.ctr < 1) risks.push({ lv: '中', t: 'CTR 偏低', r, note: `曝光 ${mm.impression}，CTR ${mm.ctr}%` });
  if (r.campaign_budget === 0) risks.push({ lv: '低', t: '未设预算上限', r, note: 'campaign_budget=0' });
  if (mm.expense === 0) risks.push({ lv: '低', t: '零消耗活动', r, note: '活动在跑但无花费' });
}

const body = `
<section><h2>一、结论摘要</h2><ul>
<li><b>活动规模：</b>样本 ${rows.length} 个活动（全量 ${total}），覆盖 ${uniq(rows.map((r) => r.site)).join('、')} 站点、${uniq(rows.map((r) => r.ad_kind)).length} 种推广类型。</li>
<li><b>投放效果：</b>花费 ${f2(expense)}、曝光 ${imps.toLocaleString()}、点击 ${clicks.toLocaleString()}，CTR ${ctr.toFixed(2)}%、CPC ${f2(cpc)}、整体 ROI ${roi.toFixed(2)}。</li>
<li><b>结构：</b>${kinds.map(([k, v]) => `${esc(k)} ${v}`).join(' / ')}；状态 ${status.map(([k, v]) => `${esc(k)} ${v}`).join(' / ')}。</li>
<li><b>异常：</b>有花费无点击 ${zeroClick.length} 个、ROI<5 ${lowRoi.length} 个、零消耗 ${noExpense.length} 个；高 ROI(≥20) ${highRoi.length} 个可加预算。</li>
<li><b>建议：</b>关停「有花费无点击/ROI<5」，把预算向高 ROI 活动倾斜，CTR 低的先换主图/标题。</li>
</ul></section>

<section><h2>二、数据口径</h2><table><tbody>
<tr><th style="width:160px">接口</th><td><code>POST https://api.giikin.com/agent/shopee/user/openapi/ads/list</code></td></tr>
<tr><th>参数</th><td><code>shop_id=1097451512</code>、<code>date_time=["${esc(dateFrom)}","${esc(dateTo)}"]</code>、<code>page 1–2</code>、<code>pageSize=20</code></td></tr>
<tr><th>总量</th><td>全量 ${total} 个活动；本次取 2 页 ${rows.length} 个</td></tr>
<tr><th>指标</th><td>impression / clicks / expense / direct_order / direct_gmv / broad_gmv / ctr / cpc / cr / broad_roi / direct_roi</td></tr>
<tr><th>注意</th><td>金额为站点原币种（未换算）；ROI 使用 <code>broad_roi</code>（宽口径）</td></tr>
</tbody></table></section>

<section><h2>三、结构分布</h2>
<div class="grid2"><div><h3>推广类型</h3>${distTable(['类型', '数量', '占比', '分布'], kinds, rows.length)}</div>
<div><h3>活动状态</h3>${distTable(['状态', '数量', '占比', '分布'], status, rows.length)}</div></div>
<div class="grid2" style="margin-top:16px"><div><h3>出价方式</h3>${distTable(['方式', '数量', '占比', '分布'], bidding, rows.length)}</div>
<div><h3>展示位置</h3>${distTable(['位置', '数量', '占比', '分布'], placement, rows.length)}</div></div>
</section>

<section><h2>四、花费 Top10（含效果）</h2>
${table(['活动', '类型', '花费', '曝光', '点击', 'CTR', 'ROI', '开始时间'], topExpense.map((r) => {
  const mm = m(r);
  const bad = n(mm.broad_roi) < 5;
  return `<tr><td>${esc(String(r.campaign_name || '').slice(0, 30))}<div class="note">${esc(r.campaign_id)}</div></td><td>${esc(r.ad_kind)}</td><td class="num">${f2(mm.expense)}</td><td class="num">${n(mm.impression).toLocaleString()}</td><td class="num">${n(mm.clicks).toLocaleString()}</td><td class="num">${f2(mm.ctr)}%</td><td class="num" style="color:${bad ? 'var(--bad)' : 'var(--ok)'}">${f2(mm.broad_roi)}</td><td>${esc(fmtDate(r.campaign_start_time))}</td></tr>`;
}))}
</section>

<section><h2>五、风险清单（共 ${risks.length} 项）</h2>
${table(['级别', '类型', '活动', '说明'], risks.slice(0, 20).map((x) => `<tr><td><span class="tag ${x.lv === '高' ? 't-high' : x.lv === '中' ? 't-mid' : 't-ok'}">${x.lv}</span></td><td>${esc(x.t)}</td><td>${esc(String(x.r.campaign_name || '').slice(0, 34))}<div class="note">${esc(x.r.campaign_id)}</div></td><td>${esc(x.note)}</td></tr>`))}
</section>

<section><h2>六、优化建议</h2><ul>
<li><b>① 止血：</b>${zeroClick.length} 个有花费无点击、${lowRoi.length} 个 ROI<5，先降预算/关停。</li>
<li><b>② 加投：</b>${highRoi.length} 个 ROI≥20 的活动优先加预算，注意预算上限与库存承接。</li>
<li><b>③ 创意：</b>CTR 低于 1% 的活动换主图/标题再测，避免无效曝光。</li>
<li><b>④ 结构：</b>按推广类型对比 ROI/CPC，把预算集中到效率更高的类型。</li>
<li><b>⑤ 预算：</b>${cnt(rows, (r) => r.campaign_budget === 0)} 个活动未设预算上限，建议设日预算防超支。</li>
</ul></section>

<section><h2>七、附录</h2><table><tbody>
<tr><th style="width:150px">数据文件</th><td><code>D:\\www\\dshspirder\\ads-list\\data\\dataset.json</code></td></tr>
<tr><th>样本限制</th><td>2 页 ${rows.length} 个活动（全量 ${total}）；单店铺口径</td></tr>
<tr><th>生成方式</th><td>ads-list 插件（API 型）→ 2 页取数 → factory-kit 报告套件</td></tr>
</tbody></table></section>`;

await writeFile(OUT, shell({
  title: 'Shopee 广告活动盘点报告',
  meta: ['业务：ads-list', '数据源：/agent/shopee/user/openapi/ads/list', `周期：${esc(dateFrom)} ~ ${esc(dateTo)}`, `任务：${esc(jobLabel)}`, `取数时间：${esc(fetchedAt || '未记录')}`],
  kpis: [
    { k: '活动数', v: rows.length, s: `全量 ${total}` },
    { k: '花费', v: f2(expense), s: `CPC ${f2(cpc)}` },
    { k: '曝光 / 点击', v: `${imps.toLocaleString()} / ${clicks.toLocaleString()}`, s: `CTR ${ctr.toFixed(2)}%` },
    { k: '整体 ROI', v: roi.toFixed(2), color: roi < 5 ? 'var(--bad)' : 'var(--ok)', s: `GMV ${f2(broadGmv)}` },
    { k: '异常活动', v: zeroClick.length + lowRoi.length, color: zeroClick.length + lowRoi.length ? 'var(--warn)' : 'var(--ok)', s: `高 ROI ${highRoi.length} 个` },
  ],
  body,
  footer: `ads-list 插件 · 数据源 api.giikin.com · 2 页 ${rows.length} 个活动`,
}), 'utf8');
console.log('报告已生成:', OUT, '| rows:', rows.length, '| expense:', f2(expense), '| roi:', roi.toFixed(2), '| risks:', risks.length);
