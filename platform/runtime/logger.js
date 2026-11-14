'use strict';

/** logger.js —— JSON 行日志 + 5MB 轮转 */
const fs = require('node:fs');
const path = require('node:path');

function createLogger({ dir, name = 'service', maxBytes = 5 * 1024 * 1024 }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.log`);
  function rotateIfNeeded() {
    try {
      const st = fs.statSync(file);
      if (st.size > maxBytes) fs.renameSync(file, path.join(dir, `${name}.log.1`));
    } catch { /* not exists */ }
  }
  function write(level, fields, msg) {
    if (typeof fields === 'string') { msg = fields; fields = {}; }
    const line = JSON.stringify({ ts: new Date().toISOString(), level, service: name, msg, ...fields }) + '\n';
    rotateIfNeeded();
    try { fs.appendFileSync(file, line, 'utf8'); } catch { /* ignore */ }
    if (process.env.LOG_STDOUT !== 'false') process.stdout.write(line);
  }
  return {
    info: (fields, msg) => write('info', fields, msg),
    warn: (fields, msg) => write('warn', fields, msg),
    error: (fields, msg) => write('error', fields, msg),
  };
}

module.exports = { createLogger };
