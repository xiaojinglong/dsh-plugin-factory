// gen-report-shop.mjs —— 店铺盘点报告（场景2）
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { esc, n, pct, sum, cnt, uniq, top, table, distTable, shell } from '../../factory-kit/report-kit.mjs';
import { resolveDataset } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = 'D:/www/dsh-plugin-factory/plugins/shop-list';
const OUT = path.join(PLUGIN_DIR, 'report', 'shop-list-report.html');
const { ds, jobId = '', source } = await resolveDataset(PLUGIN_DIR);
const rows = (ds.pages || []).flatMap((p) => p.rows || []);
if (!rows.length) {
  console.error('[SKIP] 数据集为空（0 条）：不生成报告，保留旧报告。请换参数/周期重跑。');
  process.exit(2);
}
const total = ds.total || 0;
const fetchedAt = ds.fetchedAt || '';
const jobLabel = jobId || path.basename(path.dirname(source || ''));

const status = top(rows, (r) => r.status);
const sites = top(rows, (r) => r.site);
const teams = top(rows, (r) => r.team, 10);
const users = top(rows, (r) => r.shop_user_name, 10);
const types = top(rows, (r) => r.store_type);
const currencies = top(rows, (r) => r.currency);
const noProduct = cnt(rows, (r) => n(r.total_count) === 0 && n(r.upload_num) === 0);
const offlineHeavy = cnt(rows, (r) => n(r.offline_num) > 0);
const autoUpload = cnt(rows, (r) => n(r.is_auto_upload) === 1);
const preOrder = cnt(rows, (r) => n(r.pre_order_rate) > 0);
const uploadSum = sum(rows, (r) => r.upload_num);
const onlineSum = sum(rows, (r) => r.online_count);

const risks = [];
for (const r of rows) {
  if (n(r.upload_num) === 0 && n(r.total_count) === 0) risks.push({ lv: '高', t: '空店/无商品', r, note: '上架数与商品总数均为 0' });
  if (r.status !== 'NORMAL') risks.push({ lv: '高', t: '店铺状态异常', r, note: `status=${r.status}` });
  if (n(r.offline_num) > 0) risks.push({ lv: '中', t: '存在下架商品', r, note: `下架 ${r.offline_num} 个` });
  if (n(r.is_auto_upload) === 0 && n(r.upload_num) > 0) risks.push({ lv: '低', t: '未开自动上架', r, note: '依赖人工上架' });
  if (n(r.pre_order_rate) > 30) risks.push({ lv: '中', t: '预售占比高', r, note: `${r.pre_order_rate}%` });
}

