'use strict';

/**
 * fetcher.js —— bulk-sync 执行层（API 型：分页拉取 + 瞬态失败重试 + 进度 + 可取消）
 * 数据来自本插件内置的模拟上游（service/mock-upstream.js），不访问真实业务系统。
 */

const { runApiTask } = require('../../../platform/runtime/runner-api');

const TASK = {
  task: 'bulk_sync',
  baseUrl: process.env.MOCK_UPSTREAM_URL || 'http://127.0.0.1:18899',
  path: '/mock/orders',
  authEnv: 'MOCK_API_KEY',
  pageSize: 50,
  maxPages: 8,
  buildBody: (p, page, pageSize) => ({
    page,
    pageSize,
    total_rows: Number(p.total_rows) || 240,
    delay_ms: Number(p.delay_ms) || 80,
    fail_first_n: Number(p.fail_first_n) || 0,
    empty: p.empty === true,
  }),
};

async function runJob(job, ctx) { return runApiTask(job, ctx, TASK); }

module.exports = { runJob, TASK };
