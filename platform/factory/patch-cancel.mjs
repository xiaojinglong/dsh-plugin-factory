// patch-cancel.mjs —— 取消语义：runner 抛错但已请求取消 → status=cancelled
import fs from 'node:fs';
const f = 'D:/www/dsh-plugin-factory/platform/runtime/index.js';
let s = fs.readFileSync(f, 'utf8');
const oldCatch = `    } catch (err) {
      const message = String(err && err.message ? err.message : err).slice(0, 500);
      store.update(job.jobId, { status: 'failed', progress: '执行失败', error: message, finishedAt: new Date().toISOString(), durationMs: Date.now() - started });
      stats.failed += 1; stats.lastError = message;
      logger.error({ jobId: job.jobId, ms: Date.now() - started, err: message }, 'job failed');
    }`;
const newCatch = `    } catch (err) {
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
    }`;
if (!s.includes("status: cancelled ? 'cancelled' : 'failed'")) { s = s.replace(oldCatch, newCatch); fs.writeFileSync(f, s, 'utf8'); console.log('patched cancel semantics'); }
else console.log('already patched');
