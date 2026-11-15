'use strict';

/**
 * runtime/index.js —— 插件共享运行时（v3）
 *
 * 职责：HTTP 契约、任务状态机、持久化队列、取消、清理、鉴权、写操作治理、指标、日志。
 * 插件只提供：id / taskType / runJob(job, ctx)。
 *
 * HTTP：
 *   POST /jobs                 {params} → 202 {jobId,status}
 *   GET  /jobs/:id             → {jobId,status,progress,error}
 *   GET  /jobs/:id/result      → 仅 done：{main,details,missingItems}
 *   POST /jobs/:id/cancel      → {jobId,status}
 *   GET  /jobs?status=&limit=  → 任务列表
 *   GET  /health               → {ok,id,version}
 *   GET  /metrics              → 指标 JSON
 */

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const { JobStore } = require('./store');
const { createLogger } = require('./logger');
const { ensureDir, writeJson, cleanupOldJobDirs } = require('./fsutil');

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

function createService(opts) {
  const {
    id,
    port = 8790,
    host = '127.0.0.1',
    dataDir,
    taskType = id,
    version = '1.0.0',
    runJob,
    write = false,
    authToken = '',
    writeToken = '',
    dailyWriteQuota = 20,
    retentionDays = 7,
    logDir,
    onCleanup,
  } = opts || {};
  if (!id || !runJob) throw new Error('createService 需要 id 与 runJob');
  if (!dataDir) throw new Error('createService 需要 dataDir');
  if (typeof runJob !== 'function') throw new Error('runJob 必须是函数');

  const jobsDir = path.join(dataDir, 'jobs');
  const logger = createLogger({ dir: logDir || path.join(dataDir, 'logs'), name: id });
  const store = new JobStore(path.join(dataDir, 'jobs.db'));
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  // 允许无 content-type 的 POST（如 /jobs/:id/cancel），空 body 视为 {}
  app.addContentTypeParser('*', { parseAs: 'string' }, (req, body, done) => {
    try { done(null, body ? JSON.parse(body) : {}); } catch { done(null, {}); }
  });

  const stats = { startedAt: new Date().toISOString(), created: 0, done: 0, failed: 0, cancelled: 0, lastError: null };
  let loopRunning = false;
  let stopping = false;

  /* ------------------------- 上下文 ------------------------- */
  function makeCtx(job) {
    const jobDir = path.join(jobsDir, job.jobId);
    return {
      jobId: job.jobId,
      params: job.params,
      isAborted: () => store.isCancelRequested(job.jobId),
      setProgress: (text) => { store.update(job.jobId, { progress: String(text).slice(0, 200) }); },
      log: (msg) => logger.info({ jobId: job.jobId }, String(msg)),
      addMissing: (itemName, reason) => store.addMissing(job.jobId, itemName, reason),
      saveFile: async ({ kind = 'main', itemName = null, fileName, content, encoding = 'utf8', sourcePath }) => {
        await ensureDir(jobDir);
        const safe = String(fileName).replace(/[\\/:*?"<>|]/g, '_');
        const target = path.join(jobDir, safe);
        if (sourcePath) await fsp.copyFile(sourcePath, target);
        else await fsp.writeFile(target, content, encoding);
        const stat = await fsp.stat(target);
        const rec = {
          kind, itemName, fileName: safe, path: target,
          relativePath: path.relative(dataDir, target).split(path.sep).join('/'),
          size: stat.size, createdAt: new Date().toISOString(),
        };
        store.addFile(job.jobId, rec);
        return rec;
      },
    };
  }

  /* ------------------------- 执行循环 ------------------------- */
  async function runOne(job) {
    const started = Date.now();
    store.update(job.jobId, { status: 'running', startedAt: new Date().toISOString(), progress: '开始执行' });
    try {
      await runJob({ jobId: job.jobId, params: job.params, task: taskType }, makeCtx(job));
      const cancelled = store.isCancelRequested(job.jobId);
      store.update(job.jobId, {
        status: cancelled ? 'cancelled' : 'done',
        progress: cancelled ? '已取消' : '完成',
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      });
      if (cancelled) stats.cancelled += 1; else stats.done += 1;
      logger.info({ jobId: job.jobId, ms: Date.now() - started }, 'job done');
    } catch (err) {
      const message = String(err && err.message ? err.message : err).slice(0, 500);
      const cancelled = store.isCancelRequested(job.jobId);
      store.update(job.jobId, {
        status: cancelled ? 'cancelled' : 'failed',
        progress: cancelled ? '已取消' : '执行失败',
        error: cancelled ? null : message,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      });
      if (cancelled) stats.cancelled += 1; else { stats.failed += 1; stats.lastError = message; }
      logger[cancelled ? 'info' : 'error']({ jobId: job.jobId, ms: Date.now() - started, err: message }, cancelled ? 'job cancelled' : 'job failed');
    }
  }

  async function loop() {
    if (loopRunning || stopping) return;
    loopRunning = true;
    try {
      for (;;) {
        if (stopping) break;
        const job = store.nextQueued();
        if (!job) { await new Promise((r) => setTimeout(r, 300)); continue; }
        await runOne(job);
      }
    } finally { loopRunning = false; }
  }

  /* ------------------------- 鉴权 ------------------------- */
  function authed(req) {
    if (!authToken) return true;
    const raw = String(req.headers.authorization || '');
    const token = raw.replace(/^Bearer\s+/i, '').trim();
    return token === authToken;
  }
  function writeApproved(body) {
    const p = body && body.params ? body.params : (body || {});
    if (!writeToken) return p.confirm_write === true;
    const token = String(p.approval_token || (body && body.approval_token) || '').trim();
    return token === writeToken && p.confirm_write === true;
  }

  /* ------------------------- 路由 ------------------------- */
  app.get('/health', async () => ({ ok: true, id, version, taskType, write, now: new Date().toISOString() }));
  app.get('/internal/stats', async () => ({ ...stats, queue: store.queueSize(), running: store.running()?.jobId || null, uptimeSec: Math.round(process.uptime()) }));

  app.get('/metrics', async () => {
    const rows = store.metrics();
    return { service: id, version, write, ...rows, ...stats, queue: store.queueSize(), uptimeSec: Math.round(process.uptime()) };
  });

  app.post('/jobs', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body || {};
    const params = body.params && typeof body.params === 'object' ? body.params : body;
    const isDry = !!(params && params.dry_run === true);
    if (write && !isDry && !writeApproved(body)) {
      return reply.code(403).send({ error: '写操作被拒绝：需要 confirm_write=true（可先用 dry_run=true 预演）' });
    }
    if (write && !isDry) {
      // 幂等优先于额度：同一 idempotency_key 的重试应拿到原任务，而不是被额度拦截
      const idem = String(params.idempotency_key || '').trim();
      if (idem) {
        const exist = store.findByIdem(idem);
        if (exist) return reply.code(200).send({ jobId: exist.jobId, status: exist.status, deduplicated: true });
      }
      const used = store.writeCountToday();
      if (used >= dailyWriteQuota) return reply.code(429).send({ error: `今日写操作额度已用尽（${used}/${dailyWriteQuota}）` });
    }
    const jobId = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
    // 幂等键只在"真实写"场景生效（dry_run/只读任务不落幂等键，避免唯一索引冲突 500）
    const idempotencyKey = (write && !isDry) ? String(params.idempotency_key || '').slice(0, 120) : '';
    const job = store.create({ jobId, task: taskType, params, idempotencyKey, dryRun: isDry });
    stats.created += 1;
    logger.info({ jobId, write, dryRun: isDry }, 'job created');
    setImmediate(() => loop());
    return reply.code(202).send({ jobId: job.jobId, status: job.status });
  });

  app.get('/jobs', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' });
    const { status, limit } = req.query || {};
    return { jobs: store.list({ status, limit: Number(limit) || 50 }) };
  });

  app.get('/jobs/:jobId', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' });
    const job = store.get(req.params.jobId);
    if (!job) return reply.code(404).send({ error: '任务不存在' });
    return { jobId: job.jobId, status: job.status, progress: job.progress, error: job.error };
  });

  app.post('/jobs/:jobId/cancel', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' });
    const job = store.get(req.params.jobId);
    if (!job) return reply.code(404).send({ error: '任务不存在' });
    if (TERMINAL.has(job.status)) return { jobId: job.jobId, status: job.status };
    store.cancel(job.jobId);
    return { jobId: job.jobId, status: 'cancelling' };
  });

  app.get('/jobs/:jobId/result', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' });
    const job = store.get(req.params.jobId);
    if (!job) return reply.code(404).send({ error: '任务不存在' });
    if (job.status !== 'done') return reply.code(409).send({ error: `任务未完成（当前 ${job.status}）`, jobId: job.jobId, status: job.status });
    const files = store.files(job.jobId);
    const main = files.find((f) => f.kind === 'main') || null;
    return { main, details: files.filter((f) => f.kind === 'detail'), artifacts: files, missingItems: store.missing(job.jobId) };
  });

  /* ------------------------- 生命周期 ------------------------- */
  async function start() {
    await ensureDir(jobsDir);
    await ensureDir(path.join(dataDir, 'logs'));
    // 重启恢复：running → failed(restarted)
    const recovered = store.recoverInterrupted();
    if (recovered) logger.warn({ recovered }, 'interrupted jobs marked failed');
    setImmediate(() => loop());
    // 定期清理
    const timer = setInterval(async () => {
      try { await cleanupOldJobDirs(jobsDir, retentionDays); store.prune(retentionDays); } catch (e) { logger.error({ err: e.message }, 'cleanup failed'); }
    }, 6 * 60 * 60 * 1000);
    timer.unref();
    await app.listen({ host, port });
    logger.info({ port, host }, 'service listening');
    return { app, store };
  }

  async function stop() {
    stopping = true;
    try { await app.close(); } catch { /* ignore */ }
    try { store.close(); } catch { /* ignore */ }
    logger.info('service stopped');
  }

  return { app, store, start, stop, logger, config: { id, port, taskType, write } };
}

module.exports = { createService };
