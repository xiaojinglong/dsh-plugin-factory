'use strict';

/**
 * fetcher.js —— stock_alert（缺货预警）执行层配置
 * 只写任务配置；分页/重试/落盘全部由 api-runner 负责。
 * 字段校准见 D:\www\dshskills\skills\stock-alert\SKILL.md
 */
const { runTask } = require('./api-runner');

const TASK = {
  task: 'stock_alert',
  path: '/agent/shopee/user/openapi/listing/listing',
  authEnv: 'LISTING_API_KEY',
  pageSize: 20, // 接口固定单页 20 条（pageSize=100 实测仍返回 20）
  maxPages: 10,
  buildBody: (p, page, pageSize) => ({
    page,
    pageSize,
    // 实测生效：shop_user_name；status 大小写等价；shop_user_id/pageSize 被静默忽略
    shop_user_name: String(p.shop_user_name || '陈雄德'),
    status: String(p.status || 'NORMAL'),
  }),
};

async function runJob(job, ctx) {
  return runTask(job, ctx, TASK);
}

module.exports = { runJob };
