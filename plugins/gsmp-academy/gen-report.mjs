// gen-report.mjs —— AI学苑课程播放与标题汇总报告
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shell, table, distTable, esc } from '../../factory-kit/report-kit.mjs';
import { resolveDataset, rowsOf } from '../../factory-kit/dataset.mjs';

const PLUGIN_DIR = 'D:/www/dsh-plugin-factory/plugins/gsmp-academy';
const OUT = path.join(PLUGIN_DIR, 'report', 'gsmp-academy-report.html');
const { ds, jobId = '', source } = await resolveDataset(PLUGIN_DIR);
const rows = rowsOf(ds);
if (!rows.length) { console.error('[SKIP] 数据集为空：不生成报告'); process.exit(2); }
const fetchedAt = ds.fetchedAt || '';
const jobLabel = jobId || path.basename(path.dirname(source || ''));
const course = ds.params?.course || ds.extra?.course || '-';
const speed = ds.params?.speed || 2;
const secs = ds.params?.seconds_per_lesson || 5;
const played = rows.filter((r) => r.status === 'played');
const failed = rows.filter((r) => r.status === 'failed');
const totalDuration = rows.reduce((s, r) => s + Number(r.duration || 0), 0);
const advancedTotal = rows.reduce((s, r) => s + Number(r.advanced || 0), 0);
const byStatus = [['played', played.length], ['failed', failed.length]].filter((x) => x[1]);

const body = `
<section><h2>一、结论摘要</h2><ul>
<li><b>课程：</b>${esc(course)}，共 ${rows.length} 节；本次 <b>${played.length}/${rows.length}</b> 节完成 ${speed}x 播放 ${secs} 秒。</li>
<li><b>播放验证：</b>每节均记录 video 元素、播放倍速与进度增量；累计有效播放 ${advancedTotal.toFixed(1)} 秒（按 ${speed}x 计实际内容约 ${(advancedTotal / speed).toFixed(1)} 秒）。</li>
<li><b>课程结构：</b>${rows.length} 节，总时长约 ${Math.round(totalDuration / 60)} 分钟（播放器上报时长，部分课程可能为合集时长）。</li>
<li><b>限制：</b>每节只播放 ${secs} 秒，未学完；站点学习进度/吉豆是否计入取决于平台规则，本报告不承诺"已学完"。</li>
<li><b>复用：</b>登录态来自已保存的 storageState，无需重复扫码；若过期，插件会提示人工扫码。</li>
</ul></section>

<section><h2>二、数据口径</h2><table><tbody>
<tr><th style="width:150px">入口</th><td>gsmp 首页 → 导航「AI学苑」→ 新标签页 <code>https://manage.giikin.com/fe/shop/wbw/video-learning</code></td></tr>
<tr><th>课程</th><td>${esc(course)}（课程卡片「7节课程」）</td></tr>
<tr><th>播放方式</th><td>依次点击 7 节课时 → <code>video.play()</code> + <code>playbackRate=${speed}</code> → 播放 ${secs} 秒 → 记录进度增量</td></tr>
<tr><th>登录态</th><td><code>data/sessions/default.json</code>（storageState，复用即免扫码）</td></tr>
<tr><th>样本</th><td>${rows.length} 节（全部课时）</td></tr>
</tbody></table></section>

<section><h2>三、课时清单与播放结果</h2>
${table(['#', '课时标题', '状态', '倍速', '播放时长', '进度增量', '上报总时长'], rows.map((r) => `<tr>
<td class="num">${r.seq}</td>
<td>${esc(r.title || '')}</td>
<td><span class="tag ${r.status === 'played' ? 't-ok' : 't-high'}">${esc(r.status)}</span></td>
<td class="num">${r.rate ?? '-'}x</td>
<td class="num">${secs}s</td>
<td class="num">${r.advanced ?? 0}s</td>
<td class="num">${r.duration ? Math.round(r.duration / 60) + ' 分钟' : '-'}</td></tr>`))}
</section>

<section><h2>四、状态分布</h2>
${distTable(['状态', '数量', '占比', '分布'], byStatus, rows.length)}
<div class="note">播放成功判据：video 元素就绪（readyState≥2）且 5 秒后 currentTime 前进 ≈ ${speed * secs} 秒。</div>
</section>

<section><h2>五、失败与异常</h2>
${failed.length ? table(['#', '标题', '说明'], failed.map((r) => `<tr><td>${r.seq}</td><td>${esc(r.title || '')}</td><td>${esc(r.note || '')}</td></tr>`)) : '<p>无失败记录：7/7 全部播放成功。</p>'}
</section>

<section><h2>六、优化建议</h2><ul>
<li><b>完课：</b>如需真实完课记录，应把每节播放到结束（本插件支持 <code>seconds_per_lesson</code> 调大或用 <code>full_play=true</code> 扩展）。</li>
<li><b>倍速：</b>2x 已验证生效；如需 1.5x/3x 改 <code>speed</code> 参数即可。</li>
<li><b>稳定性：</b>播放器会覆盖课程列表，插件已改为"每节重新进入课程页"，避免点击被拦截。</li>
<li><b>凭证：</b>登录态过期时需人工扫码；建议每周刷新一次 session。</li>
</ul></section>

<section><h2>七、限制与未决</h2><ul>
<li>每节仅播放 ${secs} 秒，<b>不代表学完</b>；平台"学习进度/吉豆"是否计入需以站点实际规则为准。</li>
<li>播放器上报 duration 可能为合集/异常值（本次见 ${Math.max(...rows.map((r) => Math.round(Number(r.duration || 0) / 60)), 0)} 分钟级），不作为课程真实时长依据。</li>
<li>报告仅覆盖该课程的 7 节课；其他课程需改 <code>course</code> 参数。</li>
</ul></section>

<section><h2>八、附录</h2><table><tbody>
<tr><th style="width:150px">数据来源</th><td><code>${esc(source || '')}</code></td></tr>
<tr><th>任务</th><td><code>${esc(jobLabel)}</code> 取数时间：<code>${esc(fetchedAt || '未记录')}</code></td></tr>
<tr><th>账号</th><td>陈雄德（gsmp 登录态，报告不含凭证）</td></tr>
<tr><th>插件</th><td>gsmp-academy（浏览器自动化：登录态复用 + 新标签页 + 视频播放控制）</td></tr>
</tbody></table></section>`;

await writeFile(OUT, shell({
  title: 'AI学苑 · 课程播放与课时汇总报告',
  meta: ['业务：gsmp-academy', '站点：manage.giikin.com', `任务：${jobLabel}`, `取数时间：${fetchedAt || '未记录'}`],
  kpis: [
    { k: '课程', v: rows.length + ' 节', s: course.slice(0, 18) },
    { k: '播放成功', v: `${played.length}/${rows.length}`, color: played.length === rows.length ? 'var(--ok)' : 'var(--warn)', s: `${speed}x · 每节 ${secs}s` },
    { k: '有效播放', v: advancedTotal.toFixed(1) + 's', s: `实际内容约 ${(advancedTotal / speed).toFixed(1)}s` },
    { k: '失败', v: failed.length, color: failed.length ? 'var(--bad)' : 'var(--ok)' },
  ],
  body,
  footer: `gsmp-academy 插件 · AI学苑 · 任务 ${jobLabel}`,
}), 'utf8');
console.log('报告已生成:', OUT, '| rows:', rows.length, '| played:', played.length, '| failed:', failed.length);
