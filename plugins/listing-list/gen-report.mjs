// gen-report.mjs —— 读 2 页 listing 数据，生成 HTML 版经营分析报告
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveDataset } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = 'D:/www/dsh-plugin-factory/plugins/listing-list';
const OUT = path.join(PLUGIN_DIR, 'report', 'listing-list-report.html');
const { ds: dataset, jobId = '', source } = await resolveDataset(PLUGIN_DIR);
const pages = Array.isArray(dataset) ? dataset : (dataset.pages || []);
const rows = pages.flatMap((p) => p.rows || []);
if (!rows.length) {
  console.error('[SKIP] 数据集为空（0 条）：不生成报告，保留旧报告。请换参数/周期重跑。');
  process.exit(2);
}
const total = Array.isArray(dataset) ? (pages.find((p) => p.total)?.total ?? 0) : (dataset.total ?? 0);
const totalPages = Array.isArray(dataset) ? (pages[0]?.totalPages ?? '-') : (dataset.totalPages ?? '-');
const fetchedAt = dataset.fetchedAt || '';
const jobLabel = jobId || path.basename(path.dirname(source || ''));

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const stockOf = (r) => n(r.normal_stock) + n(r.warehouse_stock_total) + n(r.oversea_stock);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = (v) => n(v).toFixed(2);
const pct = (a, b) => (b ? (a / b) * 100 : 0).toFixed(1);
const uniq = (arr) => [...new Set(arr.filter((x) => x !== undefined && x !== null && x !== ''))];
const sum = (arr, f) => arr.reduce((s, r) => s + n(f(r)), 0);
const cnt = (arr, f) => arr.filter(f).length;
const byTop = (arr, f, limit = 10) => {
  const m = new Map();
  for (const r of arr) { const k = f(r) || '(空)'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
};
const bar = (v, max, color = '#3b82f6') => {
  const w = max ? Math.max(2, Math.round((v / max) * 100)) : 0;
  return `<div class="bar"><span style="width:${w}%;background:${color}"></span></div>`;
};
const daysSince = (s) => {
  if (!s) return null;
  const t = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return null;
  return Math.round((Date.now() - t.getTime()) / 86400000);
};

// ---------- 统计 ----------
const statusDist = byTop(rows, (r) => r.status, 20);
const siteDist = byTop(rows, (r) => r.site, 20);
const teamDist = byTop(rows, (r) => r.team_id, 10);
const catDist = byTop(rows, (r) => r.category_cn_name || r.category_name, 10);
const priceVals = rows.map((r) => n(r.current_price || r.oversea_current_price)).filter((v) => v > 0);
const priceBands = [
  ['< 10', priceVals.filter((v) => v < 10).length],
  ['10–30', priceVals.filter((v) => v >= 10 && v < 30).length],
  ['30–50', priceVals.filter((v) => v >= 30 && v < 50).length],
  ['50–100', priceVals.filter((v) => v >= 50 && v < 100).length],
  ['≥ 100', priceVals.filter((v) => v >= 100).length],
];
const zeroStock = cnt(rows, (r) => n(r.normal_stock) <= 0 && n(r.oversea_stock) <= 0 && n(r.warehouse_stock_total) <= 0);
const lowStock = cnt(rows, (r) => (n(r.normal_stock) > 0 && n(r.normal_stock) <= 10));
const overseas = cnt(rows, (r) => n(r.oversea_stock) > 0);
const inTransit = cnt(rows, (r) => n(r.stock_onway_plat_count) > 0);
const sold30 = cnt(rows, (r) => n(r.order_day30) > 0);
const sold7 = cnt(rows, (r) => n(r.order_day7) > 0);
const orderSum = sum(rows, (r) => r.order_count);
const viewsSum = sum(rows, (r) => r.views);
const likesSum = sum(rows, (r) => r.likes);
const comments = sum(rows, (r) => r.comment_count);
const conv = viewsSum ? (orderSum / viewsSum) * 100 : 0;
const ratingVals = rows.map((r) => n(r.rating_star)).filter((v) => v > 0);
const ratingAvg = ratingVals.length ? ratingVals.reduce((a, b) => a + b, 0) / ratingVals.length : 0;
const contentScores = rows.map((r) => n(r.content_score)).filter((v) => v > 0);
const contentAvg = contentScores.length ? contentScores.reduce((a, b) => a + b, 0) / contentScores.length : 0;
const contraband = cnt(rows, (r) => n(r.is_contraband) === 1 || String(r.is_contraband) === '1');
const banWords = cnt(rows, (r) => String(r.marked_ban_words || '').trim() !== '');
const simTitle = cnt(rows, (r) => n(r.similar_title_percent) > 0);
const simImage = cnt(rows, (r) => n(r.similar_image_percent) > 0);
const hasAds = cnt(rows, (r) => n(r.is_create_ads) === 1);
const hasVideo = cnt(rows, (r) => n(r.has_video) === 1);
const aiImage = byTop(rows, (r) => r.ai_image_gen_status_message || '未生成', 6);
const qualityDist = byTop(rows, (r) => r.quality_level, 8);
const preOrder = cnt(rows, (r) => n(r.is_pre_order) === 1);
const staleRows = rows.filter((r) => { const d = daysSince(r.update_time); return d !== null && d > 90; });
const noSalesHighStock = rows.filter((r) => n(r.order_day30) === 0 && stockOf(r) > 100);

// 异常清单：库存/动销/质量/合规
const risks = [];
for (const r of rows) {
  const stock = stockOf(r);
  const o30 = n(r.order_day30);
  if (stock === 0) risks.push({ level: '高', type: '零库存', r, note: '本地+海外+仓库存均为 0，无法承接订单' });
  else if (stock > 100 && o30 === 0) risks.push({ level: '高', type: '库存滞销', r, note: `总库存 ${stock} 但 30 天 0 单` });
  else if (n(r.normal_stock) > 0 && n(r.normal_stock) <= 10) risks.push({ level: '中', type: '低库存', r, note: `本地库存仅 ${n(r.normal_stock)}` });
  if (n(r.is_contraband) === 1) risks.push({ level: '高', type: '违禁风险', r, note: '被标记为违禁品' });
  if (String(r.marked_ban_words || '').trim()) risks.push({ level: '中', type: '敏感词', r, note: `命中：${r.marked_ban_words}` });
  if (n(r.similar_title_percent) >= 50) risks.push({ level: '中', type: '标题重复', r, note: `相似度 ${r.similar_title_percent}` });
  if (n(r.similar_image_percent) >= 50) risks.push({ level: '中', type: '主图重复', r, note: `相似度 ${r.similar_image_percent}` });
  const d = daysSince(r.update_time);
  if (d !== null && d > 180) risks.push({ level: '中', type: '长期未更新', r, note: `${d} 天未更新` });
  if (n(r.views) >= 100 && n(r.order_count) === 0) risks.push({ level: '中', type: '高浏览零成交', r, note: `浏览 ${r.views}，0 单` });
  if (n(r.rating_star) > 0 && n(r.rating_star) < 4) risks.push({ level: '高', type: '低评分', r, note: `评分 ${r.rating_star}` });
}
const dedupKey = (x) => `${x.r.id}-${x.type}`;
const riskList = [...new Map(risks.map((x) => [dedupKey(x), x])).values()];
const riskByType = byTop(riskList, (x) => x.type, 12);

const topSold = [...rows].sort((a, b) => n(b.order_day30) - n(a.order_day30) || n(b.order_count) - n(a.order_count)).slice(0, 8);
const topStock = [...rows].sort((a, b) => stockOf(b) - stockOf(a)).slice(0, 8);

const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

// ---------- HTML ----------
const css = `
:root{--bg:#0f172a;--panel:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:#2563eb;--ok:#059669;--warn:#d97706;--bad:#dc2626}
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:var(--ink);font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
header{background:linear-gradient(135deg,#1e3a8a,#2563eb 55%,#0ea5e9);color:#fff;border-radius:16px;padding:28px 30px}
header h1{margin:0 0 8px;font-size:26px;letter-spacing:.5px}
header .meta{opacity:.9;font-size:13px}header .meta span{margin-right:16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:18px 0 8px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.kpi .k{color:var(--muted);font-size:12px}.kpi .v{font-size:24px;font-weight:700;margin-top:4px}
.kpi .s{font-size:12px;color:var(--muted);margin-top:2px}
section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-top:18px}
h2{font-size:17px;margin:0 0 14px;padding-left:10px;border-left:4px solid var(--brand)}
h3{font-size:14px;margin:16px 0 8px;color:#334155}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:#f8fafc;color:#475569;font-weight:600;white-space:nowrap}
tbody tr:hover{background:#f8fafc}
.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{background:#eef2f7;border-radius:6px;height:8px;min-width:80px;overflow:hidden}
.bar span{display:block;height:100%}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:860px){.grid2{grid-template-columns:1fr}}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid}
.t-high{color:var(--bad);border-color:#fecaca;background:#fef2f2}
.t-mid{color:var(--warn);border-color:#fde68a;background:#fffbeb}
.t-ok{color:var(--ok);border-color:#a7f3d0;background:#ecfdf5}
.note{color:var(--muted);font-size:12px;margin-top:8px}
ul{margin:8px 0 0 18px;padding:0}li{margin:4px 0}
code{background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:12px}
footer{color:var(--muted);font-size:12px;margin-top:22px;text-align:center}
`;

function table(headers, bodyRows, cls = '') {
  return `<table class="${cls}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${bodyRows.join('')}</tbody></table>`;
}

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>listing-list 商品经营分析报告</title><style>${css}</style></head><body><div class="wrap">
<header>
  <h1>Shopee Listing 经营分析报告</h1>
  <div class="meta"><span>业务：listing-list</span><span>数据源：api.giikin.com /agent/shopee/user/openapi/listing/listing</span><span>店铺负责人：陈雄德 (shop_user_id=632016)</span><span>任务：${esc(jobLabel)}</span><span>取数时间：${esc(fetchedAt || '未记录')}</span><span>生成时间：${esc(now)}</span></div>
</header>

<div class="kpis">
  <div class="kpi"><div class="k">本次分析条数</div><div class="v">${rows.length}</div><div class="s">2 页（在售全量 ${total} 条，共 ${totalPages} 页）</div></div>
  <div class="kpi"><div class="k">在线/草稿结构</div><div class="v">${statusDist.map(([k, v]) => `${esc(k)} ${v}`).join(' / ')}</div><div class="s">${uniq(rows.map((r) => r.site)).length} 个站点</div></div>
  <div class="kpi"><div class="k">30 天有单商品</div><div class="v">${sold30}/${rows.length}</div><div class="s">占比 ${pct(sold30, rows.length)}%（7 天有单 ${sold7}）</div></div>
  <div class="kpi"><div class="k">累计订单 / 浏览</div><div class="v">${orderSum} / ${viewsSum.toLocaleString()}</div><div class="s">浏览→下单转化 ${conv.toFixed(2)}%</div></div>
  <div class="kpi"><div class="k">零库存商品</div><div class="v" style="color:${zeroStock ? 'var(--bad)' : 'var(--ok)'}">${zeroStock}</div><div class="s">低库存(≤10) ${lowStock}；有在途 ${inTransit}</div></div>
</div>

<section>
  <h2>一、结论摘要</h2>
  <ul>
    <li><b>样本结构：</b>2 页共 ${rows.length} 条，覆盖 ${uniq(rows.map((r) => r.site)).length} 个站点；口径为「陈雄德名下在售商品 34 条」的 2 页样本（未含 2,832 条草稿）。结论用于看结构与问题，不代表全店经营结果。</li>
    <li><b>动销：</b>30 天有单 ${sold30} 条（${pct(sold30, rows.length)}%），7 天有单 ${sold7} 条；累计 ${orderSum} 单、浏览 ${viewsSum.toLocaleString()}，转化率 ${conv.toFixed(2)}%${conv < 1 ? '（偏低，标题/主图/价格需优化）' : ''}。</li>
    <li><b>库存：</b>零库存 ${zeroStock} 条、低库存 ${lowStock} 条，库存滞销（>100 件且 30 天 0 单）${noSalesHighStock.length} 条——断货丢单与压货占用资金同时存在。</li>
    <li><b>质量与合规：</b>违禁标记 ${contraband} 条、敏感词 ${banWords} 条、标题相似 ${simTitle} 条、主图相似 ${simImage} 条；内容分均值 ${contentAvg.toFixed(1)}。</li>
    <li><b>优先级：</b>先处理「零库存但历史有单」「高库存零动销」「违禁/敏感词」三类，再做批量标题与主图差异化，最后补视频/广告放大动销品。</li>
  </ul>
</section>

<section>
  <h2>二、数据口径</h2>
  <table><tbody>
    <tr><th style="width:170px">接口</th><td><code>POST https://api.giikin.com/agent/shopee/user/openapi/listing/listing</code>（Authorization: Bearer &lt;dk-ai-p 凭证&gt;）</td></tr>
    <tr><th>请求参数</th><td><code>page 1–2</code>、<code>pageSize 20</code>、<code>shop_user_id 632016</code>、<code>shop_user_name 陈雄德</code>、<code>status "NORMAL"</code>（在售）</td></tr>
    <tr><th>过滤说明</th><td>实测该接口<b>忽略 <code>shop_user_id</code></b>（传与不传结果一致，均为全组织 6,581,194 条）；生效字段是 <b><code>shop_user_name</code></b>（=陈雄德）：不加状态过滤 2,832 条（含草稿 DRAFT），加 <code>status="NORMAL"</code> 后在售 34 条。报告取这 34 条的 2 页（${rows.length} 条）。</td></tr>
    <tr><th>排序/分页</th><td>pageSize 固定 20（请求值被忽略）；总页数 ${totalPages}；本次取第 1、2 页。</td></tr>
    <tr><th>币种/单位</th><td>价格字段为站点原币种（<code>current_price</code> / <code>oversea_current_price</code>），未做汇率换算；库存为件数。</td></tr>
    <tr><th>库存公式</th><td><b>总库存 = normal_stock + warehouse_stock_total + oversea_stock</b>（本地 + 仓 + 海外仓，件）。§一、§四、§六 全部按此公式；「低库存」单指本地 <code>normal_stock</code> ≤ 10。</td></tr>
    <tr><th>缺失/异常</th><td>价格缺失 ${rows.length - priceVals.length} 条（按 0 处理不参与价格带）；评分为 0 视为无评分。</td></tr>
  </tbody></table>
  <div class="note">提示：接口在传 <code>sort_type / shop_status / status / is_check_org</code> 等参数时实测返回 500（<code>foreach() argument must be of type array|object, int given</code>），因此插件只传最小可用参数。</div>
</section>

<section>
  <h2>三、结构分布</h2>
  <div class="grid2">
    <div>
      <h3>状态分布</h3>
      ${table(['状态', '数量', '占比', '分布'], statusDist.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td class="num">${pct(v, rows.length)}%</td><td>${bar(v, Math.max(...statusDist.map((x) => x[1])))}</td></tr>`))}
    </div>
    <div>
      <h3>站点分布</h3>
      ${table(['站点', '数量', '占比', '分布'], siteDist.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td class="num">${pct(v, rows.length)}%</td><td>${bar(v, Math.max(...siteDist.map((x) => x[1])))}</td></tr>`))}
    </div>
  </div>
  <div class="grid2" style="margin-top:16px">
    <div>
      <h3>类目 Top10</h3>
      ${table(['类目', '数量', '占比', '分布'], catDist.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td class="num">${pct(v, rows.length)}%</td><td>${bar(v, Math.max(...catDist.map((x) => x[1])))}</td></tr>`))}
    </div>
    <div>
      <h3>价格带分布（挂牌价）</h3>
      ${table(['价格带', '数量', '占比', '分布'], priceBands.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td class="num">${pct(v, priceVals.length)}%</td><td>${bar(v, Math.max(...priceBands.map((x) => x[1])))}</td></tr>`))}
      <div class="note">均价 ${priceVals.length ? (priceVals.reduce((a, b) => a + b, 0) / priceVals.length).toFixed(2) : '-'}（原币种）；共 ${priceVals.length} 条有效价格。</div>
    </div>
  </div>
