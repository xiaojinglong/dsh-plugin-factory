// gen-report.mjs —— haina-comment 评论汇总报告
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell, table, distTable, bar, top, esc } from '../../factory-kit/report-kit.mjs';
import { resolveDataset, rowsOf } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(PLUGIN_DIR, 'report', 'haina-comment-report.html');
const { ds, jobId = '', source } = await resolveDataset(PLUGIN_DIR);
const rows = rowsOf(ds);
if (!rows.length) { console.error('[SKIP] 数据集为空：不生成报告'); process.exit(2); }
const fetchedAt = ds.fetchedAt || '';
const jobLabel = jobId || path.basename(path.dirname(source || ''));
const params = ds.params || {};
const account = ds.extra?.account || '-';

const submitted = rows.filter((r) => r.status === 'submitted');
const failed = rows.filter((r) => r.status === 'failed');
const planned = rows.filter((r) => r.status === 'planned');
const byArticle = top(rows, (r) => r.title || r.article_title || '(未知)');
const statusDist = [['submitted', submitted.length], ['failed', failed.length], ['planned', planned.length]].filter((x) => x[1] > 0);
const isDry = params.dry_run === true;

const body = `
<section><h2>一、结论摘要</h2><ul>
<li><b>本次执行：</b>计划 ${rows.length} 条评论，成功提交 <b>${submitted.length}</b> 条，失败 ${failed.length} 条${planned.length ? `，预演 ${planned.length} 条（未提交）` : ''}。</li>
<li><b>覆盖文章：</b>${byArticle.length} 篇；账号 <code>${account}</code>。</li>
<li><b>审核状态：</b>站点评论为「提交后待审核」，成功提交≠立即展示；报告与审计记录保留每条提交结果。</li>
<li><b>写操作保护：</b>${isDry ? '本次为预演（dry_run），未真正发表评论。' : '本次已确认 confirm_write=true，评论已真实提交。'}</li>
<li><b>风险：</b>${failed.length ? `有 ${failed.length} 条失败，需人工重试；` : '无提交失败；'}内容以"自动化测试评论"标注，便于后续清理。</li>
</ul></section>

<section><h2>二、数据口径</h2><table><tbody>
<tr><th style="width:150px">站点</th><td><code>http://www.hainaerp.com</code>（海纳技术博客）</td></tr>
<tr><th>登录方式</th><td>页面登录弹窗（邮箱 + 密码，凭证在服务端 .env）</td></tr>
<tr><th>文章列表</th><td><code>GET http://api.hainaerp.com/api/article/list?page=1&amp;per_page=20</code></td></tr>
<tr><th>评论提交</th><td><code>POST http://api.hainaerp.com/api/comment/create</code>（body: article_id/content/nickname）</td></tr>
<tr><th>样本</th><td>计划 ${rows.length} 条 / 实际提交 ${submitted.length} 条</td></tr>
<tr><th>限制</th><td>评论需站点审核后展示；本报告只证明"提交成功"，不代表已对外可见</td></tr>
</tbody></table></section>

<section><h2>三、执行明细（逐条审计）</h2>
${table(['#', '文章', '评论内容', '状态', 'HTTP', '站点回执', '时间'], rows.map((r) => `<tr>
<td class="num">${r.seq ?? '-'}</td>
<td>${esc(r.title || '')}<div class="note">article_id=${esc(String(r.id ?? ''))}</div></td>
<td>${esc(String(r.content || '').slice(0, 60))}</td>
<td><span class="tag ${r.status === 'submitted' ? 't-ok' : r.status === 'failed' ? 't-high' : 't-mid'}">${esc(r.status)}</span></td>
<td class="num">${r.http_status || '-'}</td>
<td>${esc(String(r.message || r.toast || '').slice(0, 40))}</td>
<td>${esc(String(r.at || '').slice(11, 19))}</td></tr>`))}
</section>

<section><h2>四、按文章汇总</h2>
${distTable(['文章', '评论数', '占比', '分布'], byArticle, rows.length)}
</section>

<section><h2>五、失败与异常</h2>
${failed.length ? table(['#', '文章', '错误', '时间'], failed.map((r) => `<tr><td>${r.seq}</td><td>${esc(r.title || '')}</td><td>${esc(r.message || '')}</td><td>${esc(String(r.at || '').slice(11, 19))}</td></tr>`)) : '<p>无失败记录。</p>'}
</section>

<section><h2>六、优化建议</h2><ul>
<li><b>审核跟进：</b>${submitted.length} 条评论需站点管理员审核后展示（后台可查 pending）。</li>
<li><b>内容治理：</b>本次为测试评论，若为正式业务，建议按文章主题生成差异化内容、控制频率（本插件默认每条间隔 2.5–4 秒）。</li>
<li><b>失败重试：</b>${failed.length ? '对失败条目单独重跑（加大间隔/人工检查页面结构）。' : '保持当前选择器与节奏即可。'}</li>
<li><b>合规：</b>写操作插件默认 dry_run；正式运行必须显式 confirm_write=true，并保留审计 JSON。</li>
</ul></section>

<section><h2>七、限制与未决</h2><ul>
<li>评论状态为"提交成功（待审核）"，无法确认最终是否通过审核。</li>
<li>样本 ${rows.length} 条为本次计划量，不等于站点评论总量。</li>
<li>文章列表取接口前 20 篇；若需指定文章，需扩展参数（article_ids）。</li>
</ul></section>

<section><h2>八、附录</h2><table><tbody>
<tr><th style="width:150px">数据来源</th><td><code>${esc(source || '')}</code></td></tr>
<tr><th>任务</th><td><code>${esc(jobLabel)}</code> 取数时间：<code>${esc(fetchedAt || '未记录')}</code></td></tr>
<tr><th>账号</th><td>${esc(account)}（密码不落报告）</td></tr>
<tr><th>插件</th><td>haina-comment（浏览器自动化 + 写操作审计）</td></tr>
</tbody></table></section>`;

await writeFile(OUT, shell({
  title: '海纳博客 · 文章评论汇总报告',
  meta: ['业务：haina-comment', '站点：www.hainaerp.com', `任务：${jobLabel}`, `取数时间：${fetchedAt || '未记录'}`],
  kpis: [
    { k: '计划评论', v: rows.length, s: isDry ? '预演模式' : '已提交' },
    { k: '提交成功', v: submitted.length, color: 'var(--ok)', s: '待站点审核' },
    { k: '失败', v: failed.length, color: failed.length ? 'var(--bad)' : 'var(--ok)' },
    { k: '覆盖文章', v: byArticle.length, s: `账号 ${account}` },
  ],
  body,
  footer: `haina-comment 插件 · www.hainaerp.com · 任务 ${jobLabel}`,
}), 'utf8');
console.log('报告已生成:', OUT, '| rows:', rows.length, '| submitted:', submitted.length, '| failed:', failed.length, '| dry:', isDry);
