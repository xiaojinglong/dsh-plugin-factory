'use strict';

/**
 * fetcher.js —— listing-list 执行层（API 型）
 *
 * 与爬虫型完全相同的契约：只实现 runJob(job, ctx)，通过 ctx 回报进度、登记产物。
 * 业务：调用 Shopee Listing 开放接口，取前 N 页在售商品数据，落盘为 JSON。
 *
 * 接口：POST https://api.giikin.com/agent/shopee/user/openapi/listing/listing
 * 鉴权：Authorization: Bearer <dk 凭证>（由 params.auth_key 或环境变量 LISTING_API_KEY 提供）
 * 实测要点：
 *  - shop_user_id 不生效；生效过滤是 shop_user_name（+ status="NORMAL" 才是真实在售）
 *  - pageSize 实际固定 20；sort_type/shop_status/status(int)/is_check_org 等会 500
 */

const API = 'https://api.giikin.com/agent/shopee/user/openapi/listing/listing';
const { withRetry } = require('./util');

function buildBody(page, pageSize, p) {
  return {
    page,
    pageSize,
    shop_user_id: Number(p.shop_user_id) || 632016,
    shop_user_name: String(p.shop_user_name || '陈雄德'),
    status: String(p.status || 'NORMAL'),
  };
}

async function fetchPage(authKey, page, pageSize, p) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${authKey}` },
    body: JSON.stringify(buildBody(page, pageSize, p)),
    signal: AbortSignal.timeout(60000),
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
 * 任务执行入口（与 crawler.js 的 runJob 同签名）
 * params：shop_user_id / shop_user_name / status / pages（默认 2）/ pageSize
 */
async function runJob(job, ctx) {
  const p = ctx.params || {};
  const authKey = String(p.auth_key || process.env.LISTING_API_KEY || '').trim();
  if (!authKey) throw new Error('缺少凭证：请通过 params.auth_key 或环境变量 LISTING_API_KEY 提供');

  const pages = Math.max(1, Math.min(10, Number(p.pages) || 2));
  const pageSize = Math.max(1, Math.min(20, Number(p.pageSize) || 20));

  const pagesData = [];
  let total = 0;
  let totalPages = 0;

  for (let page = 1; page <= pages; page += 1) {
    if (ctx.isAborted()) throw new Error('任务已被终止');
    ctx.setProgress(`拉取第 ${page}/${pages} 页（shop_user_name=${p.shop_user_name || '陈雄德'}）`);

    const data = await withRetry(() => fetchPage(authKey, page, pageSize, p), {
      retries: 1,
      delayMs: 900,
      label: `第 ${page} 页`,
      onRetry: () => ctx.setProgress(`重试第 ${page} 页`),
    });

    total = Number(data.pagination?.total ?? total);
    totalPages = Number(data.pagination?.totalPages ?? totalPages);
    const rows = Array.isArray(data.list) ? data.list : [];
    if (!rows.length) {
      ctx.log(`第 ${page} 页无数据，提前结束`);
      break;
    }
    pagesData.push({ page, rows });
    ctx.log(`第 ${page} 页 ${rows.length} 条（全量 ${total}，总页数 ${totalPages}）`);
  }

  const dataset = {
    task: 'listing_list',
    fetchedAt: new Date().toISOString(),
    params: {
      shop_user_id: Number(p.shop_user_id) || 632016,
      shop_user_name: String(p.shop_user_name || '陈雄德'),
      status: String(p.status || 'NORMAL'),
      pages: pagesData.length,
      pageSize,
    },
    total,
    totalPages,
    pages: pagesData,
  };
  const rowCount = pagesData.reduce((s, x) => s + x.rows.length, 0);

  ctx.setProgress(`整理产物（${rowCount} 条）`);
  await ctx.saveFile({
    kind: 'main',
    fileName: 'listing_dataset.json',
    content: JSON.stringify(dataset, null, 2),
    encoding: 'utf8',
  });
  ctx.log(`完成：${pagesData.length} 页 / ${rowCount} 条 / 全量 ${total}`);
}

module.exports = { runJob };
