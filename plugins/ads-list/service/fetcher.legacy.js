'use strict';

/** ads-list 执行层：广告活动盘点（接口 /ads/list） */
const { runTask } = require('./api-runner');

const TASK = {
  task: 'ads_list',
  path: '/agent/shopee/user/openapi/ads/list',
  authEnv: 'LISTING_API_KEY',
  pageSize: 20,
  maxPages: 10,
  buildBody: (p, page, pageSize) => ({
    shop_id: String(p.shop_id || '1097451512'),
    date_time: [String(p.date_from || '2026-11-01'), String(p.date_to || '2026-11-13')],
    page,
    pageSize,
  }),
};

async function runJob(job, ctx) {
  return runTask(job, ctx, TASK);
}

module.exports = { runJob };