const body = `
<section><h2>一、结论摘要</h2><ul>
<li><b>店铺规模：</b>样本 ${rows.length} 家（全量 ${total.toLocaleString()}，${ds.totalPages} 页），覆盖 ${uniq(rows.map((r) => r.site)).length} 个站点、${uniq(rows.map((r) => r.team)).length} 个团队。</li>
<li><b>状态：</b>${status.map(([k, v]) => `${esc(k)} ${v}`).join(' / ')}；异常店铺进入风险清单。</li>
<li><b>商品供给：</b>样本上架数合计 ${uploadSum.toLocaleString()}，在线 ${onlineSum.toLocaleString()}；空店/无商品 ${noProduct} 家，存在下架 ${offlineHeavy} 家。</li>
<li><b>自动化：</b>已开自动上架 ${autoUpload} 家（${pct(autoUpload, rows.length)}%），其余依赖人工。</li>
<li><b>优先级：</b>先处理空店/异常状态，再补商品与自动化配置，最后按团队做产能对比。</li>
</ul></section>

<section><h2>二、数据口径</h2><table><tbody>
<tr><th style="width:160px">接口</th><td><code>POST https://api.giikin.com/agent/shopee/user/openapi/shop/list</code></td></tr>
<tr><th>参数</th><td><code>user_id=632016</code>、<code>page 1–2</code>、<code>pageSize=100</code></td></tr>
<tr><th>总量</th><td>全量 ${total.toLocaleString()} 家 / ${ds.totalPages} 页；本次取 2 页 ${rows.length} 家</td></tr>
<tr><th>字段</th><td>${Object.keys(rows[0] || {}).length} 个（店铺状态/站点/团队/店长/上架数/在线/下架/币种/店铺类型等）</td></tr>
<tr><th>注意</th><td>该接口默认返回权限范围内全部店铺；<code>pageSize</code> 最大 100（本次验证）；金额类字段未在本接口返回</td></tr>
</tbody></table></section>

<section><h2>三、结构分布</h2>
<div class="grid2">
<div><h3>状态分布</h3>${distTable(['状态', '数量', '占比', '分布'], status, rows.length)}</div>
<div><h3>站点分布</h3>${distTable(['站点', '数量', '占比', '分布'], sites, rows.length)}</div>
</div>
<div class="grid2" style="margin-top:16px">
<div><h3>团队 Top10</h3>${distTable(['团队', '数量', '占比', '分布'], teams, rows.length)}</div>
<div><h3>店长 Top10</h3>${distTable(['店长', '数量', '占比', '分布'], users, rows.length)}</div>
</div>
<div class="grid2" style="margin-top:16px">
<div><h3>店铺类型</h3>${distTable(['类型', '数量', '占比', '分布'], types, rows.length)}</div>
<div><h3>币种</h3>${distTable(['币种', '数量', '占比', '分布'], currencies, rows.length)}</div>
</div>
</section>

<section><h2>四、风险清单（共 ${risks.length} 项）</h2>
${table(['级别', '类型', '店铺', '站点', '团队', '说明'], risks.slice(0, 24).map((x) => `<tr><td><span class="tag ${x.lv === '高' ? 't-high' : x.lv === '中' ? 't-mid' : 't-ok'}">${x.lv}</span></td><td>${esc(x.t)}</td><td>${esc(x.r.account)}<div class="note">${esc(x.r.shop_id)}</div></td><td>${esc(x.r.site)}</td><td>${esc(x.r.team)}</td><td>${esc(x.note)}</td></tr>`))}
</section>

<section><h2>五、优化建议</h2><ul>
<li><b>① 空店处置：</b>${noProduct} 家空店/无商品，确认是否待开/待关，避免占用管理成本。</li>
<li><b>② 异常状态：</b>非 NORMAL 店铺逐家核对授权与罚分。</li>
<li><b>③ 下架治理：</b>${offlineHeavy} 家存在下架商品，按类目补图/改价后重新上架。</li>
<li><b>④ 自动化：</b>${rows.length - autoUpload} 家未开自动上架，先给上架量大的团队开。</li>
<li><b>⑤ 供给结构：</b>按团队对比上架数/在线数，定位产能洼地。</li>
</ul></section>

<section><h2>六、附录</h2><table><tbody>
<tr><th style="width:150px">数据文件</th><td><code>D:\\www\\dshspirder\\shop-list\\data\\dataset.json</code></td></tr>
<tr><th>样本限制</th><td>2 页 ${rows.length} 家（全量 ${total.toLocaleString()}，${ds.totalPages} 页）；结论为样本结构分析</td></tr>
<tr><th>生成方式</th><td>shop-list 插件（API 型）→ 2 页取数 → factory-kit 报告套件</td></tr>
</tbody></table></section>`;

await writeFile(OUT, shell({
  title: 'Shopee 店铺盘点报告',
  meta: ['业务：shop-list', '数据源：/agent/shopee/user/openapi/shop/list', '负责人：632016', `任务：${esc(jobLabel)}`, `取数时间：${esc(fetchedAt || '未记录')}`],
  kpis: [
    { k: '样本/全量店铺', v: `${rows.length}/${total.toLocaleString()}`, s: `2 页 / ${ds.totalPages} 页` },
    { k: '站点数', v: uniq(rows.map((r) => r.site)).length, s: uniq(rows.map((r) => r.site)).join('、') },
    { k: '空店/无商品', v: noProduct, color: noProduct ? 'var(--bad)' : 'var(--ok)', s: `异常状态 ${cnt(rows, (r) => r.status !== 'NORMAL')} 家` },
    { k: '上架数合计', v: uploadSum.toLocaleString(), s: `在线 ${onlineSum.toLocaleString()}` },
    { k: '自动上架', v: `${autoUpload}`, s: `占比 ${pct(autoUpload, rows.length)}%` },
  ],
  body,
  footer: `shop-list 插件 · 数据源 api.giikin.com · 2 页 ${rows.length} 家（全量 ${total.toLocaleString()}）`,
}), 'utf8');
console.log('报告已生成:', OUT, '| rows:', rows.length, '| total:', total, '| risks:', risks.length);
