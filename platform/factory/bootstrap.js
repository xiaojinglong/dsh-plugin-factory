'use strict';

/** bootstrap.js —— 插件统一启动入口（供各插件 server.js 调用） */
const path = require('node:path');
const fs = require('node:fs');
const { createService } = require('../runtime');
const { hydrate } = require('../runtime/secrets');

/** 极简 .env 加载（仅非敏感配置；敏感项走 DPAPI secrets） */
function loadEnvFile(dir) {
  const f = path.join(dir, '.env');
  if (!fs.existsSync(f)) return {};
  const out = {};
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
    out[k] = v;
  }
  return out;
}

/**
 * @param {object} manifest  plugin.json 内容
 * @param {function} runJob  (job, ctx) => Promise
 */
function boot(manifest, runJob, cleanup) {
  const serviceDir = manifest.service.dir;
  loadEnvFile(serviceDir);
  hydrate(manifest.id, manifest.secrets || []);
  const svc = createService({
    id: manifest.id,
    port: Number(process.env.PORT || manifest.port),
    taskType: manifest.taskType,
    version: manifest.version,
    dataDir: path.join(serviceDir, 'data'),
    runJob,
    write: !!(manifest.runtime && manifest.runtime.write),
    // 鉴权：env 优先（运维覆盖），否则回退到 manifest 的 serviceToken（单一事实源）
    authToken: String(process.env.SERVICE_TOKEN || (manifest.runtime && manifest.runtime.serviceToken) || ''),
    writeToken: String(process.env.WRITE_APPROVAL_TOKEN || (manifest.runtime && manifest.runtime.writeToken) || ''),
    dailyWriteQuota: Number(process.env.WRITE_DAILY_QUOTA || 20),
    retentionDays: Number(process.env.JOB_RETENTION_DAYS || 7),
  });
  const shutdown = async (sig) => {
    console.log(`[${manifest.id}] 收到 ${sig}，退出`);
    try { if (typeof cleanup === 'function') await cleanup(); } catch { /* ignore */ }
    await svc.stop().catch(() => {});
    process.exit(0);
  };
  ['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
  svc.start().then(() => {
    console.log(`[${manifest.id}] listening on ${manifest.port}`);
  }).catch((e) => { console.error(`[${manifest.id}] 启动失败：`, e); process.exit(1); });
  return svc;
}

module.exports = { boot, loadEnvFile };
