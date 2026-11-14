// report-kit.mjs —— 插件工厂共享报告套件（单文件 HTML）
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
export const f2 = (v) => n(v).toFixed(2);
export const pct = (a, b) => (b ? (a / b) * 100 : 0).toFixed(1);
export const sum = (arr, f) => arr.reduce((s, r) => s + n(f(r)), 0);
export const cnt = (arr, f) => arr.filter(f).length;
export const uniq = (arr) => [...new Set(arr.filter((x) => x !== undefined && x !== null && x !== ''))];
export const top = (arr, f, limit = 10) => {
  const m = new Map();
  for (const r of arr) { const k = f(r) || '(空)'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
};
export const bar = (v, max, color = '#3b82f6') => {
  const w = max ? Math.max(2, Math.round((v / max) * 100)) : 0;
  return `<div class="bar"><span style="width:${w}%;background:${color}"></span></div>`;
};
export const table = (headers, rows, cls = '') =>
  `<table class="${cls}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
export const distTable = (headers, entries, total) =>
  table(headers, entries.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td class="num">${pct(v, total)}%</td><td>${bar(v, Math.max(...entries.map((x) => x[1])))}</td></tr>`));

const CSS = `
:root{--bg:#f1f5f9;--panel:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:#2563eb;--ok:#059669;--warn:#d97706;--bad:#dc2626}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
header{background:linear-gradient(135deg,#1e3a8a,#2563eb 55%,#0ea5e9);color:#fff;border-radius:16px;padding:26px 30px}
header h1{margin:0 0 8px;font-size:25px}header .meta{opacity:.92;font-size:13px}header .meta span{margin-right:16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:18px 0 8px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.kpi .k{color:var(--muted);font-size:12px}.kpi .v{font-size:23px;font-weight:700;margin-top:4px}.kpi .s{font-size:12px;color:var(--muted)}
section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-top:18px}
h2{font-size:17px;margin:0 0 14px;padding-left:10px;border-left:4px solid var(--brand)}
h3{font-size:14px;margin:16px 0 8px;color:#334155}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:#f8fafc;color:#475569;font-weight:600;white-space:nowrap}tbody tr:hover{background:#f8fafc}
.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{background:#eef2f7;border-radius:6px;height:8px;min-width:80px;overflow:hidden}.bar span{display:block;height:100%}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:860px){.grid2{grid-template-columns:1fr}}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid}
.t-high{color:var(--bad);border-color:#fecaca;background:#fef2f2}.t-mid{color:var(--warn);border-color:#fde68a;background:#fffbeb}.t-ok{color:var(--ok);border-color:#a7f3d0;background:#ecfdf5}
.note{color:var(--muted);font-size:12px;margin-top:8px}ul{margin:8px 0 0 18px;padding:0}li{margin:4px 0}
code{background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:12px}
footer{color:var(--muted);font-size:12px;margin-top:22px;text-align:center}`;

export function shell({ title, meta = [], kpis = [], body, footer = '' }) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">
<header><h1>${esc(title)}</h1><div class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}<span>生成时间：${esc(now)}</span></div></header>
<div class="kpis">${kpis.map((k) => `<div class="kpi"><div class="k">${esc(k.k)}</div><div class="v"${k.color ? ` style="color:${k.color}"` : ''}>${k.v}</div><div class="s">${esc(k.s || '')}</div></div>`).join('')}</div>
${body}
<footer>${esc(footer)}</footer></div></body></html>`;
}