</section>

<section>
  <h2>四、库存与动销</h2>
  <div class="grid2">
    <div>
      <h3>库存健康</h3>
      ${table(['指标', '数量', '说明'], [
        [`<span class="tag t-high">零库存</span>`, zeroStock, '本地/海外/仓库存均为 0，直接丢单'],
        [`<span class="tag t-mid">低库存(1–10)</span>`, lowStock, '存在断货风险，需补货或提价控单'],
        [`<span class="tag t-ok">有海外仓/在途</span>`, overseas + inTransit, '海外仓在库或在途库存'],
      ].map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td>${r[2]}</td></tr>`))}
    </div>
    <div>
      <h3>动销结构</h3>
      ${table(['指标', '数值'], [
        ['30 天有单商品数', `${sold30} / ${rows.length}（${pct(sold30, rows.length)}%）`],
        ['7 天有单商品数', `${sold7} / ${rows.length}（${pct(sold7, rows.length)}%）`],
        ['累计订单量', orderSum],
        ['累计浏览量', viewsSum.toLocaleString()],
        ['浏览→下单转化', `${conv.toFixed(2)}%`],
        ['累计点赞 / 评论', `${likesSum} / ${comments}`],
        ['平均评分', ratingAvg ? ratingAvg.toFixed(2) : '无评分'],
      ].map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td></tr>`))}
    </div>
  </div>
  <h3>库存 Top8（压货关注）</h3>
  ${table(['商品', '站点', '总库存', '本地', '仓', '海外仓', '30 天单量', '操作'], topStock.map((r) => `<tr><td>${esc(String(r.item_name || '').slice(0, 46))}</td><td>${esc(r.site)}</td><td class="num"><b>${stockOf(r)}</b></td><td class="num">${n(r.normal_stock)}</td><td class="num">${n(r.warehouse_stock_total)}</td><td class="num">${n(r.oversea_stock)}</td><td class="num">${n(r.order_day30)}</td><td>${n(r.order_day30) === 0 ? '<span class="tag t-high">清货/降价</span>' : '<span class="tag t-ok">正常</span>'}</td></tr>`))}
