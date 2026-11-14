// migrate.mjs —— 把现有 8 个插件迁移到 v3：manifest + 共享 runtime 启动入口 + 凭证加密 + token
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = 'D:/www/dsh-plugin-factory';
const MAN = path.join(ROOT, 'platform', 'manifests');
fs.mkdirSync(MAN, { recursive: true });

const API_PLUGINS = {
  'listing-list': {
    name: '商品 listing 盘点', port: 8791, taskType: 'listing_list', pageSize: 20, task: 'listing_list',
    path: '/agent/shopee/user/openapi/listing/listing',
    body: `{
    page, pageSize,
    shop_user_id: Number(p.shop_user_id) || 632016,
    shop_user_name: String(p.shop_user_name || '陈雄德'),
    status: String(p.status || 'NORMAL'),
  }`,
    report: ['gen-report.mjs', 'report/listing-list-report.html'],
  },
  'shop-list': {
    name: '店铺盘点', port: 8792, taskType: 'shop_list', pageSize: 100, task: 'shop_list',
    path: '/agent/shopee/user/openapi/shop/list',
    body: `{ user_id: Number(p.user_id) || 632016, page, pageSize }`,
    report: ['gen-report-shop.mjs', 'report/shop-list-report.html'],
  },
  'ads-list': {
    name: '广告活动盘点', port: 8793, taskType: 'ads_list', pageSize: 20, task: 'ads_list',
    path: '/agent/shopee/user/openapi/ads/list',
    body: `{
    shop_id: String(p.shop_id || '1097451512'),
    date_time: [String(p.date_from || '2026-11-01'), String(p.date_to || '2026-11-13')],
    page, pageSize,
  }`,
    report: ['gen-report-ads.mjs', 'report/ads-list-report.html'],
  },
  'draft-cleanup': {
    name: '草稿商品清理', port: 8794, taskType: 'draft_cleanup', pageSize: 20, task: 'draft_cleanup',
    path: '/agent/shopee/user/openapi/listing/listing',
    body: `{
    page, pageSize,
    shop_user_id: Number(p.shop_user_id) || 632016,
    shop_user_name: String(p.shop_user_name || '陈雄德'),
    status: String(p.status || 'DRAFT'),
  }`,
    report: ['gen-report-draft.mjs', 'report/draft-cleanup-report.html'],
  },
  'stock-alert': {
    name: '缺货预警', port: 8795, taskType: 'stock_alert', pageSize: 20, task: 'stock_alert',
    path: '/agent/shopee/user/openapi/listing/listing',
    body: `{
    page, pageSize,
    shop_user_id: Number(p.shop_user_id) || 632016,
    shop_user_name: String(p.shop_user_name || '陈雄德'),
    status: String(p.status || 'NORMAL'),
  }`,
    report: ['gen-report.mjs', 'report/stock-alert-report.html'],
  },
};

const CRAWLERS = {
  'haina-comment': { name: '海纳博客评论', port: 8796, taskType: 'haina_comment', write: true, secrets: ['HAINA_EMAIL', 'HAINA_PASSWORD'] },
  'gsmp-academy': { name: 'AI学苑课程播放', port: 8797, taskType: 'gsmp_academy', write: false, secrets: [] },
};

