'use strict';

/**
 * api-runner.js —— 通用 API 执行层（同一数据源多业务 task 复用）
 *
 * 通过 taskConfig 描述「调哪个接口、传什么参数、怎么分页」，fetcher.js 只写配置。
 * 与爬虫型保持同一契约：runTask(job, ctx) 只回报进度、登记产物。
 */

const { withRetry } = require('./util');

const DEFAULTS = {
  baseUrl: 'https://api.giikin.com',
  authEnv: 'LISTING_API_KEY',
  timeoutMs: 60000,
  maxPages: 10,
  pageSize: 20,
};

async function postJson(url, authKey, body, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${authKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`接口返回非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`);
  }
  if (json.code !== 200) {
    throw new Error(`接口业务失败 code=${json.code}：${String(json.message || json.msg || '').slice(0, 160)}`);
  }
  return json.data || {};
}

/**
 * @param {object} job
 * @param {object} ctx  job.js 注入的上下文
 * @param {object} taskConfig
 *   { task, path, authEnv?, baseUrl?, pageSize?, maxPages?, buildBody(params, page, pageSize) }
 */
async function runTask(job, ctx, taskConfig) {
  const cfg = { ...DEFAULTS, ...taskConfig };
  const p = ctx.params || {};
  const authKey = String(p.auth_key || process.env[cfg.authEnv] || '').trim();
  if (!authKey) throw new Error(`缺少凭证：请通过 params.auth_key 或环境变量 ${cfg.authEnv} 提供`);

  const pages = Math.max(1, Math.min(cfg.maxPages, Number(p.pages) || 2));
  const pageSize = Math.max(1, Math.min(200, Number(p.pageSize) || cfg.pageSize));
  const url = `${cfg.baseUrl}${cfg.path}`;

  const pagesData = [];
  let total = 0;
  let totalPages = 0;
  let extra = {};

  for (let page = 1; page <= pages; page += 1) {
    if (ctx.isAborted()) throw new Error('任务已被终止');
    ctx.setProgress(`拉取第 ${page}/${pages} 页（${cfg.task}）`);

    const data = await withRetry(
      () => postJson(url, authKey, cfg.buildBody(p, page, pageSize), cfg.timeoutMs),
      { retries: 1, delayMs: 900, label: `第 ${page} 页`, onRetry: () => ctx.setProgress(`重试第 ${page} 页`) }
    );

    const pag = data.pagination || {};
    total = Number(pag.total ?? data.total ?? total);
    totalPages = Number(pag.totalPages ?? totalPages);
    const rows = Array.isArray(data.list) ? data.list : Array.isArray(data.campaigns) ? data.campaigns : [];
    extra = { ...extra, ...Object.fromEntries(Object.entries(data).filter(([k]) => !['list', 'campaigns', 'pagination'].includes(k))) };

    if (!rows.length) {
      ctx.log(`第 ${page} 页无数据，提前结束`);
      break;
    }
    pagesData.push({ page, rows });
    ctx.log(`第 ${page} 页 ${rows.length} 条（全量 ${total}，总页数 ${totalPages}）`);
  }

  const dataset = {
    task: cfg.task,
    fetchedAt: new Date().toISOString(),
    params: { ...p, pages: pagesData.length, pageSize },
    extra,
    total,
    totalPages,
    pages: pagesData,
  };
  const rowCount = pagesData.reduce((s, x) => s + x.rows.length, 0);

  ctx.setProgress(`整理产物（${rowCount} 条）`);
  await ctx.saveFile({
    kind: 'main',
    fileName: `${cfg.task}_dataset.json`,
    content: JSON.stringify(dataset, null, 2),
    encoding: 'utf8',
  });
  ctx.log(`完成：${pagesData.length} 页 / ${rowCount} 条 / 全量 ${total}`);
}

module.exports = { runTask };