</section>

<section>
  <h2>五、质量、合规与内容</h2>
  <div class="grid2">
    <div>
      <h3>风险标记</h3>
      ${table(['风险项', '数量', '占比'], [
        ['违禁品标记', contraband], ['敏感词命中', banWords], ['标题相似', simTitle], ['主图相似', simImage],
        ['预购商品', preOrder], ['长期未更新(>90 天)', staleRows.length],
      ].map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${pct(r[1], rows.length)}%</td></tr>`))}
    </div>
    <div>
      <h3>内容与广告</h3>
      ${table(['指标', '数值'], [
        ['平均内容分', contentAvg ? contentAvg.toFixed(1) : '-'],
        ['有视频商品', `${hasVideo}（${pct(hasVideo, rows.length)}%）`],
        ['已开广告商品', `${hasAds}（${pct(hasAds, rows.length)}%）`],
        ['AI 图状态（Top3）', aiImage.slice(0, 3).map(([k, v]) => `${esc(k)} ${v}`).join('；')],
        ['质量等级分布', qualityDist.map(([k, v]) => `${esc(k)}: ${v}`).join('；')],
      ].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`))}
    </div>
  </div>
</section>

<section>
  <h2>六、异常清单（按影响排序，共 ${riskList.length} 项）</h2>
  ${table(['级别', '类型', '商品', '站点', '关键数据', '说明'], riskList.slice(0, 24).map((x) => `<tr>
    <td><span class="tag ${x.level === '高' ? 't-high' : 't-mid'}">${x.level}</span></td>
    <td>${esc(x.type)}</td>
    <td>${esc(String(x.r.item_name || x.r.origin_name || '').slice(0, 40))}</td>
    <td>${esc(x.r.site)}</td>
    <td class="num">单价 ${f2(x.r.current_price || x.r.oversea_current_price)} / 总库存 ${stockOf(x.r)} / 30天单 ${n(x.r.order_day30)}</td>
    <td>${esc(x.note)}</td></tr>`))}
  ${riskList.length > 24 ? `<div class="note">仅展示前 24 项，完整清单见数据文件。</div>` : ''}
