'use strict';

/**
 * server.js —— HTTP 接入层（Fastify）
 *
 * 只做三件事：解析入参 -> 交给 job.js -> 返回结果。
 * 绝不写采集业务、不碰页面选择器。
 *
 * 接口契约（固定范式，新增业务只改入参，不新增路径范式）：
 *   POST /jobs                  提交任务，立即返回 { jobId, status }
 *   GET  /jobs/:jobId           轻量状态查询 { jobId, status, progress, error }
 *   GET  /jobs/:jobId/verify    仅 waiting_verify：返回校验图片二进制流
 *   POST /jobs/:jobId/verify    同一路径的补充动作：提交验证码文本恢复任务（验证码类校验必需）
 *   GET  /jobs/:jobId/result    仅 done：返回 { main, details, missingItems }
 *   GET  /health                健康检查 { ok: true }
 */

const Fastify = require('fastify');
const fsp = require('node:fs/promises');

const { CONFIG, PATHS } = require('./util');
const { JobManager, STATUS } = require('./job');
const crawler = require('./crawler');

/** pino-pretty 为可选依赖：装了才格式化日志，没装就用 JSON 日志，避免启动即崩 */
function resolveLogTransport() {
  if (process.env.NODE_ENV === 'production' || process.env.LOG_PRETTY === 'false') return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } };
  } catch {
    return undefined;
  }
}

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: resolveLogTransport(),
  },
  bodyLimit: 1024 * 1024,
});

const manager = new JobManager();

// 统一错误响应，避免把内部堆栈直接抛给调用方
app.setErrorHandler((err, req, reply) => {
  const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (code >= 500) req.log.error(err);
  reply.code(code).send({ error: err.message || 'internal error' });
});

/* ------------------------------------------------------------------ */
/* 1. POST /jobs —— 提交任务                                           */
/* ------------------------------------------------------------------ */

app.post('/jobs', async (req, reply) => {
  // 入参即业务筛选参数，原样透传给 crawler；兼容 {params:{...}} 包装写法
  let params = req.body ?? {};
  if (params && typeof params === 'object' && params.params && typeof params.params === 'object') {
    params = params.params;
  }
  if (typeof params !== 'object' || Array.isArray(params)) {
    return reply.code(400).send({ error: '请求体必须是 JSON 对象' });
  }

  const { jobId, status } = await manager.createJob(params);
  req.log.info({ jobId }, '任务已入队');
  // 202 Accepted：已接收、异步执行，符合"不阻塞 HTTP"的语义
  return reply.code(202).send({ jobId, status });
});

/* ------------------------------------------------------------------ */
/* 2. GET /jobs/:jobId —— 轻量状态                                      */
/* ------------------------------------------------------------------ */

app.get('/jobs/:jobId', async (req, reply) => {
  const status = manager.getStatus(req.params.jobId);
  if (!status) return notFound(reply, '任务不存在');
  // 只返回状态/进度/错误：高频轮询不携带任何产物 payload
  return reply.send(status);
});

/* ------------------------------------------------------------------ */
/* 3. GET /jobs/:jobId/verify —— 校验图片流                             */
/* ------------------------------------------------------------------ */

app.get('/jobs/:jobId/verify', async (req, reply) => {
  const verify = manager.getVerify(req.params.jobId);
  if (!verify) return notFound(reply, '当前任务不在等待校验状态，或校验已完成');

  if (!verify.buffer) {
    // 没有图片时给文字说明，便于调用方降级处理
    return reply.code(404).send({ error: '该任务无可用的校验图片', hint: verify.hint });
  }
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Verify-Hint', encodeURIComponent(verify.hint || ''));
  return reply.type(verify.contentType).send(verify.buffer);
});

/* ------------------------------------------------------------------ */
/* 4. POST /jobs/:jobId/verify —— 提交验证码（同一路径的写动作）          */
/* ------------------------------------------------------------------ */

