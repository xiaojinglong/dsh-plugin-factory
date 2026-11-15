// gen-report.mjs —— 通用业务报告（场景包共享；读取 dataset.extra 的 summary/columns/recommendations）
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FACTORY_ROOT || path.resolve(DIR, '..', '..');
const { shell, table, pct, esc } = await import(pathToFileURL(path.join(ROOT, 'factory-kit', 'report-kit.mjs')).href);
const { resolveDataset, rowsOf } = await import(pathToFileURL(path.join(ROOT, 'factory-kit', 'dataset.mjs')).href);

const OUT = path.join(DIR, 'report', path.basename(DIR) + '-report.html');
const { ds, jobId = '', source } = await resolveDataset(DIR);
const rows = rowsOf(ds);
if (!rows.length) {
  console.error('[SKIP] 数据集为空（0 条）：不生成报告，保留旧报告。');
  process.exit(2);
}
const extra = ds.extra || {};
const title = extra.title || path.basename(DIR);
const columns = Array.isArray(extra.columns) && extra.columns.length ? extra.columns : Object.keys(rows[0] || {});
const summary = Array.isArray(extra.summary) ? extra.summary : [];
const recommendations = Array.isArray(extra.recommendations) ? extra.recommendations : [];
const conclusion = extra.conclusion || `共处理 ${rows.length} 条记录，详见明细。`;

const labelOf = (k) => (extra.labels && extra.labels[k]) || k;
const sevOf = (r) => String(r.severity || r.level || r.status || '').toUpperCase();
const sevCount = {};
for (const r of rows) { const s = sevOf(r); if (s) sevCount[s] = (sevCount[s] || 0) + 1; }
const sevRows = Object.entries(sevCount).sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td><td>${pct(v, rows.length)}%</td></tr>`).join('');

const kpis = summary.map((x) => ({ k: x.k, v: x.v, s: x.s || '' }));
if (!kpis.length) kpis.push({ k: '记录数', v: rows.length, s: `全量 ${ds.total ?? rows.length}` });

const body = `
<section><h2>一、结论摘要</h2>
  <p>${esc(conclusion)}</p>
  <ul>${recommendations.slice(0, 5).map((r) => `<li>${esc(r)}</li>`).join('') || '<li>无额外建议。</li>'}</ul>
</section>
<section><h2>二、数据口径</h2><table><tbody>
  <tr><th>任务</th><td><code>${esc(ds.task || '')}</code></td></tr>
  <tr><th>参数</th><td><code>${esc(JSON.stringify(ds.params || {}))}</code></td></tr>
  <tr><th>数据源</th><td><code>${esc(source || '')}</code></td></tr>
  <tr><th>取数时间</th><td>${esc(ds.fetchedAt || '未记录')}</td></tr>
</tbody></table></section>
<section><h2>三、分布与风险</h2>
  ${sevRows ? `<table><thead><tr><th>级别/状态</th><th>数量</th><th>占比</th></tr></thead><tbody>${sevRows}</tbody></table>` : '<p>无分级字段。</p>'}
</section>
<section><h2>四、业务明细</h2>
  ${table(columns.map(labelOf), rows.map((r) => `<tr>${columns.map((k) => `<td>${esc(typeof r[k] === 'object' ? JSON.stringify(r[k]) : String(r[k] ?? ''))}</td>`).join('')}</tr>`))}
</section>
<section><h2>五、优化建议</h2><ul>${recommendations.map((r) => `<li>${esc(r)}</li>`).join('') || '<li>按明细逐条处理。</li>'}</ul></section>
<section><h2>六、限制与未决</h2><ul>
  <li>本报告基于当前任务数据集；样本 ${rows.length} / 全量 ${ds.total ?? rows.length}。</li>
  <li>规则由插件 runner 实现；生产使用前需业务确认口径。</li>
</ul></section>
<section><h2>七、附录</h2><table><tbody>
  <tr><th>任务</th><td><code>${esc(jobId || path.basename(path.dirname(source || '')))}</code></td></tr>
</tbody></table></section>`;

await mkdir(path.join(DIR, 'report'), { recursive: true });
await writeFile(OUT, shell({
  title: `${title} · 业务报告`,
  meta: [title, `任务：${jobId || '-'}`, `取数：${ds.fetchedAt || '-'}`],
  kpis,
  body,
  footer: `${title} · 单文件 HTML · 数据可回指任务`,
}), 'utf8');
console.log('报告已生成:', OUT, '| rows:', rows.length, '| total:', ds.total ?? rows.length);
