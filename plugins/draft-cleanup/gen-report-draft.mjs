// gen-report-draft.mjs —— 草稿商品清理盘点报告（draft-cleanup）
// 输入：dataset.json（标准产物契约：{task,fetchedAt,params,total,totalPages,pages[].rows[]}）
// 输出：report/draft-cleanup-report.html（单文件、内联 CSS、可离线打开）
// 用法：node gen-report-draft.mjs [datasetPath]
//       缺省优先 data/dataset.json，其次取 service/data/jobs/<最新>/draft_cleanup_dataset.json
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, n, f2, pct, sum, cnt, uniq, top, table, distTable, shell } from '../../factory-kit/report-kit.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = `${ROOT}/report/draft-cleanup-report.html`;

/** 数据集解析：显式入参 → data/dataset.json → 最新 job 产物 */
async function resolveDataset() {
  const candidates = [];
  if (process.argv[2]) candidates.push(process.argv[2]);
  try {
    const jobsDir = `${ROOT}/service/data/jobs`;
    const dirs = (await readdir(jobsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const d of dirs.slice(0, 5)) candidates.push(`${jobsDir}/${d}/draft_cleanup_dataset.json`);
  } catch { /* 目录不存在时忽略 */ }
  candidates.push(`${ROOT}/data/dataset.json`);
  for (const c of candidates) {
    try {
      const raw = await readFile(c, 'utf8');
      return { file: c, ds: JSON.parse(raw) };
    } catch { /* 试下一个 */ }
  }
  throw new Error(`找不到可用数据集，已尝试：\n${candidates.join('\n')}`);
}

const { file: DATA_FILE, ds } = await resolveDataset();
const pages = Array.isArray(ds) ? ds : ds.pages || [];
const rows = pages.flatMap((p) => p.rows || []);
if (!rows.length) {
  console.error('[SKIP] 数据集为空（0 条）：不生成报告，保留旧报告。');
  process.exit(2);
}
const total = Number(ds.total) || rows.length;
const totalPages = ds.totalPages ?? '-';
const params = ds.params || {};

/* ---------------- 派生判定 ---------------- */
const daysSince = (s) => {
  if (!s) return null;
  const t = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return null;
  return Math.round((Date.now() - t.getTime()) / 86400000);
};
const hasPrice = (r) => n(r.current_price) > 0;
const hasImage = (r) => String(r.main_image || '').trim() !== '';
const hasSku = (r) => String(r.item_sku || '').trim() !== '';
const stockOf = (r) => n(r.normal_stock) + n(r.warehouse_stock_total);
const contentOf = (r) => n(r.content_score);
const ageOf = (r) => daysSince(r.update_time);
const uploaded = (r) => String(r.upload_time || '').trim() !== '';
const complete = (r) => hasPrice(r) && hasImage(r) && hasSku(r) && contentOf(r) >= 80 && stockOf(r) > 0;
const stale = (r) => (ageOf(r) ?? 0) > 90;

/** 上架完备度（0–100） */
function publishScore(r) {
  let s = 0;
  if (hasPrice(r)) s += 25;
  if (hasImage(r)) s += 25;
  if (hasSku(r)) s += 15;
  if (contentOf(r) >= 80) s += 15;
  if (stockOf(r) > 0) s += 10;
  if (n(r.has_video) === 1) s += 5;
  if (n(r.price_range) > 0) s += 5;
  return s;
}
/** 清理/归档优先级（越高越该先处理） */
function cleanupScore(r) {
  const age = ageOf(r) ?? 0;
  let s = 0;
  if (age > 180) s += 4;
  else if (age > 90) s += 3;
  else if (age > 30) s += 2;
  if (!hasPrice(r)) s += 3;
  if (!hasImage(r)) s += 3;
  if (!hasSku(r)) s += 2;
  if (n(r.similar_title_percent) >= 50) s += 2;
  if (n(r.similar_image_percent) >= 50) s += 2;
  if (stockOf(r) === 0) s += 1;
  if (n(r.order_count) === 0 && n(r.views) === 0) s += 1;
  return s;
}

/* ---------------- 分布统计 ---------------- */
const siteDist = top(rows, (r) => r.site, 10);
const catDist = top(rows, (r) => r.category_cn_name || r.category_name, 10);
const acctDist = top(rows, (r) => (r.account && r.account.account) || r.account_id, 10);
const modeDist = top(rows, (r) => r.upload_mode_cn, 6);
const teamDist = top(rows, (r) => r.team_id, 6);
const sites = uniq(rows.map((r) => r.site));
const accts = uniq(rows.map((r) => (r.account && r.account.account) || r.account_id));

const noPrice = rows.filter((r) => !hasPrice(r));
const noImage = rows.filter((r) => !hasImage(r));
const noSku = rows.filter((r) => !hasSku(r));
const zeroStock = rows.filter((r) => stockOf(r) === 0);
const neverUploaded = rows.filter((r) => !uploaded(r));
const noVideo = rows.filter((r) => n(r.has_video) !== 1);
const simTitle = rows.filter((r) => n(r.similar_title_percent) > 0);
const simImage = rows.filter((r) => n(r.similar_image_percent) > 0);
const priceRangeMissing = rows.filter((r) => n(r.price_range) <= 0);
const banWords = rows.filter((r) => String(r.marked_ban_words || '').trim());
const contraband = rows.filter((r) => n(r.is_contraband) === 1);
const zeroStockNoSales = rows.filter((r) => stockOf(r) === 0 && n(r.order_count) === 0 && n(r.views) === 0);

/** 重复标题/主图分组 */
function dupGroups(field) {
  const m = new Map();
  for (const r of rows) {
    const k = String(r[field] || '').trim();
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
}
const dupTitleGroups = dupGroups('item_name');
const dupImageGroups = dupGroups('main_image');
const dupTitleRows = dupTitleGroups.flat();
const dupImageRows = dupImageGroups.flat();

/** 未更新时长分档 */
const ageBuckets = [
  ['≤ 30 天', rows.filter((r) => { const a = ageOf(r); return a !== null && a <= 30; }).length],
  ['31–90 天', rows.filter((r) => { const a = ageOf(r); return a !== null && a > 30 && a <= 90; }).length],
  ['91–180 天', rows.filter((r) => { const a = ageOf(r); return a !== null && a > 90 && a <= 180; }).length],
  ['> 180 天', rows.filter((r) => { const a = ageOf(r); return a !== null && a > 180; }).length],
];
const ageVals = rows.map(ageOf).filter((x) => x !== null);
const ageMin = ageVals.length ? Math.min(...ageVals) : null;
const ageMax = ageVals.length ? Math.max(...ageVals) : null;
const staleRows = rows.filter(stale);
const priceSum = sum(rows.filter(hasPrice), (r) => r.current_price);
const stockSum = sum(rows, (r) => stockOf(r));

/* 2×2 分档（互斥）：完备度 × 新鲜度 */
const bucketPublishNow = rows.filter((r) => complete(r) && !stale(r));
const bucketPublishOrArchive = rows.filter((r) => complete(r) && stale(r));
const bucketFixThenPublish = rows.filter((r) => !complete(r) && !stale(r));
const bucketCleanupNow = rows.filter((r) => !complete(r) && stale(r));

/** 硬清理候选：信息缺失/重复/零库存零动销/超 180 天 */
const hardCleanup = rows.filter((r) =>
  !hasPrice(r) || !hasImage(r) || !hasSku(r) || (ageOf(r) ?? 0) > 180 || zeroStockNoSales.includes(r)
);
/** 归档候选：完备但僵化（可上架，也可归档），按清理分降序、内容分升序 */
const archiveCandidates = [...bucketPublishOrArchive].sort(
  (a, b) => cleanupScore(b) - cleanupScore(a) || contentOf(a) - contentOf(b) || stockOf(b) - stockOf(a)
);
const cleanupList = hardCleanup.length ? hardCleanup : archiveCandidates;
const publishList = [...bucketPublishOrArchive, ...bucketPublishNow]
  .sort((a, b) => publishScore(b) - publishScore(a) || stockOf(b) - stockOf(a));
const publishTop = publishList.slice(0, 10);
const cleanupTop = cleanupList.slice(0, 10);

const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

/* ---------------- 报告正文 ---------------- */
const body = `
<section><h2>一、结论摘要</h2><ul>
<li><b>积压规模：</b>陈雄德（shop_user_id=632016）名下草稿合计 <b>${total}</b> 条（共 ${totalPages} 页）；本次按业务要求取前 <b>2 页 ${rows.length} 条</b> 作为样本，覆盖率 ${pct(rows.length, total)}%。</li>
<li><b>站点/类目集中度：</b>样本全部落在 <b>${sites.join('、') || '-'}</b>（账号 ${accts.join('、') || '-'}），类目 Top1 为「${esc(catDist[0]?.[0] || '-')}」${catDist[0]?.[1] || 0} 条，占 ${pct(catDist[0]?.[1] || 0, rows.length)}%；样本共 ${uniq(rows.map((r) => r.category_cn_name || r.category_name)).length} 个类目。</li>
<li><b>僵化程度：</b>样本最后更新集中在 ${ageMin === ageMax ? `<b>${ageMin} 天前</b>` : `${ageMin}–${ageMax} 天前`}，&gt;90 天未更新 <b>${staleRows.length}</b> 条（${pct(staleRows.length, rows.length)}%）；从未上架（<code>upload_time</code> 为空）<b>${neverUploaded.length}</b> 条（${pct(neverUploaded.length, rows.length)}%），累计浏览/订单均为 ${sum(rows, (r) => r.views)}/${sum(rows, (r) => r.order_count)}。</li>
<li><b>信息完备度：</b>缺价格 ${noPrice.length} 条、缺主图 ${noImage.length} 条、缺 SKU ${noSku.length} 条、零库存 ${zeroStock.length} 条；重复标题 ${dupTitleGroups.length} 组、重复主图 ${dupImageGroups.length} 组；合规风险 ${contraband.length + banWords.length} 条。</li>
<li><b>优先级建议：</b>本批草稿属于「<b>信息完整但僵化</b>」型——硬清理（缺图/缺价/重复）命中 <b>${hardCleanup.length}</b> 条，而完备可上架 <b>${bucketPublishOrArchive.length + bucketPublishNow.length}</b> 条。因此建议<b>先上架 Top10 验证，其余按 60 天未动分批归档</b>，而非成批删除。</li>
</ul></section>

<section><h2>二、数据口径</h2><table><tbody>
<tr><th style="width:170px">接口</th><td><code>POST https://api.giikin.com/agent/shopee/user/openapi/listing/listing</code>（<code>Authorization: Bearer &lt;LISTING_API_KEY&gt;</code>）</td></tr>
<tr><th>请求参数</th><td><code>page 1–${pages.length}</code>、<code>pageSize ${params.pageSize || 20}</code>、<code>shop_user_id ${params.shop_user_id || 632016}</code>、<code>shop_user_name ${esc(params.shop_user_name || '陈雄德')}</code>、<code>status "${esc(params.status || 'DRAFT')}"</code></td></tr>
<tr><th>过滤说明</th><td>实测该接口<b>忽略 <code>shop_user_id</code></b>（传与不传结果一致）；生效过滤是 <b><code>shop_user_name</code> + <code>status</code></b>：不传 status=2832 条（含在售）、<code>status="NORMAL"</code>=34 条（在售）、<code>status="DRAFT"</code>=<b>${total} 条</b>。status 取值<b>大小写不敏感</b>（DRAFT/draft 一致）。</td></tr>
<tr><th>分页</th><td><code>pageSize</code> 请求值被忽略，实际固定 <b>20 条/页</b>；<code>pagination.total=${total}</code>、<code>totalPages=${totalPages}</code> 可信；本次取第 1–${pages.length} 页。</td></tr>
<tr><th>币种/单位</th><td>价格 <code>current_price</code> 为站点原币种（样本 currency=${esc(uniq(rows.map((r) => r.account?.currency)).join('/')) || '-'}，currency_id=${esc(uniq(rows.map((r) => r.currency_id)).join('/'))}）；库存 <code>normal_stock</code> 为件数。</td></tr>
<tr><th>时间字段</th><td><code>create_time</code> / <code>update_time</code> / <code>upload_time</code> 均为字符串 <code>YYYY-MM-DD HH:MM:SS</code>；<code>upload_time</code> 为空表示<b>从未上架</b>；<code>offline_time=1970-01-01</code> 表示从未下架。</td></tr>
<tr><th>样本限制</th><td>2 页 ${rows.length} 条，占草稿全量 ${pct(rows.length, total)}%；结论只代表样本，不替代 ${total} 条全量盘点。</td></tr>
</tbody></table></section>

<section><h2>三、积压规模与分布</h2>
<div class="grid2">
  <div><h3>站点分布</h3>${distTable(['站点', '数量', '占比', '分布'], siteDist, rows.length)}</div>
  <div><h3>店铺账号分布</h3>${distTable(['账号', '数量', '占比', '分布'], acctDist, rows.length)}</div>
</div>
<div class="grid2" style="margin-top:16px">
  <div><h3>类目 Top10</h3>${distTable(['类目', '数量', '占比', '分布'], catDist, rows.length)}</div>
  <div><h3>上刊方式 / 团队</h3>
    ${distTable(['上刊方式', '数量', '占比', '分布'], modeDist, rows.length)}
    <div class="note">团队分布：${teamDist.map(([k, v]) => `${esc(k)} ${v}`).join(' / ') || '-'}</div>
  </div>
</div>
</section>

<section><h2>四、草稿生命周期（僵化程度）</h2>
<div class="grid2">
  <div><h3>最后未更新时长分布</h3>${distTable(['未更新时长', '数量', '占比', '分布'], ageBuckets, rows.length)}</div>
  <div><h3>关键事实</h3>${table(['指标', '数值'], [
    ['样本最后更新时间', ageMin === ageMax ? `${ageMin} 天前` : `${ageMin}–${ageMax} 天前`],
    ['创建时间跨度', `${esc(rows.map((r) => r.create_time).sort()[0] || '-')} ~ ${esc(rows.map((r) => r.create_time).sort().at(-1) || '-')}`],
    ['从未上架（upload_time 空）', `${neverUploaded.length} / ${rows.length}（${pct(neverUploaded.length, rows.length)}%）`],
    ['累计浏览 / 订单', `${sum(rows, (r) => r.views)} / ${sum(rows, (r) => r.order_count)}`],
    ['库存总量（样本）', stockSum.toLocaleString()],
    ['均价（有效价格）', priceSum ? f2(priceSum / rows.filter(hasPrice).length) : '-'],
    ['无视频', `${noVideo.length}（${pct(noVideo.length, rows.length)}%）`],
    ['价格区间缺失（price_range≤0）', priceRangeMissing.length],
  ].map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td></tr>`))}
  </div>
