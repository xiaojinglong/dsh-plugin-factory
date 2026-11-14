'use strict';

/**
 * runner-api.js —— 共享 API 执行层（原 api-runner.js）
 * 插件只需提供 taskConfig：{ task, path, authEnv, pageSize, maxPages, buildBody }
 */

const DEFAULT_BASE = 'https://api.giikin.com';

async function postJson(url, authKey, body, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${authKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`接口返回非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`); }
  if (json.code !== 200) throw new Error(`接口业务失败 code=${json.code}：${String(json.message || json.msg || '').slice(0, 160)}`);
  return json.data || {};
}

async function retryOnce(fn, label, onRetry) {
  try { return await fn(); } catch (e) {
    if (onRetry) onRetry(e);
    await new Promise((r) => setTimeout(r, 900));
    return fn();
  }
}

async function runApiTask(job, ctx, taskConfig) {
  const cfg = {
    baseUrl: DEFAULT_BASE, authEnv: 'LISTING_API_KEY', timeoutMs: 60000,
    maxPages: 10, pageSize: 20, ...taskConfig,
  };
  const p = ctx.params || {};
  const authKey = String(p.auth_key || process.env[cfg.authEnv] || '').trim();
  if (!authKey) throw new Error(`缺少凭证：params.auth_key 或环境变量 ${cfg.authEnv}`);
  const pages = Math.max(1, Math.min(cfg.maxPages, Number(p.pages) || 2));
  const pageSize = Math.max(1, Math.min(200, Number(p.pageSize) || cfg.pageSize));
  const url = `${cfg.baseUrl}${cfg.path}`;

  const pagesData = []; let total = 0; let totalPages = 0; let extra = {};
  for (let page = 1; page <= pages; page += 1) {
    if (ctx.isAborted()) throw new Error('任务已被终止');
    ctx.setProgress(`拉取第 ${page}/${pages} 页（${cfg.task}）`);
    const data = await retryOnce(() => postJson(url, authKey, cfg.buildBody(p, page, pageSize), cfg.timeoutMs), `第 ${page} 页`);
    const pag = data.pagination || {};
    total = Number(pag.total ?? data.total ?? total);
    totalPages = Number(pag.totalPages ?? totalPages);
    const rows = Array.isArray(data.list) ? data.list : (Array.isArray(data.campaigns) ? data.campaigns : []);
    extra = { ...extra, ...Object.fromEntries(Object.entries(data).filter(([k]) => !['list', 'campaigns', 'pagination'].includes(k))) };
    if (!rows.length) { ctx.log(`第 ${page} 页无数据`); break; }
    pagesData.push({ page, rows });
  }

  const dataset = {
    task: cfg.task,
    fetchedAt: new Date().toISOString(),
    params: { ...p, pages: pagesData.length, pageSize },
    extra, total, totalPages,
    pages: pagesData,
  };
  const rowCount = pagesData.reduce((s, x) => s + x.rows.length, 0);
  ctx.setProgress(`整理产物（${rowCount} 条）`);
  await ctx.saveFile({ kind: 'main', fileName: `${cfg.task}_dataset.json`, content: JSON.stringify(dataset, null, 2), encoding: 'utf8' });
  ctx.log(`完成：${pagesData.length} 页 / ${rowCount} 条 / 全量 ${total}`);
}

module.exports = { runApiTask };