app.post('/jobs/:jobId/verify', async (req, reply) => {
  const jobId = req.params.jobId;
  const status = manager.getStatus(jobId);
  if (!status) return notFound(reply, '任务不存在');
  if (status.status !== STATUS.WAITING_VERIFY) {
    return reply.code(409).send({ error: `当前状态为 ${status.status}，不在等待校验`, jobId, status: status.status });
  }

  const code = req.body && (req.body.code ?? req.body.captcha);
  const result = manager.resolveVerify(jobId, code ? String(code) : null);
  if (!result.ok) return reply.code(409).send({ error: '恢复校验失败', reason: result.reason });
  return reply.send({ jobId, status: STATUS.RUNNING, accepted: code ? 'code' : 'manual' });
});

/* ------------------------------------------------------------------ */
/* 5. GET /jobs/:jobId/result —— 结构化产物清单（仅 done）              */
/* ------------------------------------------------------------------ */

app.get('/jobs/:jobId/result', async (req, reply) => {
  const jobId = req.params.jobId;
  const status = manager.getStatus(jobId);
  if (!status) return notFound(reply, '任务不存在');
  if (status.status !== STATUS.DONE) {
    return reply.code(409).send({ error: `任务未完成（当前 ${status.status}）`, jobId, status: status.status });
  }

  const result = await manager.getResult(jobId);
  if (!result) return notFound(reply, '产物清单不存在');
  return reply.send(result);
});

/* ------------------------------------------------------------------ */
/* 6. GET /health —— 健康检查                                          */
/* ------------------------------------------------------------------ */

app.get('/health', async () => ({ ok: true }));

/** 附加（非契约必需）：便于排查/运维的内部指标，路径带前缀，不与业务契约冲突 */
app.get('/internal/stats', async () => ({
  ok: true,
  mode: CONFIG.demoMode ? 'demo' : 'real',
  currentJobId: manager.currentJobId,
  queue: manager.queue.length,
  jobs: manager.jobs.size,
  stats: manager.stats,
  uptimeSec: Math.round(process.uptime()),
}));

function notFound(reply, message) {
  return reply.code(404).send({ error: message });
}

/* ------------------------------------------------------------------ */
/* 7. 启动 / 优雅退出                                                  */
/* ------------------------------------------------------------------ */

async function bootstrap() {
  await fsp.mkdir(PATHS.jobsDir, { recursive: true });
  await fsp.mkdir(PATHS.sessionsDir, { recursive: true });

  manager.setRunner(crawler.runJob);
  await manager.start();

  await app.listen({ host: CONFIG.host, port: CONFIG.port });

  const base = `http://${CONFIG.host}:${CONFIG.port}`;
  app.log.info(`爬虫服务已启动 ${base}`);
  app.log.info(
    `模式：${CONFIG.demoMode ? 'DEMO（本地模拟页）' : `真实站点 ${CONFIG.targetBaseUrl}`} | ` +
      `headless=${CONFIG.headless} | 单worker排队 | 数据目录=${PATHS.jobsDir}`
  );

  // 预热浏览器：避免第一个任务承担启动冷启动开销（失败不阻塞服务启动）
  crawler.getBrowser().catch((err) => app.log.warn(`浏览器预热失败：${err.message}`));
}

async function shutdown(signal) {
  app.log.info(`收到 ${signal}，正在优雅退出`);
  try {
    await app.close();
    await manager.stop();
    await crawler.closeBrowser();
  } catch (err) {
    app.log.error(err);
  } finally {
    process.exit(0);
  }
}

['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

process.on('unhandledRejection', (reason) => {
  // 兜底：任何漏网的 Promise 异常都不能带走 HTTP 服务
  app.log.error({ reason }, '未捕获的 Promise 异常');
});
process.on('uncaughtException', (err) => {
  app.log.error({ err }, '未捕获异常（服务继续运行）');
});

bootstrap().catch((err) => {
  console.error('启动失败：', err);
  process.exit(1);
});

module.exports = { app, manager };
