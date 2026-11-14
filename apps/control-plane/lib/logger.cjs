'use strict';

/** 控制面日志：JSON 行 + 5MB 轮转（不引入额外依赖） */

const fs = require('node:fs');
const path = require('node:path');

function createLogger({ dir, name = 'control-plane' }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.log`);
  const maxBytes = 5 * 1024 * 1024;
  function write(level, fields) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields }) + '\n';
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line, 'utf8');
    } catch { /* 日志失败不影响服务 */ }
  }
  return {
    info: (fields, msg) => write('info', { msg, ...fields }),
    warn: (fields, msg) => write('warn', { msg, ...fields }),
    error: (fields, msg) => write('error', { msg, ...fields }),
    file,
  };
}

module.exports = { createLogger };