</div>
<div class="note">解读：草稿<strong>不参与流量分发</strong>（浏览/订单为 0），"未更新时长 + 是否上架"是唯一可用的新鲜度信号。样本 ${staleRows.length}/${rows.length} 条已超 90 天未动且全部未上架，属于典型"僵尸草稿"——问题不在字段，而在<strong>没人推动上架</strong>。</div>
</section>

<section><h2>五、哪些草稿可清理（规则命中表）</h2>
${table(['判定规则', '命中条数', '占比', '字段依据', '处置建议'], [
  ['长期未更新（&gt;90 天）', staleRows.length, `${pct(staleRows.length, rows.length)}%`, '<code>update_time</code>', '业务口径的清理候选：60 天未动先评审，180 天未动归档'],
  ['无主图', noImage.length, `${pct(noImage.length, rows.length)}%`, '<code>main_image</code> 为空', '直接清理或补图'],
  ['无价格', noPrice.length, `${pct(noPrice.length, rows.length)}%`, '<code>current_price ≤ 0</code>', '直接清理或补价'],
  ['无 SKU 编码', noSku.length, `${pct(noSku.length, rows.length)}%`, '<code>item_sku</code> 为空', '补编码，否则无法上架'],
  ['零库存', zeroStock.length, `${pct(zeroStock.length, rows.length)}%`, '<code>normal_stock+warehouse_stock_total=0</code>', '无货源则清理'],
  ['重复标题', `${dupTitleGroups.length} 组 / ${dupTitleRows.length} 条`, `${pct(dupTitleRows.length, rows.length)}%`, '<code>item_name</code> 完全相同', '保留主推，其余合并'],
  ['重复主图', `${dupImageGroups.length} 组 / ${dupImageRows.length} 条`, `${pct(dupImageRows.length, rows.length)}%`, '<code>main_image</code> 完全相同', '保留主推，其余换图/清理'],
  ['接口相似度标记', `${simTitle.length} / ${simImage.length}`, '-', '<code>similar_title_percent</code> / <code>similar_image_percent</code>', '≥50% 合并（本批接口全为 0，未启用）'],
  ['零库存且零动销', zeroStockNoSales.length, `${pct(zeroStockNoSales.length, rows.length)}%`, '库存=0 且 订单=0 且 浏览=0', '优先清理'],
  ['合规风险（违禁/敏感词）', `${contraband.length} / ${banWords.length}`, '-', '<code>is_contraband</code> / <code>marked_ban_words</code>', '必须处理后再上架'],
].map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td><td class="note">${r[3]}</td><td>${esc(r[4])}</td></tr>`))}
<div class="note">逐条去重后：<b>硬清理候选 ${hardCleanup.length} 条</b>（缺价/缺图/缺 SKU/零库存零动销/超 180 天），<b>归档候选 ${archiveCandidates.length} 条</b>（信息完整但超 90 天未动）。本批"无图/无价/重复"均为 0，说明<strong>不能靠字段缺失判定垃圾草稿</strong>，必须叠加"僵化时长 + 是否上架"两个信号。</div>
</section>

<section><h2>六、清理候选 Top10（${hardCleanup.length ? '硬清理规则命中' : '归档候选：完整但僵化'}）</h2>
${table(['清理分', '草稿 ID', '标题', '站点/类目', '未更新', '上架', '价格', '库存', '命中原因'], cleanupTop.map((r) => {
  const why = [];
  if (!hasPrice(r)) why.push('无价');
  if (!hasImage(r)) why.push('无图');
  if (!hasSku(r)) why.push('无SKU');
  if ((ageOf(r) ?? 0) > 180) why.push('超180天');
  if (stockOf(r) === 0 && n(r.order_count) === 0) why.push('零库存零动销');
  if (!why.length) {
    why.push('>90天未动');
    if (!uploaded(r)) why.push('从未上架');
    if (n(r.has_video) !== 1) why.push('无视频');
  }
  return `<tr><td class="num">${cleanupScore(r)}</td><td>${esc(r.id)}</td><td>${esc(String(r.item_name || '').slice(0, 30))}</td><td>${esc(r.site)} / ${esc(r.category_cn_name || '-')}</td><td class="num">${ageOf(r) ?? '-'} 天</td><td>${uploaded(r) ? '已上架' : '<span class="tag t-mid">未上架</span>'}</td><td class="num">${f2(r.current_price)}</td><td class="num">${stockOf(r)}</td><td class="note">${esc(why.join(' / '))}</td></tr>`;
}))}
<div class="note">${hardCleanup.length ? '以上为按硬规则命中的可清理草稿，逐条确认无独有货源后即可归档。' : '本批无缺陷型垃圾草稿，上表为"完整但僵化"的归档候选：先挑其中可上架的，其余按周分批归档，避免一次性误删。'}</div>
</section>

<section><h2>七、上架与清理优先级建议</h2>
${table(['优先级', '处置动作', '条数', '判定口径', '说明'], [
  ['<span class="tag t-ok">P1 立即上架</span>', '直接发布测款', bucketPublishNow.length, '完备（价/图/SKU/内容分≥80/有库存）且 ≤90 天未更新', '最优批次；本批为 0，说明近期无新增优质草稿'],
  ['<span class="tag t-mid">P1b 上架验证</span>', '挑 Top10 发布，其余归档', bucketPublishOrArchive.length, '完备但 >90 天未更新', '本批主体：先验证动销，再决定去留'],
  ['<span class="tag t-mid">P2 补全后上架</span>', '补视频/价格区间后上架', bucketFixThenPublish.length, '不完备但 ≤90 天', '新鲜草稿值得补'],
  ['<span class="tag t-high">P3 归档/清理</span>', '归档、合并或删除', bucketCleanupNow.length, '不完备且 >90 天（或缺价/缺图/重复/零库存零动销/超 180 天）', '清理前确认无独有货源'],
].map((r) => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td class="num">${r[2]}</td><td class="note">${esc(r[3])}</td><td class="note">${esc(r[4])}</td></tr>`))}

