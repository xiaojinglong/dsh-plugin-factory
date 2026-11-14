'use strict';

/**
 * fetcher.js —— draft-cleanup 执行层（API 型）
 *
 * 业务：盘点「陈雄德（shop_user_id=632016）」名下 Shopee **草稿（status=DRAFT）** 商品，
 *       取前 2 页，落盘为标准 dataset.json（见 plugin-factory/10-标准产物契约.md）。
 * 接口：POST https://api.giikin.com/agent/shopee/user/openapi/listing/listing
 * 实测（2026-11-13 探针 probe/probe-draft.mjs）：
 *  - shop_user_name='陈雄德' + status='DRAFT' → total=1021 / totalPages=52；第 2 页可取到 20 条
 *  - 不传 status → 2832（全部，草稿+在售）；status='NORMAL' → 34（在售）
 *  - status 取值大小写不敏感（DRAFT / draft 结果一致）；pageSize 请求值被忽略，固定 20 条/页
 */

const { runTask } = require('./api-runner');

const TASK = {
  task: 'draft_cleanup',
  path: '/agent/shopee/user/openapi/listing/listing',
  authEnv: 'LISTING_API_KEY',
  pageSize: 20,
  maxPages: 10,
  buildBody: (p, page, pageSize) => ({
    page,
    pageSize,
    shop_user_id: Number(p.shop_user_id) || 632016,
    shop_user_name: String(p.shop_user_name || '陈雄德'),
    status: String(p.status || 'DRAFT').toUpperCase(),
  }),
};

async function runJob(job, ctx) {
  return runTask(job, ctx, TASK);
}

module.exports = { runJob, TASK };
