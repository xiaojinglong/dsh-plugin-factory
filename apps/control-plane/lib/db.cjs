'use strict';

/**
 * 控制面持久化（SQLite，node:sqlite）
 * - 版本化 migration（PRAGMA user_version）
 * - requests / steps / audit / idempotency
 * - 状态机：submitted → probe → generate → validate → staging → accept → installed / failed
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const STEP_ORDER = ['probe', 'generate', 'validate', 'staging', 'accept', 'install'];
const PREV_STATE = {
  probe: 'submitted', generate: 'probe', validate: 'generate',
  staging: 'validate', accept: 'staging', install: 'accept',
};
const STATE_AFTER = {
  probe: 'probe', generate: 'generate', validate: 'validate',
  staging: 'staging', accept: 'accept', install: 'installed',
};

const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        brief TEXT NOT NULL,
        params TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL,
        current_step TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_state ON requests(state, created_at);
      CREATE TABLE IF NOT EXISTS steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence TEXT,
        error TEXT,
        actor TEXT,
        ip TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(request_id) REFERENCES requests(id)
      );
      CREATE INDEX IF NOT EXISTS idx_steps_request ON steps(request_id, id);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT,
        action TEXT NOT NULL,
        object TEXT,
        before TEXT,
        after TEXT,
        ip TEXT,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_object ON audit(object, id);
      CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
];

function badRequest(message, code = 'BAD_REQUEST') {
  const e = new Error(message);
  e.statusCode = 400;
  e.code = code;
  return e;
}
function conflict(message, code = 'INVALID_STATE') {
  const e = new Error(message);
  e.statusCode = 409;
  e.code = code;
  return e;
}
function notFound(message = '资源不存在', code = 'NOT_FOUND') {
  const e = new Error(message);
  e.statusCode = 404;
  e.code = code;
  return e;
}

class ControlPlaneStore {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate() {
    let current = Number(this.db.prepare('PRAGMA user_version').get().user_version || 0);
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      this.transaction(() => {
        this.db.exec(m.up);
        this.db.exec(`PRAGMA user_version = ${m.version}`);
      });
      current = m.version;
    }
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  }

  now() { return new Date().toISOString(); }

  _audit(fields) {
    this.db.prepare('INSERT INTO audit (actor, action, object, before, after, ip, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(fields.actor || null, fields.action, fields.object || null, fields.before ? JSON.stringify(fields.before) : null,
        fields.after ? JSON.stringify(fields.after) : null, fields.ip || null, this.now());
  }

  createRequest({ brief, params = {}, idempotencyKey = '', actor = 'local', ip = '' }) {
    const id = `req_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`;
    return this.transaction(() => {
      this.db.prepare('INSERT INTO requests (id, brief, params, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, brief, JSON.stringify(params), 'submitted', this.now(), this.now());
      if (idempotencyKey) {
        this.db.prepare('INSERT INTO idempotency (key, request_id, created_at) VALUES (?, ?, ?)')
          .run(idempotencyKey, id, this.now());
      }
      this._audit({ actor, action: 'request.create', object: `request:${id}`, after: { brief, params }, ip });
      return this.getRequest(id);
    });
  }

  findIdempotency(key) {
    const row = this.db.prepare('SELECT request_id FROM idempotency WHERE key = ?').get(key);
    return row ? row.request_id : null;
  }

  getRequest(id) {
    const row = this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id, brief: row.brief, params: safeJson(row.params), state: row.state,
      currentStep: row.current_step, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
      steps: this.steps(id),
    };
  }

  setRequestParams(id, params, { actor = 'local', ip = '' } = {}) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT state FROM requests WHERE id = ?').get(id);
      if (!row) throw notFound(`需求单不存在：${id}`);
      if (row.state !== 'submitted') throw conflict(`只有 submitted 状态可写入 runner（当前 ${row.state}）`);
      this.db.prepare('UPDATE requests SET params = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(params || {}), this.now(), id);
      this._audit({ actor, action: 'request.params.update', object: `request:${id}`, after: { params }, ip });
      return this.getRequest(id);
    });
  }

  steps(id, limit = 200) {
    return this.db.prepare('SELECT * FROM steps WHERE request_id = ? ORDER BY id LIMIT ?').all(id, limit).map((r) => ({
      id: r.id, step: r.step, status: r.status, evidence: r.evidence, error: r.error,
      actor: r.actor, at: r.created_at,
    }));
  }

  listRequests({ state, limit = 50 } = {}) {
    const rows = state
      ? this.db.prepare('SELECT * FROM requests WHERE state = ? ORDER BY created_at DESC LIMIT ?').all(state, limit)
      : this.db.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map((r) => ({
      id: r.id, brief: r.brief, state: r.state, currentStep: r.current_step,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  addStep({ requestId, step, status, evidence = '', error = '', actor = 'local', ip = '' }) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
      if (!row) throw notFound(`需求单不存在：${requestId}`);
      if (row.state === 'failed' || row.state === 'installed') throw conflict(`需求单已处于终态：${row.state}`);

      if (step === 'note') {
        if (status !== 'succeeded') throw badRequest('note 步骤只接受 status=succeeded');
        this.db.prepare('INSERT INTO steps (request_id, step, status, evidence, error, actor, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(requestId, 'note', 'succeeded', evidence, null, actor, ip, this.now());
        this.db.prepare('UPDATE requests SET updated_at = ? WHERE id = ?').run(this.now(), requestId);
        this._audit({ actor, action: 'step.note', object: `request:${requestId}`, after: { evidence }, ip });
        return this.getRequest(requestId);
      }
      if (!STEP_ORDER.includes(step)) throw badRequest(`未知步骤：${step}`);
      if (!['running', 'succeeded', 'failed'].includes(status)) throw badRequest(`未知状态：${status}`);

      if (status === 'running') {
        if (row.state !== PREV_STATE[step]) throw conflict(`步骤 ${step} 要求前序状态 ${PREV_STATE[step]}，当前 ${row.state}`);
        if (row.current_step) throw conflict(`已有运行中步骤：${row.current_step}`);
        this.db.prepare('UPDATE requests SET current_step = ?, updated_at = ? WHERE id = ?').run(step, this.now(), requestId);
      } else if (status === 'succeeded') {
        if (row.current_step !== step) throw conflict(`步骤 ${step} 尚未开始`);
        this.db.prepare('UPDATE requests SET state = ?, current_step = NULL, error = NULL, updated_at = ? WHERE id = ?')
          .run(STATE_AFTER[step], this.now(), requestId);
      } else {
        if (row.current_step !== step && row.state !== PREV_STATE[step]) throw conflict(`步骤 ${step} 无法从当前状态失败`);
        this.db.prepare('UPDATE requests SET state = ?, current_step = NULL, error = ?, updated_at = ? WHERE id = ?')
          .run('failed', String(error || '步骤失败').slice(0, 1000), this.now(), requestId);
      }

      this.db.prepare('INSERT INTO steps (request_id, step, status, evidence, error, actor, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(requestId, step, status, evidence || null, status === 'failed' ? String(error || '步骤失败').slice(0, 1000) : null, actor, ip, this.now());
      this._audit({ actor, action: `step.${status}`, object: `request:${requestId}`, after: { step, status, evidence }, ip });
      return this.getRequest(requestId);
    });
  }

  auditFor(object, limit = 200) {
    return this.db.prepare('SELECT * FROM audit WHERE object = ? ORDER BY id DESC LIMIT ?').all(object, limit).map((r) => ({
      id: r.id, actor: r.actor, action: r.action, object: r.object,
      before: safeJson(r.before), after: safeJson(r.after), ip: r.ip, at: r.at,
    }));
  }

  listAudit({ limit = 100 } = {}) {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({
      id: r.id, actor: r.actor, action: r.action, object: r.object, at: r.at,
    }));
  }

  pruneAudit({ olderThanDays = 30, dryRun = true, actor = 'system', ip = '' } = {}) {
    const days = Math.max(0, Math.min(3650, Number(olderThanDays)));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const count = this.db.prepare('SELECT COUNT(*) c FROM audit WHERE at < ?').get(cutoff).c;
    if (!dryRun && count > 0) {
      this.db.prepare('DELETE FROM audit WHERE at < ?').run(cutoff);
      this._audit({ actor, action: 'audit.prune', object: 'audit', after: { cutoff, deleted: count }, ip });
    }
    return { cutoff, olderThanDays: days, deleted: dryRun ? 0 : count, candidates: count, dryRun: !!dryRun };
  }

  metrics() {
    const byState = {};
    for (const r of this.db.prepare('SELECT state, COUNT(*) c FROM requests GROUP BY state').all()) byState[r.state] = r.c;
    const total = this.db.prepare('SELECT COUNT(*) c FROM requests').get().c;
    const auditCount = this.db.prepare('SELECT COUNT(*) c FROM audit').get().c;
    const steps = this.db.prepare('SELECT step, status, COUNT(*) c FROM steps GROUP BY step, status').all();
    return { requests: { total, byState }, steps, auditCount };
  }

  backup(dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    this.db.exec(`VACUUM INTO '${String(dest).replace(/'/g, "''")}'`);
    return dest;
  }

  close() { try { this.db.close(); } catch { /* ignore */ } }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

module.exports = { ControlPlaneStore, STEP_ORDER, PREV_STATE, STATE_AFTER, MIGRATIONS };
