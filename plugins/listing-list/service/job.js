'use strict';

/**
 * job.js —— 任务状态机 / 内存任务管理 / 并发锁 / 排队
 *
 * 状态流转（固定，不新增自定义状态）：
 *   queued → waiting_verify（等待扫码/验证码） → running → done / failed
 *
 * 设计要点：
 * 1. 全局单 worker：页面自动化不支持并行，任务自动排队；任一时刻只有 1 个 job 在跑。
 * 2. 内存态 + meta.json 落盘：进程内 Map 保存任务对象，产物清单同步写 data/jobs/<jobId>/meta.json，
 *    进程重启后已完成任务仍可通过 /result 读取（重启后队列不恢复，属于单机服务的合理取舍）。
 * 3. 与 crawler 解耦：job.js 不 require crawler，由 server.js 注入 runner（可替换性约束）。
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { CONFIG, PATHS, ensureDirs, safeFileName, uniqueFileName, nowIso, timeStamp, formatTime, sanitizeError } =
  require('./util');

/** 固定任务状态枚举 */
const STATUS = Object.freeze({
  QUEUED: 'queued',
  WAITING_VERIFY: 'waiting_verify',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
});

const TERMINAL = new Set([STATUS.DONE, STATUS.FAILED]);

class JobManager {
  constructor() {
    /** @type {Map<string, object>} jobId -> job */
    this.jobs = new Map();
    /** @type {object[]} 排队队列（FIFO） */
    this.queue = [];
    /** @type {((v?: any) => void) | null} 队列空时的唤醒钩子 */
    this._wake = null;
    this._running = false;
    this._loopPromise = null;
    /** 由外部注入：async (job, ctx) => void */
    this._runner = null;
    /** 当前正在执行的 jobId，便于 /health、日志观察 */
    this.currentJobId = null;
    this.stats = { created: 0, done: 0, failed: 0 };
  }

  /** 注入采集执行器（crawler.runJob），实现状态机与页面逻辑解耦 */
  setRunner(runner) {
    this._runner = runner;
  }

  /* ---------------------------------------------------------------- */
  /* 生命周期                                                          */
  /* ---------------------------------------------------------------- */

  async start() {
    if (this._running) return;
    await ensureDirs();
    this._running = true;
    this._loopPromise = this._loop();
    console.log('[job] worker 已启动（MAX_CONCURRENT=1）');
  }

  async stop() {
    this._running = false;
    this._wake?.();
    await this._loopPromise?.catch(() => {});
    // 未完成任务统一标记失败，避免调用方无限轮询
    for (const job of this.jobs.values()) {
      if (!TERMINAL.has(job.status)) {
        job.status = STATUS.FAILED;
        job.error = job.error || '服务关闭，任务中断';
      }
    }
    console.log('[job] worker 已停止');
  }

  /* ---------------------------------------------------------------- */
  /* 任务创建 / 查询                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * 创建任务并进入队列，立即返回 { jobId, status }，不阻塞调用方
   * @param {object} params 业务自定义筛选参数（原样透传给 crawler）
   */
  async createJob(params = {}) {
    await ensureDirs();

    const jobId = this._newJobId();
    const job = {
      jobId,
      status: STATUS.QUEUED,
      progress: '已入队，等待执行',
      error: null,
      params,
      createdAt: nowIso(),
      createdAtText: formatTime(),
      startedAt: null,
      finishedAt: null,
      /** 产物清单：[{ kind:'main'|'detail', itemName, fileName, path, relativePath, size, createdAt }] */
      files: [],
      missingItems: [],
      /** waiting_verify 期间的校验图：{ buffer, contentType, hint, createdAt } */
      verify: null,
      // 内部字段
      _resolveVerify: null,
      _verifyTimer: null,
      _aborted: false,
      _watchdog: null,
    };

    this.jobs.set(jobId, job);
    this.queue.push(job);
    this.stats.created++;
    await this._persist(job);
    this._wake?.();

    console.log(`[job] 创建 ${jobId}，队列长度 ${this.queue.length}`);
    return { jobId, status: job.status };
  }

