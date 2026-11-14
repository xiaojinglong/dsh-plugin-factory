'use strict';

/** fsutil.js —— 目录/JSON/清理工具 */
const fsp = require('node:fs/promises');
const path = require('node:path');

async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function cleanupOldJobDirs(jobsDir, retentionDays = 7) {
  const cutoff = Date.now() - retentionDays * 86400000;
  let removed = 0;
  let entries = [];
  try { entries = await fsp.readdir(jobsDir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(jobsDir, e.name);
    try {
      const st = await fsp.stat(p);
      if (st.mtimeMs < cutoff) { await fsp.rm(p, { recursive: true, force: true }); removed += 1; }
    } catch { /* ignore */ }
  }
  return removed;
}

/** 结果文件大小兜底：超过上限返回元信息而非全量（供 MCP/CLI 预检） */
async function statFile(file) {
  const st = await fsp.stat(file);
  return { size: st.size, mtime: st.mtimeMs };
}

module.exports = { ensureDir, writeJson, cleanupOldJobDirs, statFile };
