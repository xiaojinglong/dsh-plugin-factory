'use strict';

/** shop-list 执行层：店铺盘点（接口 /shop/list） */
const { runTask } = require('./api-runner');

const TASK = {
  task: 'shop_list',
  path: '/agent/shopee/user/openapi/shop/list',
  authEnv: 'LISTING_API_KEY',
  pageSize: 100,
  maxPages: 10,
  buildBody: (p, page, pageSize) => ({
    user_id: Number(p.user_id) || 632016,
    page,
    pageSize,
  }),
};

async function runJob(job, ctx) {
  return runTask(job, ctx, TASK);
}

module.exports = { runJob };
