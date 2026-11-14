#!/usr/bin/env node
'use strict';

/**
 * apps/control-plane/server.cjs —— A 本地控制面（127.0.0.1:8780）
 *
 * 职责：需求单状态机、证据、审计、插件目录、指标、备份；供 factory-control MCP 与 CLI 调用。
 * 安全：Bearer token（安装/init 生成，存数据根，不入库/不入仓库）；错误统一结构；请求日志 JSON。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const { ControlPlaneStore, STEP_ORDER } = require('./lib/db.cjs');
const { createLogger } = require('./lib/logger.cjs');
const config = require('../../packages/config');
const { validateRunnerSource } = require('../../packages/sdk/runner.cjs');

const VERSION = '0.1.0';
const DEFAULT_PORT = 8780;

function tokenFile(dataRoot) { return path.join(dataRoot, 'control-plane', 'token'); }
function ensureToken(dataRoot) {
  const f = tokenFile(dataRoot);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return token;
}
function readToken(dataRoot) { return ensureToken(dataRoot); }
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function actorOf(req) {
  const v = String(req.headers['x-actor'] || '').trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : 'local';
}
function fail(requestId, reply, statusCode, code, message) {
  return reply.code(statusCode).send({ error: { code, message, requestId } });
}
function asString(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length && t.length <= max ? t : null;
}
function idemFrom(req, body) {
  const h = req.headers['idempotency-key'];
  const raw = Array.isArray(h) ? h[0] : h;
  const key = String(raw || body.idempotency_key || '').trim();
  if (key.length > 120) return { error: 'idempotency key 过长（≤120）' };
  return { key };
}
function loadPlugins() {
  try {
    return fs.readdirSync(config.MANIFEST_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => {
      const m = JSON.parse(fs.readFileSync(path.join(config.MANIFEST_DIR, f), 'utf8'));
      return {
        id: m.id, name: m.name, type: m.type, version: m.version, port: m.port,
        taskType: m.taskType, write: !!(m.runtime && m.runtime.write), legacy: !!m.legacy,
      };
    });
  } catch { return []; }
}

function createControlPlane(opts = {}) {
  const dataRoot = path.resolve(opts.dataRoot || config.FACTORY_DATA_ROOT);
  const token = opts.token ? String(opts.token) : ensureToken(dataRoot);
  const logger = opts.logger || createLogger({ dir: path.join(dataRoot, 'control-plane', 'logs') });
  const store = new ControlPlaneStore(path.join(dataRoot, 'control-plane', 'state.db'));
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });

  const auth = async (req, reply) => {
    const raw = String(req.headers.authorization || '');
    const supplied = raw.replace(/^Bearer\s+/i, '').trim();
    if (!token || !supplied || !safeEqual(supplied, token)) {
      return fail(req.id, reply, 401, 'UNAUTHORIZED', '缺少或无效的 Bearer token');
    }
    return undefined;
  };

  const rateLimit = Number(opts.rateLimit ?? process.env.CONTROL_PLANE_RATE_LIMIT ?? 120);
  if (rateLimit > 0) {
    const buckets = new Map();
    app.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'POST') return undefined;
      const key = req.ip || 'unknown';
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || b.reset <= now) { b = { count: 0, reset: now + 60000 }; buckets.set(key, b); }
      b.count += 1;
      if (b.count > rateLimit) {
        reply.header('retry-after', String(Math.max(1, Math.ceil((b.reset - now) / 1000))));
        return reply.code(429).send({ ok: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试', requestId: req.id } });
      }
      return undefined;
    });
  }

  app.addHook('onResponse', async (req, reply) => {
    logger.info({ requestId: req.id, method: req.method, url: req.url, status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'request');
  });
  app.setNotFoundHandler((req, reply) => fail(req.id, reply, 404, 'NOT_FOUND', `路由不存在：${req.method} ${req.url}`));
  app.setErrorHandler((err, req, reply) => {
    const status = Number(err.statusCode) || 500;
    if (status >= 500) logger.error({ requestId: req.id, err: String(err.message).slice(0, 300) }, 'unhandled');
    return fail(req.id, reply, status, err.code || (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'), status >= 500 ? '内部错误' : String(err.message));
  });

  app.get('/health', async (req, reply) => {
    let dbOk = true;
    try { store.db.prepare('SELECT 1').get(); } catch { dbOk = false; }
    if (!dbOk) reply.code(503);
    return {
      ok: dbOk, service: 'control-plane', version: VERSION, now: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()), checks: { db: dbOk }, rateLimit,
    };
  });

  app.get('/metrics', { preHandler: [auth] }, async () => {
    const dbFile = path.join(dataRoot, 'control-plane', 'state.db');
    let dbSizeBytes = 0;
    try { dbSizeBytes = fs.statSync(dbFile).size; } catch { /* ignore */ }
    return { ok: true, service: 'control-plane', version: VERSION, uptimeSec: Math.round(process.uptime()), dbSizeBytes, rateLimit, ...store.metrics() };
  });

  app.post('/admin/prune-requests', { preHandler: [auth] }, async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const olderThanDays = body.olderThanDays === undefined ? 30 : Number(body.olderThanDays);
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0 || olderThanDays > 3650) {
      return fail(req.id, reply, 400, 'INVALID_DAYS', 'olderThanDays 必须为 0–3650');
    }
    const states = Array.isArray(body.states) ? body.states.map(String) : undefined;
    return { ok: true, ...store.pruneRequests({ olderThanDays, states, dryRun: body.dryRun !== false, actor: actorOf(req), ip: req.ip }) };
  });

  app.post('/admin/prune', { preHandler: [auth] }, async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const olderThanDays = body.olderThanDays === undefined ? 30 : Number(body.olderThanDays);
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0 || olderThanDays > 3650) {
      return fail(req.id, reply, 400, 'INVALID_DAYS', 'olderThanDays 必须为 0–3650');
    }
    const dryRun = body.dryRun !== false;
    return { ok: true, ...store.pruneAudit({ olderThanDays, dryRun, actor: actorOf(req), ip: req.ip }) };
  });

  app.get('/plugins', { preHandler: [auth] }, async () => ({ ok: true, plugins: loadPlugins() }));

  app.post('/requests', { preHandler: [auth] }, async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const brief = asString(body.brief, 5000);
    if (!brief) return fail(req.id, reply, 400, 'INVALID_BRIEF', 'brief 必须为 1–5000 字符字符串');
    let params = {};
    if (body.params !== undefined) {
      if (!body.params || typeof body.params !== 'object' || Array.isArray(body.params)) {
        return fail(req.id, reply, 400, 'INVALID_PARAMS', 'params 必须为对象');
      }
      params = body.params;
    }
    const { key, error } = idemFrom(req, body);
    if (error) return fail(req.id, reply, 400, 'INVALID_IDEMPOTENCY_KEY', error);
    if (key) {
      const existing = store.findIdempotency(key);
      if (existing) return reply.code(200).send({ ok: true, deduplicated: true, request: store.getRequest(existing) });
    }
    try {
      const request = store.createRequest({ brief, params, idempotencyKey: key, actor: actorOf(req), ip: req.ip });
      return reply.code(201).send({ ok: true, request });
    } catch (err) {
      if (/UNIQUE constraint failed: idempotency/.test(String(err.message))) {
        const existing = store.findIdempotency(key);
        if (existing) return reply.code(200).send({ ok: true, deduplicated: true, request: store.getRequest(existing) });
      }
      throw err;
    }
  });

  app.get('/requests', { preHandler: [auth] }, async (req, reply) => {
    const { state } = req.query || {};
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    if (state && !['submitted', 'probe', 'generate', 'validate', 'staging', 'accept', 'installed', 'failed'].includes(state)) {
      return fail(req.id, reply, 400, 'INVALID_STATE', `未知状态：${state}`);
    }
    return { ok: true, requests: store.listRequests({ state, limit }) };
  });

  app.get('/requests/:id', { preHandler: [auth] }, async (req, reply) => {
    const request = store.getRequest(req.params.id);
    if (!request) return fail(req.id, reply, 404, 'REQUEST_NOT_FOUND', `需求单不存在：${req.params.id}`);
    return { ok: true, request };
  });

  app.get('/requests/:id/audit', { preHandler: [auth] }, async (req, reply) => {
    if (!store.getRequest(req.params.id)) return fail(req.id, reply, 404, 'REQUEST_NOT_FOUND', `需求单不存在：${req.params.id}`);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
    return { ok: true, audit: store.auditFor(`request:${req.params.id}`, limit) };
  });

  app.post('/requests/:id/accept', { preHandler: [auth] }, async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const acceptedBy = asString(body.acceptedBy, 128);
    if (!acceptedBy) return fail(req.id, reply, 400, 'MISSING_ACCEPTOR', 'accept 需要 acceptedBy（业务验收人）');
    const request = store.getRequest(req.params.id);
    if (!request) return fail(req.id, reply, 404, 'REQUEST_NOT_FOUND', `需求单不存在：${req.params.id}`);
    if (request.state !== 'staging') {
      return fail(req.id, reply, 409, 'INVALID_STATE', `只有 staging 状态可验收（当前 ${request.state}）`);
    }
    const note = asString(body.note, 1000);
    const evidence = JSON.stringify({ acceptedBy, note, acceptedAt: new Date().toISOString() });
    try {
      store.addStep({ requestId: req.params.id, step: 'accept', status: 'running', actor: acceptedBy, ip: req.ip });
      const updated = store.addStep({
        requestId: req.params.id, step: 'accept', status: 'succeeded', evidence,
        actor: acceptedBy, ip: req.ip,
      });
      return { ok: true, request: updated };
    } catch (err) {
      if (err.statusCode) return fail(req.id, reply, err.statusCode, err.code || 'ERROR', err.message);
      throw err;
    }
  });

  app.post('/requests/:id/runner', { preHandler: [auth] }, async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const source = typeof body.source === 'string' ? body.source : '';
    if (!source || source.length > 200 * 1024) {
      return fail(req.id, reply, 400, 'INVALID_RUNNER', 'source 必须为 1–200KB 字符串');
    }
    const v = validateRunnerSource(source);
    if (!v.ok) return fail(req.id, reply, 400, 'INVALID_RUNNER', v.errors.join('; '));
    const request = store.getRequest(req.params.id);
    if (!request) return fail(req.id, reply, 404, 'REQUEST_NOT_FOUND', `需求单不存在：${req.params.id}`);
    if (request.state !== 'submitted') {
      return fail(req.id, reply, 409, 'INVALID_STATE', `只有 submitted 状态可写入 runner（当前 ${request.state}）`);
    }
    const dir = path.join(dataRoot, 'generator', 'runs', req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    const runnerFile = path.join(dir, 'runner.js');
    fs.writeFileSync(runnerFile, source, 'utf8');
    const sha256 = crypto.createHash('sha256').update(source).digest('hex');
    const updated = store.setRequestParams(req.params.id, { ...request.params, runnerFile }, { actor: actorOf(req), ip: req.ip });
    return {
      ok: true, request: updated, runnerFile, sha256, warnings: v.warnings,
    };
  });

  app.post('/requests/:id/steps', { preHandler: [auth] }, async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const step = asString(body.step, 32);
    const status = asString(body.status, 16);
    if (!step || !['probe', 'generate', 'validate', 'staging', 'accept', 'install', 'note'].includes(step)) {
      return fail(req.id, reply, 400, 'INVALID_STEP', `step 必须为 ${[...STEP_ORDER, 'note'].join('/')}`);
    }
    if (!status || !['running', 'succeeded', 'failed'].includes(status)) {
      return fail(req.id, reply, 400, 'INVALID_STATUS', 'status 必须为 running/succeeded/failed');
    }
    if (status === 'failed' && !asString(body.error, 1000)) {
      return fail(req.id, reply, 400, 'MISSING_ERROR', '失败步骤必须提供 error');
    }
    const evidence = body.evidence === undefined ? '' : String(body.evidence).slice(0, 4000);
    try {
      const request = store.addStep({
        requestId: req.params.id, step, status, evidence,
        error: body.error ? String(body.error).slice(0, 1000) : '', actor: actorOf(req), ip: req.ip,
      });
      return { ok: true, request };
    } catch (err) {
      if (err.statusCode) return fail(req.id, reply, err.statusCode, err.code || 'ERROR', err.message);
      throw err;
    }
  });

  app.get('/audit', { preHandler: [auth] }, async (req) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    return { ok: true, audit: store.listAudit({ limit }) };
  });

  app.post('/admin/backup', { preHandler: [auth] }, async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fileName = asString(body.fileName, 90) || `control-plane-${new Date().toISOString().replace(/[-:TZ.]/g, '')}.db`;
    if (!/^[A-Za-z0-9._-]{1,80}\.db$/.test(fileName)) {
      return fail(req.id, reply, 400, 'INVALID_FILE_NAME', 'fileName 必须是安全的 .db 文件名');
    }
    const dest = path.join(dataRoot, 'control-plane', 'backups', fileName);
    try {
      store.backup(dest);
      store._audit({ actor: actorOf(req), action: 'admin.backup', object: 'control-plane', after: { dest }, ip: req.ip });
      return reply.code(201).send({ ok: true, path: dest });
    } catch (err) {
      return fail(req.id, reply, 500, 'BACKUP_FAILED', `备份失败：${err.message}`);
    }
  });

  async function start({ port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
    await app.listen({ port, host });
    const address = app.server.address();
    const actualPort = address && typeof address === 'object' ? address.port : port;
    logger.info({ port: actualPort, host, dataRoot }, 'control-plane listening');
    return { port: actualPort, host };
  }
  async function stop() {
    try { await app.close(); } catch { /* ignore */ }
    store.close();
    logger.info({}, 'control-plane stopped');
  }

  return { app, store, token, dataRoot, start, stop, logger };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const dataRoot = path.resolve(get('data-root', process.env.FACTORY_DATA_ROOT || config.FACTORY_DATA_ROOT));
  if (args.includes('--init')) {
    const f = tokenFile(dataRoot);
    const existed = fs.existsSync(f);
    ensureToken(dataRoot);
    console.log(`[control-plane] token 文件：${f}（${existed ? '已存在，未覆盖' : '已生成'}）`);
    return;
  }
  const cp = createControlPlane({ dataRoot });
  const { port } = await cp.start({ port: Number(get('port', process.env.PORT || DEFAULT_PORT)) });
  console.log(`[control-plane] listening 127.0.0.1:${port}`);
  console.log(`[control-plane] token 文件：${tokenFile(dataRoot)}`);
  const shutdown = async (sig) => { console.log(`[control-plane] 收到 ${sig}，退出`); await cp.stop(); process.exit(0); };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) main().catch((err) => { console.error('[control-plane]', err); process.exit(1); });

module.exports = { createControlPlane, ensureToken, readToken, tokenFile, loadPlugins, VERSION };
