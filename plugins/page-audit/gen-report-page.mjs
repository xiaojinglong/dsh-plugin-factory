// gen-report-page.mjs —— 商品页巡检（模拟站点 · 浏览器型）报告
// 用法：node gen-report-page.mjs [dataset.json]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell, table, distTable, top, pct, esc, n } from '../../factory-kit/report-kit.mjs';
import { resolveDataset, rowsOf } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(PLUGIN_DIR, 'report', 'page-audit-report.html');
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
const p = ds.params || {};

const RULE_LABEL = {
  MISSING_ALT: '图片缺少 alt', SHORT_TITLE: '标题过短', MISSING_PRICE: '价格缺失',
  BROKEN_LINK: '链接 404', DUPLICATE_TITLE: '标题重复',
};
const allIssues = rows.flatMap((r) => (r.issues || []).map((x) => ({ ...x, page: r.seq, path: r.path })));
const levelRank = { P1: 0, P2: 1, P3: 2 };
const sortedIssues = [...allIssues].sort((a, b) => (levelRank[a.level] ?? 9) - (levelRank[b.level] ?? 9));
const levelDist = top(allIssues, (x) => x.level);
const ruleDist = top(allIssues, (x) => RULE_LABEL[x.rule] || x.rule);
const itemsTotal = rows.reduce((s, r) => s + n(r.items), 0);
const shots = rows.filter((r) => r.screenshot);
const pageRow = (r) => `<tr><td class="num">${n(r.seq)}</td><td><code>${esc(r.path)}</code></td><td>${esc(r.title)}</td>
<td class="num">${n(r.items)}</td><td class="num">${(r.issues || []).length}</td><td>${esc(r.status)}</td><td class="num">${n(r.elapsed_ms)} ms</td>
<td>${r.screenshot ? `<a href="../service/data/${esc(r.screenshot)}">${esc(path.basename(r.screenshot))}</a>` : '—'}</td></tr>`;
const issueRow = (x, i) => `<tr><td class="num">${i + 1}</td><td><span class="tag ${x.level === 'P1' ? 't-high' : x.level === 'P2' ? 't-mid' : 't-ok'}">${esc(x.level)}</span></td>
<td>${esc(RULE_LABEL[x.rule] || x.rule)}</td><td>${esc(x.title || '(无标题)')}</td><td>${esc(x.detail)}</td><td class="num">${n(x.page)}</td><td><code>${esc(x.path)}</code></td></tr>`;

