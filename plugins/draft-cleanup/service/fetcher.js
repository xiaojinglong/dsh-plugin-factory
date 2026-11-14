'use strict';
const { runApiTask } = require('../../../platform/runtime/runner-api');
const TASK = {
  task: 'draft_cleanup',
  path: '/agent/shopee/user/openapi/listing/listing',
  authEnv: 'LISTING_API_KEY',
  pageSize: 20,
  maxPages: 10,
  buildBody: (p, page, pageSize) => ({
    page, pageSize,
    shop_user_id: Number(p.shop_user_id) || 632016,
    shop_user_name: String(p.shop_user_name || '陈雄德'),
    status: String(p.status || 'DRAFT'),
  }),
};
async function runJob(job, ctx) { return runApiTask(job, ctx, TASK); }
module.exports = { runJob, TASK };
