'use strict';

/**
 * store.js —— 持久化任务存储（node:sqlite，Node ≥22.5）
 * 表：jobs / files / missing；支持取消标记、幂等键、清理、指标。
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

class JobStore {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY, task TEXT, params TEXT, status TEXT, progress TEXT,
        error TEXT, created_at TEXT, started_at TEXT, finished_at TEXT,
        duration_ms INTEGER DEFAULT 0, cancel_requested INTEGER DEFAULT 0,
        idempotency_key TEXT
      );
      CREATE TABLE IF NOT EXISTS files (
        job_id TEXT, kind TEXT, item_name TEXT, file_name TEXT, path TEXT,
        relative_path TEXT, size INTEGER, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS missing (job_id TEXT, item_name TEXT, reason TEXT);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idem ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
    `);
    // 兼容旧库：dry_run 列用于把"预演"排除在写额度外（旧库无此列，自动补）
    const cols = this.db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
    if (!cols.includes('dry_run')) this.db.exec('ALTER TABLE jobs ADD COLUMN dry_run INTEGER DEFAULT 0');
  }

  _now() { return new Date().toISOString(); }

  create({ jobId, task, params, idempotencyKey = '', dryRun = false }) {
    this.db.prepare(`INSERT INTO jobs (job_id, task, params, status, progress, created_at, idempotency_key, dry_run)
      VALUES (?, ?, ?, 'queued', '已入队', ?, ?, ?)`).run(jobId, task, JSON.stringify(params || {}), this._now(), idempotencyKey, dryRun ? 1 : 0);
    return this.get(jobId);
  }

  get(jobId) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId);
    return row ? this._decorate(row) : null;
  }

  _decorate(row) {
    return {
      jobId: row.job_id, task: row.task, params: safeJson(row.params), status: row.status,
      progress: row.progress, error: row.error, createdAt: row.created_at,
      startedAt: row.started_at, finishedAt: row.finished_at, durationMs: row.duration_ms,
      cancelRequested: !!row.cancel_requested,
      dryRun: !!row.dry_run,
    };
  }

  update(jobId, fields) {
    const map = {
      status: 'status', progress: 'progress', error: 'error', startedAt: 'started_at',
      finishedAt: 'finished_at', durationMs: 'duration_ms',
    };
    const sets = []; const vals = [];
    for (const [k, col] of Object.entries(map)) {
      if (fields[k] !== undefined) { sets.push(`${col} = ?`); vals.push(fields[k]); }
    }
    if (!sets.length) return;
    vals.push(jobId);
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE job_id = ?`).run(...vals);
  }

  nextQueued() {
    const row = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get();
    if (!row) return null;
    return this._decorate(row);
  }

  running() {
    const row = this.db.prepare("SELECT * FROM jobs WHERE status = 'running' ORDER BY started_at LIMIT 1").get();
    return row ? this._decorate(row) : null;
  }

  queueSize() {
    return this.db.prepare("SELECT COUNT(*) c FROM jobs WHERE status = 'queued'").get().c;
  }

  cancel(jobId) {
    this.db.prepare('UPDATE jobs SET cancel_requested = 1, progress = ? WHERE job_id = ?').run('取消请求已提交，等待当前步骤结束', jobId);
  }

  isCancelRequested(jobId) {
    const row = this.db.prepare('SELECT cancel_requested FROM jobs WHERE job_id = ?').get(jobId);
    return !!(row && row.cancel_requested);
  }

  addFile(jobId, rec) {
    this.db.prepare(`INSERT INTO files (job_id, kind, item_name, file_name, path, relative_path, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(jobId, rec.kind, rec.itemName || null, rec.fileName, rec.path, rec.relativePath, rec.size, rec.createdAt);
  }

  files(jobId) {
    return this.db.prepare('SELECT * FROM files WHERE job_id = ?').all(jobId).map((r) => ({
      kind: r.kind, itemName: r.item_name, fileName: r.file_name, path: r.path,
      relativePath: r.relative_path, size: r.size, createdAt: r.created_at,
    }));
  }

  addMissing(jobId, itemName, reason) {
    this.db.prepare('INSERT INTO missing (job_id, item_name, reason) VALUES (?, ?, ?)').run(jobId, itemName, String(reason || '').slice(0, 300));
  }

  missing(jobId) {
    return this.db.prepare('SELECT item_name, reason FROM missing WHERE job_id = ?').all(jobId)
      .map((r) => ({ itemName: r.item_name, reason: r.reason }));
  }

  findByIdem(key) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(key);
    return row ? this._decorate(row) : null;
  }

  writeCountToday() {
    const day = new Date().toISOString().slice(0, 10);
    // 写额度只统计"真实写"任务：dry_run 预演不占额度（历史库 dry_run 默认 0，行为不变）
    return this.db.prepare("SELECT COUNT(*) c FROM jobs WHERE status IN ('done','running','queued') AND dry_run = 0 AND created_at LIKE ?").get(`${day}%`).c;
  }

  list({ status, limit = 50 } = {}) {
    const rows = status
      ? this.db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
      : this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map((r) => this._decorate(r));
  }

  recoverInterrupted() {
    const rows = this.db.prepare("SELECT job_id FROM jobs WHERE status = 'running'").all();
    this.db.prepare("UPDATE jobs SET status = 'failed', error = '服务重启，任务中断', finished_at = ? WHERE status = 'running'").run(this._now());
    return rows.length;
  }

  metrics() {
    const byStatus = {};
    for (const r of this.db.prepare('SELECT status, COUNT(*) c FROM jobs GROUP BY status').all()) byStatus[r.status] = r.c;
    const durs = this.db.prepare("SELECT duration_ms FROM jobs WHERE status = 'done' AND duration_ms > 0 ORDER BY duration_ms").all().map((r) => r.duration_ms);
    const pct = (p) => (durs.length ? durs[Math.min(durs.length - 1, Math.floor((durs.length - 1) * p))] : 0);
    const fails = this.db.prepare("SELECT error, COUNT(*) c FROM jobs WHERE status = 'failed' AND error IS NOT NULL GROUP BY error ORDER BY c DESC LIMIT 5").all();
    return { jobsByStatus: byStatus, durationP50Ms: pct(0.5), durationP95Ms: pct(0.95), topErrors: fails };
  }

  prune(retentionDays) {
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const old = this.db.prepare('SELECT job_id FROM jobs WHERE created_at < ?').all(cutoff);
    for (const r of old) {
      this.db.prepare('DELETE FROM files WHERE job_id = ?').run(r.job_id);
      this.db.prepare('DELETE FROM missing WHERE job_id = ?').run(r.job_id);
      this.db.prepare('DELETE FROM jobs WHERE job_id = ?').run(r.job_id);
    }
    return old.length;
  }

  close() { try { this.db.close(); } catch { /* ignore */ } }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

module.exports = { JobStore };