const body = `
<section><h2>一、结论摘要</h2><ul>
  <li>本次巡检 <b>${rows.length}</b> 页、<b>${itemsTotal}</b> 个商品条目，命中问题 <b>${allIssues.length}</b> 个；其中 P1 ${levelDist.find(([k]) => k === 'P1')?.[1] || 0} 个、P2 ${levelDist.find(([k]) => k === 'P2')?.[1] || 0} 个、P3 ${levelDist.find(([k]) => k === 'P3')?.[1] || 0} 个。</li>
  <li>主要问题：${ruleDist.slice(0, 3).map(([k, v]) => `${esc(k)} ${v} 个`).join('、') || '无'}。</li>
  <li>登录态：${extra.sessionReused ? '复用已有 storageState' : '本次执行模拟登录并保存 storageState'}；每页已留全页截图（见 §七）。</li>
  <li>本插件使用<b>内置本地模拟站点</b>（随机端口），结论用于验证工厂浏览器型插件链路，不代表真实站点。</li>
</ul></section>

<section><h2>二、数据口径</h2><table><tbody>
  <tr><th>执行层</th><td>Playwright Chromium（headless）+ <code>plugins/page-audit/service/crawler.js</code></td></tr>
  <tr><th>站点</th><td>内置静态站点 <code>${esc(extra.base || '-')}</code>（<code>fixtures/</code> 下 3 个页面）</td></tr>
  <tr><th>登录态</th><td><code>data/sessions/page-audit.json</code>（storageState）；文件不存在时点击模拟登录并保存；<code>sessionReused=${extra.sessionReused === true}</code></td></tr>
  <tr><th>巡检项</th><td>图片 alt、标题长度、价格缺失、同源链接 404、跨页/页内标题重复</td></tr>
  <tr><th>样本</th><td>${rows.length}/${total} 页（${pct(rows.length, total)}%），${itemsTotal} 个条目；参数 <code>pages=${esc(p.pages ?? '-')}</code></td></tr>
</tbody></table></section>

<section><h2>三、结构分布</h2><div class="grid2">
  <div><h3>按严重度</h3>${distTable(['级别', '数量', '占比', '分布'], levelDist, allIssues.length)}</div>
  <div><h3>按规则</h3>${distTable(['规则', '数量', '占比', '分布'], ruleDist, allIssues.length)}</div>
</div>
<h3>页面级汇总</h3>${table(['#', '路径', '页面标题', '条目数', '问题数', '状态', '耗时', '截图'], rows.map(pageRow))}</section>

<section><h2>四、风险与异常</h2>
${sortedIssues.length ? table(['#', '级别', '规则', '商品/对象', '说明', '页', '路径'], sortedIssues.map(issueRow)) : '<p class="note">本次未命中问题。</p>'}
<p class="note">规则说明：<code>BROKEN_LINK</code> 用浏览器内 <code>fetch</code> 复检同源链接，仅 404 计问题；外链与锚点跳过。</p></section>

<section><h2>五、优化建议</h2><ul>
  <li><b>P1 链接 404</b>：优先修复失效详情页链接，避免流量与转化损失。</li>
  <li><b>P2 图片 alt / 价格缺失</b>：补齐 alt 提升可访问性与 SEO；价格缺失会导致比价与转化异常，需运营回填。</li>
  <li><b>P3 标题过短 / 重复</b>：统一标题规范（长度、唯一性），避免搜索与推荐去重时被折叠。</li>
  <li><b>巡检机制</b>：本插件可改为真实站点后按日巡检；建议保留 storageState 复用与每页截图，便于复核与举证。</li>
</ul></section>

<section><h2>六、限制与未决</h2><ul>
  <li><b>模拟站点</b>：页面是本地固定夹具（3 页），<b>不是真实商品页</b>；切换真实站点需修改 <code>PAGES</code> 与选择器并重跑勘探。</li>
  <li><b>登录</b>：模拟登录仅写 localStorage；真实站点（钉钉扫码/验证码）需人工介入一次并复用 storageState（见 <code>16-浏览器复杂场景规范.md</code>）。</li>
  <li><b>链接检查</b>：仅验证同源 GET 是否 404，未验证跳转链、登录墙、JS 渲染后的目标页。</li>
  <li><b>并发</b>：单任务串行巡检；浏览器实例空闲 ${esc('BROWSER_IDLE_MS=600000')} 关闭；并发提交会排队。</li>
  <li><b>截图</b>：截图保存在任务目录（<code>service/data/jobs/&lt;jobId&gt;/</code>），随任务保留 7 天后清理。</li>
</ul></section>

<section><h2>七、附录</h2>
<h3>7.1 任务与产物</h3><table><tbody>
  <tr><th>任务</th><td><code>${esc(jobLabel)}</code> · 取数时间 ${esc(fetchedAt || '未记录')}</td></tr>
  <tr><th>数据集</th><td><code>${esc(source)}</code></td></tr>
  <tr><th>截图</th><td>${shots.map((r) => `<a href="../service/data/${esc(r.screenshot)}">${esc(path.basename(r.screenshot))}</a>`).join(' · ') || '无'}</td></tr>
</tbody></table>
<h3>7.2 页面明细</h3>${table(['#', '路径', '标题', '条目数', '问题数', '状态', '耗时', '截图'], rows.map(pageRow))}
</section>

<section><h2>八、生成信息</h2><p>插件 <code>page-audit</code> · taskType <code>page_audit</code> · 浏览器型（Playwright）· 内置模拟站点 · 单文件 HTML · 报告由 <code>gen-report-page.mjs</code> 生成，空数据时退出码 2 且不覆盖旧报告。</p></section>`;

await writeFile(OUT, shell({
  title: '商品页巡检报告（模拟站点）',
  meta: [
    '业务：page-audit',
    '数据源：内置模拟站点',
    `任务：${jobLabel}`,
    `取数时间：${fetchedAt || '未记录'}`,
    `页面：${rows.length}/${total}`,
  ],
  kpis: [
    { k: '巡检页面', v: rows.length, s: `条目 ${itemsTotal}` },
    { k: '问题总数', v: allIssues.length, s: `P1 ${levelDist.find(([k]) => k === 'P1')?.[1] || 0}`, color: allIssues.length ? '#d97706' : '#059669' },
    { k: 'P1 链接 404', v: allIssues.filter((x) => x.level === 'P1').length, s: '优先修复', color: '#dc2626' },
    { k: 'P2 / P3', v: `${allIssues.filter((x) => x.level === 'P2').length} / ${allIssues.filter((x) => x.level === 'P3').length}`, s: '图片/价格 / 标题' },
    { k: '登录态复用', v: extra.sessionReused ? '是' : '否', s: 'storageState' },
  ],
  body,
  footer: `page-audit 插件 · 任务 ${jobLabel} · 取数 ${fetchedAt || '未记录'}`,
}), 'utf8');
console.log('报告已生成:', OUT, '| pages:', rows.length, '| issues:', allIssues.length);