<h3>P1 上架候选 Top10（按上架完备度）</h3>
${table(['完备分', '草稿 ID', '标题', '类目', '价格', '库存', '内容分', '视频'], publishTop.map((r) => `<tr><td class="num">${publishScore(r)}</td><td>${esc(r.id)}</td><td>${esc(String(r.item_name || '').slice(0, 36))}</td><td>${esc(r.category_cn_name || '-')}</td><td class="num">${f2(r.current_price)}</td><td class="num">${stockOf(r)}</td><td class="num">${contentOf(r)}</td><td>${n(r.has_video) === 1 ? '有' : '无'}</td></tr>`))}

<h3>执行建议（按周分批）</h3>
<ul>
<li><b>第 1 周｜上架验证：</b>从上表取 10 条发布（价格/主图/SKU 已在位，只需发布动作），7 天后看浏览/加购，决定该批是"补视频放大"还是"归档"。</li>
<li><b>第 2 周｜清理：</b>硬清理候选 ${hardCleanup.length} 条按清理分从高到低处理；完备但僵化的 ${archiveCandidates.length} 条按"最近更新最久 + 内容分最低"优先归档。</li>
<li><b>第 3 周｜补全：</b>P2 ${bucketFixThenPublish.length} 条补视频（当前无视频 ${noVideo.length} 条）与 <code>price_range</code>（缺失 ${priceRangeMissing.length} 条）。</li>
<li><b>持续机制：</b>草稿 >60 天未动进入"待上架/待清理"双周评审，>180 天自动归档；本次 1021 条草稿中 96% 未在样本内，建议全量跑一遍再定批次。</li>
</ul>
</section>

