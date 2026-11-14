'use strict';

/**
 * page-audit 统一启动入口：
 * 1) 启动内置静态站点（随机端口）→ process.env.PAGE_AUDIT_BASE
 * 2) 走共享 runtime bootstrap（manifest + 鉴权 + SQLite 任务引擎）
 */

const { startFixtureServer } = require('./fixture-server');
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/page-audit.json');

(async () => {
  const site = await startFixtureServer();
  process.env.PAGE_AUDIT_BASE = site.url;
  console.log(`[page-audit] fixture site listening ${site.url}`);
  boot(manifest, require('./crawler').runJob);
})().catch((err) => {
  console.error('[page-audit] 启动失败：', err);
  process.exit(1);
});