function token() { return crypto.randomBytes(16).toString('hex'); }
function writeJson(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8'); }

const all = [];
for (const [id, cfg] of Object.entries(API_PLUGINS)) {
  const dir = path.join(ROOT, id, 'service');
  const manifest = {
    id, name: cfg.name, type: 'api', version: '3.0.0',
    port: cfg.port, taskType: cfg.taskType, serverName: id,
    service: { dir, entry: 'server.js', runner: 'fetcher.js', dataDir: path.join(dir, 'data'), startCmd: ['node', ['server.js']] },
    runtime: { write: false, retentionDays: 7, token: true, toolTimeoutMs: 600000 },
    mcp: { dir: `D:/www/dshskills/tools/${id}-mcp` },
    skill: { dir: `D:/www/dshskills/skills/${id}` },
    report: { generator: path.join(ROOT, id, cfg.report[0]), output: path.join(ROOT, id, cfg.report[1]) },
    secrets: ['LISTING_API_KEY'],
    legacy: false,
  };
  manifest.runtime.serviceToken = token();
  writeJson(path.join(MAN, `${id}.json`), manifest);
  // 统一启动入口
  fs.copyFileSync(path.join(dir, 'server.js'), path.join(dir, 'server.legacy.js'));
  fs.writeFileSync(path.join(dir, 'server.js'), `'use strict';
const path = require('node:path');
const { boot } = require('../../platform/factory/bootstrap');
const manifest = require('../../platform/manifests/${id}.json');
boot(manifest, require('./fetcher').runJob);
`, 'utf8');
  // fetcher 改为 TASK 配置（去掉本地 api-runner 依赖）
  fs.copyFileSync(path.join(dir, 'fetcher.js'), path.join(dir, 'fetcher.legacy.js'));
  fs.writeFileSync(path.join(dir, 'fetcher.js'), `'use strict';
const { runApiTask } = require('../../platform/runtime/runner-api');
const TASK = {
  task: '${cfg.task}',
  path: '${cfg.path}',
  authEnv: 'LISTING_API_KEY',
  pageSize: ${cfg.pageSize},
  maxPages: 10,
  buildBody: (p, page, pageSize) => (${cfg.body}),
};
async function runJob(job, ctx) { return runApiTask(job, ctx, TASK); }
module.exports = { runJob, TASK };
`, 'utf8');
  all.push(manifest);
}

for (const [id, cfg] of Object.entries(CRAWLERS)) {
  const dir = path.join(ROOT, id, 'service');
  const manifest = {
    id, name: cfg.name, type: 'browser', version: '3.0.0',
    port: cfg.port, taskType: cfg.taskType, serverName: id,
    service: { dir, entry: 'server.js', runner: 'crawler.js', dataDir: path.join(dir, 'data'), startCmd: ['node', ['server.js']] },
    runtime: { write: !!cfg.write, retentionDays: 7, token: true, toolTimeoutMs: cfg.write ? 1200000 : 1800000 },
    mcp: { dir: `D:/www/dshskills/tools/${id}-mcp` },
    skill: { dir: `D:/www/dshskills/skills/${id}` },
    report: null,
    secrets: ['LISTING_API_KEY', ...cfg.secrets],
    legacy: false,
  };
  manifest.runtime.serviceToken = token();
  writeJson(path.join(MAN, `${id}.json`), manifest);
  fs.copyFileSync(path.join(dir, 'server.js'), path.join(dir, 'server.legacy.js'));
  fs.writeFileSync(path.join(dir, 'server.js'), `'use strict';
const path = require('node:path');
const { boot } = require('../../platform/factory/bootstrap');
const manifest = require('../../platform/manifests/${id}.json');
boot(manifest, require('./crawler').runJob);
`, 'utf8');
  all.push(manifest);
}

// legacy：经营分析（爬虫，保持原样）
const legacy = {
  id: 'concise-analysis', name: '经营分析', type: 'crawler', version: '1.0.0',
  port: 8790, taskType: 'jingying_analysis', serverName: 'concise-analysis',
  service: { dir: ROOT, entry: 'src/server.js', dataDir: path.join(ROOT, 'data'), startCmd: ['node', ['src/server.js']] },
  runtime: { write: false, retentionDays: 7, token: false, toolTimeoutMs: 900000 },
  mcp: { dir: 'D:/www/dshskills/tools/concise-analysis-mcp' },
  skill: { dir: 'D:/www/dshskills/skills/concise-analysis' },
  report: null, secrets: [], legacy: true,
};
writeJson(path.join(MAN, 'concise-analysis.json'), legacy);
all.push(legacy);

console.log('manifests:', all.map((m) => `${m.id}:${m.port}`).join(', '));
console.log('tokens:', all.filter((m) => m.runtime.serviceToken).map((m) => m.id).join(', '));
