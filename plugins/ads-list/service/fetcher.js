'use strict';
const { runApiTask } = require('../../../platform/runtime/runner-api');
const TASK = {
  task: 'ads_list',
  path: '/agent/shopee/user/openapi/ads/list',
  authEnv: 'LISTING_API_KEY',
  pageSize: 20,
  maxPages: 10,
  buildBody: (p, page, pageSize) => ({
    shop_id: String(p.shop_id || '1097451512'),
    date_time: [String(p.date_from || '2026-11-01'), String(p.date_to || '2026-11-13')],
    page, pageSize,
  }),
};
async function runJob(job, ctx) { return runApiTask(job, ctx, TASK); }
module.exports = { runJob, TASK };
