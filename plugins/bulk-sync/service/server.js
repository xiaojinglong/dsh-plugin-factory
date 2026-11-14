'use strict';

/**
 * bulk-sync 统一启动入口：
 * 1) 启动内置模拟上游（随机端口）→ 写入 process.env.MOCK_UPSTREAM_URL
 * 2) 再走共享 runtime bootstrap（manifest 单一事实源 + DPAPI + 鉴权 + SQLite 任务引擎）
 */

const { startMockUpstream } = require('./mock-upstream');
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/bulk-sync.json');

(async () => {
  const mock = await startMockUpstream();
  process.env.MOCK_UPSTREAM_URL = mock.url;
  console.log(`[bulk-sync] mock upstream listening ${mock.url}`);
  boot(manifest, require('./fetcher').runJob);
})().catch((err) => {
  console.error('[bulk-sync] 启动失败：', err);
  process.exit(1);
});