</section>

<section>
  <h2>七、优化建议（按影响×可执行排序）</h2>
  <ul>
    <li><b>① 断货止损（当天）</b>：${zeroStock} 条零库存商品中，优先处理历史有单的 SKU——补货或在途加速；无法补货的下架避免差评。<br><span class="note">依据：零库存 ${zeroStock} 条；库存滞销 ${noSalesHighStock.length} 条。</span></li>
    <li><b>② 压货清理（本周）</b>：库存 >100 且 30 天 0 单的商品共 ${noSalesHighStock.length} 条，用组合折扣/满减/绑定爆品清货，同时停止补货。<br><span class="note">依据：库存 Top8 明细见第四节。</span></li>
    <li><b>③ 合规排查（本周）</b>：违禁标记 ${contraband} 条、敏感词 ${banWords} 条——改标题/详情后再上架，避免下架与罚款。<br><span class="note">依据：<code>is_contraband</code> / <code>marked_ban_words</code>。</span></li>
    <li><b>④ 标题/主图差异化（两周）</b>：标题相似 ${simTitle} 条、主图相似 ${simImage} 条，按类目批量做差异化（品牌词+场景词+规格），可直接用 AI 标题/改图能力。<br><span class="note">依据：<code>similar_title_percent</code> / <code>similar_image_percent</code>。</span></li>
    <li><b>⑤ 提升转化（两周）</b>：浏览→下单转化 ${conv.toFixed(2)}%，低转化商品优先补视频（当前仅 ${hasVideo} 条有视频）、优化首图与价格带。<br><span class="note">依据：<code>views</code> / <code>order_count</code> / <code>has_video</code>。</span></li>
    <li><b>⑥ 放大动销品（持续）</b>：30 天有单 ${sold30} 条，其中未开广告的优先小额投放测试；有视频/高评分的作为主推。<br><span class="note">依据：<code>is_create_ads</code>、<code>rating_star</code>、<code>order_day30</code>。</span></li>
  </ul>