  /** 轻量状态查询：只返回状态/进度/错误，绝不带产物 payload */
  getStatus(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      error: job.error,
    };
  }

  /** 校验图（仅 waiting_verify 时有值） */
  getVerify(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== STATUS.WAITING_VERIFY || !job.verify) return null;
    return job.verify;
  }

  /** 结构化产物清单（仅 done 时可用），数据来源 meta.json，避免依赖内存 */
  async getResult(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== STATUS.DONE) return null;

    const meta = await this._loadMeta(jobId).catch(() => null);
    const files = (meta && meta.files) || job.files;
    const missingItems = (meta && meta.missingItems) || job.missingItems;

    const main = files.find((f) => f.kind === 'main') || null;
    return {
      main: main ? { fileName: main.fileName, path: main.path } : null,
      details: files
        .filter((f) => f.kind !== 'main')
        .map((f) => ({ itemName: f.itemName, fileName: f.fileName, path: f.path })),
      missingItems,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 状态变更（供 crawler 通过 ctx 调用）                                */
  /* ---------------------------------------------------------------- */

  setProgress(jobId, text) {
    const job = this.jobs.get(jobId);
    if (!job || TERMINAL.has(job.status)) return;
    job.progress = String(text || '').slice(0, 500);
    console.log(`[job:${jobId}] ${job.progress}`);
  }

  /**
   * 进入人机校验：切到 waiting_verify，缓存校验图，返回一个 Promise。
   * Promise 在两种情况下 resolve：调用方 POST 验证码，或 crawler 检测到页面已自动通过（扫码）。
   * @returns {Promise<{code: string|null, auto: boolean}>}
   */
  needVerify(jobId, { imageBuffer, contentType = 'image/png', hint = '请扫码或输入验证码' } = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return Promise.reject(new Error(`任务不存在：${jobId}`));

    // 已有挂起的校验请求，直接复用
    if (job.status === STATUS.WAITING_VERIFY && job._resolveVerify) {
      return new Promise((resolve) => {
        const prev = job._resolveVerify;
        job._resolveVerify = (v) => {
          prev(v);
          resolve(v);
        };
      });
    }

    job.status = STATUS.WAITING_VERIFY;
    job.progress = hint;
    job.verify = {
      buffer: imageBuffer || null,
      contentType: imageBuffer ? contentType : 'text/plain',
      hint,
      createdAt: nowIso(),
    };
    this._persist(job).catch(() => {});

    console.log(`[job:${jobId}] 等待人机校验：${hint}`);

    return new Promise((resolve, reject) => {
      job._resolveVerify = (v) => {
        job._resolveVerify = null;
        if (job._verifyTimer) {
          clearTimeout(job._verifyTimer);
          job._verifyTimer = null;
        }
        resolve(v);
      };
      // 校验超时保护：不能因为等人扫码而永久占用唯一 worker
      job._verifyTimer = setTimeout(() => {
        if (job.status === STATUS.WAITING_VERIFY) {
          this.fail(jobId, `人机校验超时（${Math.round(CONFIG.verifyTimeoutMs / 1000)}s 内未完成）`);
          reject(new Error('人机校验超时'));
        }
      }, CONFIG.verifyTimeoutMs);
      job._verifyTimer.unref?.();
    });
  }

  /**
   * 提交验证码 / 手动标记校验通过，恢复任务
   * @param {string} jobId
   * @param {string|null} code 验证码文本；为空表示“已人工扫码，直接继续”
   */
  resolveVerify(jobId, code = null) {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, reason: 'not_found' };
    if (job.status !== STATUS.WAITING_VERIFY || !job._resolveVerify) {
      return { ok: false, reason: 'not_waiting_verify' };
    }
    job.status = STATUS.RUNNING;
    job.verify = null;
    job.progress = code ? '已提交验证码，继续执行' : '校验已通过，继续执行';
    job._resolveVerify({ code: code || null, auto: !code });
    this._persist(job).catch(() => {});
    return { ok: true };
  }

  /** crawler 检测到页面已自动登录（扫码完成），无需外部输入 */
  autoResume(jobId) {
    return this.resolveVerify(jobId, null);
  }

  /**
   * 登记产物：crawler 在下载当场调用，把业务名称与文件路径一起固化进 meta.json。
   * 禁止事后靠文件名反推业务映射（架构约束）。
   * @param {string} jobId
   * @param {object} entry { itemName, fileName, kind:'main'|'detail', sourcePath?, content?, encoding? }
   */
  async saveFile(jobId, entry = {}) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`任务不存在：${jobId}`);

    const dir = PATHS.jobDir(jobId);
    await fsp.mkdir(dir, { recursive: true });

    const kind = entry.kind === 'main' ? 'main' : 'detail';
    const rawName = entry.fileName || `${entry.itemName || 'file'}`;
    const fileName = uniqueFileName(dir, safeFileName(rawName, 'file'));
    const absPath = path.join(dir, fileName);

    if (entry.sourcePath) {
      // 下载得到的临时文件：移动到 job 目录（跨盘兜底用 copy）
      try {
        await fsp.rename(entry.sourcePath, absPath);
      } catch {
        await fsp.copyFile(entry.sourcePath, absPath);
        await fsp.rm(entry.sourcePath, { force: true }).catch(() => {});
      }
    } else if (entry.content !== undefined && entry.content !== null) {
      await fsp.writeFile(absPath, entry.content, entry.encoding || 'utf8');
    } else if (Buffer.isBuffer(entry.buffer)) {
      await fsp.writeFile(absPath, entry.buffer);
    } else {
      throw new Error(`saveFile 缺少文件来源：${rawName}`);
    }

    const stat = await fsp.stat(absPath).catch(() => ({ size: 0 }));
    const record = {
      kind,
      itemName: entry.itemName ?? null,
      fileName,
      path: absPath, // 绝对路径，调用方直接可读
      relativePath: PATHS.relative(absPath), // 相对 DATA_DIR，便于跨环境映射
      size: stat.size,
      createdAt: nowIso(),
    };
    job.files.push(record);
    await this._persist(job);
    console.log(`[job:${jobId}] 产物登记 ${kind} ${record.itemName || '-'} -> ${fileName}`);
    return record;
  }

  /** 登记缺失项（业务上应产出但没拿到） */
  async addMissing(jobId, itemName, reason = '未获取到数据') {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const name = String(itemName ?? '').trim();
    if (!name) return;
    if (job.missingItems.some((m) => (typeof m === 'string' ? m : m.itemName) === name)) return;
    job.missingItems.push({ itemName: name, reason: String(reason).slice(0, 200) });
    await this._persist(job).catch(() => {});
    console.warn(`[job:${jobId}] 缺失项：${name}（${reason}）`);
  }

  /** 标记失败：只影响当前 job，不抛出、不影响 HTTP 服务 */
  fail(jobId, reason) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status === STATUS.FAILED || job.status === STATUS.DONE) return;
    job.status = STATUS.FAILED;
    job.error = sanitizeError(reason, 500);
    job.progress = '执行失败';
    job.finishedAt = nowIso();
    job._aborted = true;
    this._cleanupVerify(job);
    this.stats.failed++;
    this._persist(job).catch(() => {});
    console.error(`[job:${jobId}] 失败：${job.error}`);
  }

  /** 标记成功 */
  async complete(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status === STATUS.FAILED) return;
    job.status = STATUS.DONE;
    job.progress = `完成，共 ${job.files.length} 个文件${job.missingItems.length ? `，缺失 ${job.missingItems.length} 项` : ''}`;
    job.error = null;
    job.finishedAt = nowIso();
    this.stats.done++;
    this._cleanupVerify(job);
    await this._persist(job);
    console.log(`[job:${jobId}] 完成`);
  }

  /* ---------------------------------------------------------------- */
  /* 内部：worker 循环                                                 */
  /* ---------------------------------------------------------------- */

  async _loop() {
    while (this._running) {
      const job = this.queue.shift();
      if (!job) {
        // 队列空闲：挂起等待唤醒，不空转 CPU
        await new Promise((resolve) => {
          this._wake = resolve;
          // 60s 兜底唤醒，防止漏唤醒导致队列卡死
          const t = setTimeout(resolve, 60000);
          t.unref?.();
        });
        this._wake = null;
        continue;
      }
      await this._execute(job);
    }
  }

  async _execute(job) {
    this.currentJobId = job.jobId;
    job.status = STATUS.RUNNING;
    job.startedAt = nowIso();
    job.progress = '开始执行';
    await this._persist(job).catch(() => {});

    // 全局超时看门狗：到点后标记失败并让 crawler 在检查点退出
    job._watchdog = setTimeout(() => {
      if (!TERMINAL.has(job.status)) {
        job._aborted = true;
        this.fail(job.jobId, `任务超时（超过 ${Math.round(CONFIG.globalTimeoutMs / 1000)}s）`);
      }
    }, CONFIG.globalTimeoutMs);
    job._watchdog.unref?.();

    try {
      if (typeof this._runner !== 'function') throw new Error('未注入 crawler runner');
      // 异常隔离：任何采集异常只影响本 job
      await this._runner(job, this._buildContext(job));
      if (job.status !== STATUS.FAILED) await this.complete(job.jobId);
    } catch (err) {
      this.fail(job.jobId, err?.stack ? err.message : err);
      console.error(`[job:${job.jobId}] 执行异常：`, err);
    } finally {
      clearTimeout(job._watchdog);
      job._watchdog = null;
      this._cleanupVerify(job);
      this.currentJobId = null;
    }
  }

  /** 传给 crawler 的上下文：crawler 只能通过它回调状态，不直接改 job 对象 */
  _buildContext(job) {
    return {
      jobId: job.jobId,
      params: job.params,
      dir: PATHS.jobDir(job.jobId),
      setProgress: (text) => this.setProgress(job.jobId, text),
      needVerify: (opt) => this.needVerify(job.jobId, opt),
      autoResume: () => this.autoResume(job.jobId),
      saveFile: (entry) => this.saveFile(job.jobId, entry),
      addMissing: (itemName, reason) => this.addMissing(job.jobId, itemName, reason),
      isAborted: () => job._aborted || job.status === STATUS.FAILED,
      log: (...args) => console.log(`[job:${job.jobId}]`, ...args),
    };
  }

  /* ---------------------------------------------------------------- */
  /* 内部：持久化                                                      */
  /* ---------------------------------------------------------------- */

  async _persist(job) {
    const dir = PATHS.jobDir(job.jobId);
    await fsp.mkdir(dir, { recursive: true });
    const meta = {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      error: job.error,
      params: job.params,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      // 固定映射关系：业务名称 <-> 文件路径，由 crawler 登记时写入，不靠文件名猜测
      files: job.files,
      missingItems: job.missingItems,
    };
    await fsp.writeFile(PATHS.jobMeta(job.jobId), JSON.stringify(meta, null, 2), 'utf8');
  }

  async _loadMeta(jobId) {
    const text = await fsp.readFile(PATHS.jobMeta(jobId), 'utf8');
    return JSON.parse(text);
  }

  _cleanupVerify(job) {
    if (job._verifyTimer) {
      clearTimeout(job._verifyTimer);
      job._verifyTimer = null;
    }
    if (job._resolveVerify) {
      const resolve = job._resolveVerify;
      job._resolveVerify = null;
      resolve({ code: null, auto: true });
    }
    job.verify = null;
  }

  _newJobId() {
    // 20261111-205758-a1b2：时间可读 + 随机后缀防撞
    return `${timeStamp()}-${crypto.randomBytes(2).toString('hex')}`;
  }
}

module.exports = { JobManager, STATUS };