<section><h2>八、异常与限制</h2><table><tbody>
<tr><th style="width:170px">样本口径</th><td>2 页 ${rows.length} 条 / 全量 ${total} 条（${pct(rows.length, total)}%）；未做全量统计，清理总量需全量重跑确认。</td></tr>
<tr><th>单站点偏差</th><td>样本 ${sites.join('、')} 单站点、单账号（${accts.join('、')}），跨站点结论不可外推。</td></tr>
<tr><th>排序未知</th><td>接口未暴露可用排序参数（<code>sort_type</code> 实测触发 500），"前 2 页"是接口默认顺序，不代表最旧/最贵。</td></tr>
<tr><th>字段局限</th><td><code>quality_level</code> 样本全为 0（未评级）；<code>similar_*_percent</code> 全为 0（接口未算相似度），重复检测用"标题/主图完全相同"补位。</td></tr>
<tr><th>判定口径</th><td>"清理"以归档/合并为主，不含删除动作；"未更新天数"以本机时间（${esc(now)}）减 <code>update_time</code> 计算，与平台时区可能差 ±1 天。</td></tr>
</tbody></table></section>

<section><h2>九、附录</h2><table><tbody>
<tr><th style="width:170px">数据文件</th><td><code>${esc(DATA_FILE)}</code></td></tr>
<tr><th>数据集契约</th><td><code>task=${esc(ds.task || 'draft_cleanup')}</code>、<code>total=${total}</code>、<code>totalPages=${totalPages}</code>、<code>pages[${pages.length}].rows[]</code>、字段 ${Object.keys(rows[0] || {}).length} 个</td></tr>
<tr><th>生成方式</th><td>draft-cleanup 插件（API 型）→ 2 页取数 → factory-kit/report-kit 单文件 HTML</td></tr>
<tr><th>样例 ID</th><td>${esc(rows.slice(0, 5).map((r) => r.id).join(', '))} …</td></tr>
</tbody></table></section>`;

await writeFile(OUT, shell({
  title: 'Shopee 草稿商品清理盘点报告',
  meta: [
    '业务：draft-cleanup',
    '数据源：/agent/shopee/user/openapi/listing/listing',
    `口径：陈雄德 (632016) · status=DRAFT · ${pages.length} 页`,
  ],
  kpis: [
    { k: '草稿总量（接口 total）', v: total, s: `${totalPages} 页；本次取 2 页 ${rows.length} 条` },
    { k: '样本覆盖率', v: `${pct(rows.length, total)}%`, s: `2 页 / 全量 ${total}` },
    { k: '超 90 天未更新', v: staleRows.length, color: 'var(--warn)', s: `占样本 ${pct(staleRows.length, rows.length)}%；最久 ${ageMax ?? '-'} 天` },
    { k: '硬清理候选', v: hardCleanup.length, color: hardCleanup.length ? 'var(--bad)' : 'var(--ok)', s: `归档候选 ${archiveCandidates.length}；零动销 ${sum(rows, (r) => r.order_count)} 单` },
    { k: '信息缺失（无图/无价/无SKU）', v: `${noImage.length}/${noPrice.length}/${noSku.length}`, s: `重复标题 ${dupTitleGroups.length} 组、重复主图 ${dupImageGroups.length} 组` },
  ],
  body,
  footer: `draft-cleanup 插件 · 数据源 api.giikin.com · 2 页 ${rows.length} 条 / 全量 ${total} 条 · ${esc(now)}`,
}), 'utf8');

console.log('报告已生成:', OUT);
console.log(`样本 ${rows.length} 条（全量 ${total}）；硬清理 ${hardCleanup.length}、归档候选 ${archiveCandidates.length}、可上架 ${bucketPublishOrArchive.length + bucketPublishNow.length}`);