</section>

<section>
  <h2>八、附录</h2>
  <table><tbody>
    <tr><th style="width:170px">数据来源</th><td><code>${esc(source || '')}</code></td></tr>
    <tr><th>任务 ID</th><td><code>${esc(jobLabel)}</code>　取数时间：<code>${esc(fetchedAt || '未记录')}</code></td></tr>
    <tr><th>字段数</th><td>${Object.keys(rows[0] || {}).length} 个字段（含库存/动销/质量/合规/广告/内容）</td></tr>
    <tr><th>样本限制</th><td>在售商品仅 ${total} 条（共 ${totalPages} 页），本次取 2 页 ${rows.length} 条；2,832 条含草稿未纳入。结论为样本结构分析，不替代全量盘点。</td></tr>
    <tr><th>币种</th><td>站点原币种，未换算；跨站点金额不可直接相加。</td></tr>
    <tr><th>生成方式</th><td>listing-list 插件（API 型）→ 2 页取数 → 本地统计 → 单文件 HTML 报告（脚本自动读取最新任务产物，可用参数指定 dataset.json）</td></tr>
  </tbody></table>
</section>

<footer>listing-list 插件 · 数据源 api.giikin.com · 任务 ${esc(jobLabel)} · 采样 2 页 / ${rows.length} 条 · ${esc(now)}</footer>
</div></body></html>`;

await writeFile(OUT, html, 'utf8');
console.log('报告已生成:', OUT);
console.log('样本:', rows.length, '条；全量:', total, '；风险项:', riskList.length);
