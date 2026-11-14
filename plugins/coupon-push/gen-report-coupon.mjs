// gen-report-coupon.mjs —— 优惠券批量发放（模拟写操作）报告
// 用法：node gen-report-coupon.mjs [dataset.json]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shell, table, distTable, top, pct, esc, n } from '../../factory-kit/report-kit.mjs';
import { resolveDataset, rowsOf } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = 'D:/www/dsh-plugin-factory/plugins/coupon-push';
const OUT = path.join(PLUGIN_DIR, 'report', 'coupon-push-report.html');
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

const statusOf = (r) => String(r.status || 'unknown');
const submitted = rows.filter((r) => statusOf(r) === 'submitted');
const planned = rows.filter((r) => statusOf(r) === 'planned');
const skipped = rows.filter((r) => statusOf(r) === 'skipped_duplicate');
const failed = rows.filter((r) => statusOf(r) === 'failed');
const statusLabels = { submitted: '已提交（模拟成功）', planned: '预演（未提交）', skipped_duplicate: '幂等跳过', failed: '失败' };
const statusDist = top(rows, statusOf).map(([k, v]) => [statusLabels[k] || k, v]);
const seqKeys = rows.map((r) => r.key);
const dupKeys = seqKeys.length - new Set(seqKeys).size;

const body = `
<section><h2>一、结论摘要</h2><ul>
  <li>本次任务计划 <b>${rows.length}</b> 条优惠券：<b>已提交 ${submitted.length}</b>、预演 ${planned.length}、幂等跳过 ${skipped.length}、失败 ${failed.length}${extra.stoppedEarly ? '（连续失败 3 条，已提前停止）' : ''}。</li>
  <li>写操作模式：<code>dry_run=${p.dry_run === true}</code>、<code>confirm_write=${p.confirm_write === true}</code>、限速 <code>${esc(p.rate_ms ?? '-')}ms/条</code>、单任务上限 20 条。</li>
  <li>目标系统为<b>本地模拟外部系统</b>（<code>${esc(extra.externalStore || '-')}</code>），不对任何真实业务系统产生副作用；结论用于验证工厂写操作治理链路。</li>
  <li>幂等自检：本任务内重复业务键 <b>${dupKeys}</b> 条；跨任务重复由模拟外部系统按 <code>shop_id:coupon_code</code> 去重。</li>
</ul></section>

<section><h2>二、数据口径</h2><table><tbody>
  <tr><th>执行层</th><td><code>plugins/coupon-push/service/runner.js</code> + 共享 runtime 写操作闸门（<code>platform/runtime/index.js</code>）</td></tr>
  <tr><th>四道闸</th><td>① <code>dry_run=true</code> 只出计划；② 必须 <code>confirm_write=true</code> 才提交；③ 逐条审计（本 JSON）；④ 限速 ${esc(p.rate_ms ?? '-')}ms/条 + 连续 3 失败停止</td></tr>
  <tr><th>额度与幂等</th><td>每日真实写额度（<code>WRITE_DAILY_QUOTA</code>，dry_run 不占额度）；<code>idempotency_key</code> 相同则复用已提交任务</td></tr>
  <tr><th>凭证</th><td><code>COUPON_API_KEY</code> 经 DPAPI 加密注入，报告/日志/审计不出现明文</td></tr>
  <tr><th>写入目的地</th><td>模拟外部系统：<code>${esc(extra.externalStore || 'data/sim-external/coupons.json')}</code></td></tr>
</tbody></table></section>

<section><h2>三、结构分布</h2><div class="grid2">
  <div><h3>按结果状态</h3>${distTable(['状态', '数量', '占比', '分布'], statusDist, rows.length)}</div>
  <div><h3>按店铺</h3>${distTable(['店铺', '数量', '占比', '分布'], top(rows, (r) => r.shop_id), rows.length)}
  <p class="note">券面额档位：${[...new Set(rows.map((r) => r.amount))].sort((a, b) => a - b).map((x) => `$${x}`).join(' / ')}，每张数量 ${esc(rows[0]?.qty ?? '-')}。</p></div>
</div></section>

<section><h2>四、风险与异常</h2>
<ul>
  <li><b>失败 ${failed.length} 条</b>：${failed.length ? failed.map((r) => `${esc(r.shop_id)} / ${esc(r.coupon_code)}（HTTP ${esc(r.http_status)}，${esc(r.receipt)}）`).join('<br>') : '无。'}</li>
  <li><b>幂等跳过 ${skipped.length} 条</b>：${skipped.length ? skipped.map((r) => esc(r.key)).join('、') : '无。'}</li>
  <li><b>提交语义</b>：成功 = 写入模拟外部系统并返回回执；<b>不等于真实优惠券已生效</b>。</li>
  <li><b>不可回滚</b>：写操作无删除步骤；如真实系统需要撤回，必须走其后台，本插件只记录审计。</li>
</ul></section>

<section><h2>五、优化建议</h2><ul>
  <li>真实发券前先用 <code>dry_run=true</code> 核对条数、店铺、面额；确认后必须显式 <code>confirm_write=true</code>。</li>
  <li>把 <code>idempotency_key</code> 固定为"业务批次号"，重跑不会重复发券（本插件已实测返回 <code>deduplicated=true</code>）。</li>
  <li>批量发放保持串行与 350ms 间隔；连续失败 3 条会自动停止，避免放大故障。</li>
  <li>审计 JSON 作为对账底稿：<code>key / shop_id / coupon_code / status / http_status / receipt / at</code>。</li>
</ul></section>

<section><h2>六、限制与未决</h2><ul>
  <li><b>模拟边界</b>：外部系统是本地 JSON（<code>data/sim-external/coupons.json</code>），<b>不代表真实发券平台</b>；真实插件需替换 runner 中的写入实现。</li>
  <li><b>审核/生效延迟</b>：真实平台可能存在审核与延迟到账，本模拟未覆盖；真实交付需把 <code>submitted</code> 与"已生效"区分（见 <code>15-写操作插件规范.md</code>）。</li>
  <li><b>额度</b>：默认每日 20 条真实写；同一任务内最多 20 条。额度按服务本地日切，跨服务不共享。</li>
  <li><b>凭证</b>：未把 <code>COUPON_API_KEY</code> 写入报告；真实系统对接时请用 <code>factory secret</code> 管理。</li>
  <li><b>只读/写边界</b>：本插件只写模拟外部系统与其审计文件，不修改任何其它插件或真实系统。</li>
</ul></section>

<section><h2>七、附录</h2>
<h3>7.1 任务与产物</h3><table><tbody>
  <tr><th>任务</th><td><code>${esc(jobLabel)}</code> · 取数时间 ${esc(fetchedAt || '未记录')}</td></tr>
  <tr><th>数据集</th><td><code>${esc(source)}</code></td></tr>
  <tr><th>审计字段</th><td><code>seq / shop_id / coupon_code / amount / qty / key / status / http_status / receipt / at</code></td></tr>
</tbody></table>
<h3>7.2 逐条审计（${rows.length} 条）</h3>
${table(['#', '店铺', '券码', '面额', '数量', '状态', 'HTTP', '回执', '时间'], rows.map((r) => `<tr><td class="num">${n(r.seq)}</td><td>${esc(r.shop_id)}</td><td>${esc(r.coupon_code)}</td><td class="num">$${n(r.amount)}</td><td class="num">${n(r.qty)}</td><td>${esc(statusLabels[statusOf(r)] || statusOf(r))}</td><td class="num">${n(r.http_status)}</td><td>${esc(r.receipt)}</td><td>${esc(String(r.at).slice(0, 19).replace('T', ' '))}</td></tr>`))}
</section>

<section><h2>八、生成信息</h2><p>插件 <code>coupon-push</code> · taskType <code>coupon_push</code> · 写操作（模拟外部系统）· 单文件 HTML · 报告由 <code>gen-report-coupon.mjs</code> 生成，空数据时退出码 2 且不覆盖旧报告。</p></section>`;

await writeFile(OUT, shell({
  title: '优惠券批量发放报告（模拟写操作）',
  meta: [
    '业务：coupon-push',
    '数据源：本地模拟外部系统',
    `任务：${jobLabel}`,
    `取数时间：${fetchedAt || '未记录'}`,
    `计划：${rows.length}`,
  ],
  kpis: [
    { k: '计划条数', v: rows.length, s: `dry_run ${p.dry_run === true ? '是' : '否'}` },
    { k: '已提交', v: submitted.length, s: '模拟外部系统', color: '#059669' },
    { k: '预演', v: planned.length, s: '未提交', color: '#2563eb' },
    { k: '失败', v: failed.length, s: '逐条见 §四', color: failed.length ? '#dc2626' : '#059669' },
    { k: '幂等跳过', v: skipped.length, s: '重复业务键', color: skipped.length ? '#d97706' : '#64748b' },
  ],
  body,
  footer: `coupon-push 插件 · 任务 ${jobLabel} · 取数 ${fetchedAt || '未记录'}`,
}), 'utf8');
console.log('报告已生成:', OUT, '| rows:', rows.length, '| submitted:', submitted.length, '| planned:', planned.length, '| failed:', failed.length);
