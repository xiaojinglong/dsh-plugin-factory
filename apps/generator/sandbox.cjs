'use strict';

/**
 * apps/generator/sandbox.cjs —— 生成代码执行沙箱（M3，Node 权限模型）
 *
 * 使用 Node 24 `--permission` 限制生成服务的文件系统读写：
 *   - 只读：仓库（runtime/node_modules/manifests）+ staging 目录
 *   - 只写：staging 目录
 * 说明：Node 权限模型不拦截网络与原生模块（如 SQLite/Playwright）的所有 I/O；
 *       生产环境仍需容器级网络隔离（见 apps/generator/README）。
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

function supportsPermissionModel() {
  try {
    return process.allowedNodeEnvironmentFlags.has('--permission')
      && process.allowedNodeEnvironmentFlags.has('--allow-fs-read')
      && process.allowedNodeEnvironmentFlags.has('--allow-fs-write');
  } catch { return false; }
}

function buildArgs({ readDirs = [], writeDirs = [], scriptArgs = [] } = {}) {
  if (!supportsPermissionModel()) return [...scriptArgs];
  const args = ['--permission'];
  for (const d of readDirs) args.push(`--allow-fs-read=${path.resolve(d)}`);
  for (const d of writeDirs) args.push(`--allow-fs-write=${path.resolve(d)}`);
  return [...args, ...scriptArgs];
}

function cleanEnv(env = {}) {
  const next = { ...env };
  for (const key of ['NODE_OPTIONS', 'NODE_REPL_EXTERNAL_MODULE', 'DEBUG']) delete next[key];
  return next;
}

function spawnSandboxed(scriptArgs, opts = {}) {
  const args = buildArgs({ readDirs: opts.readDirs, writeDirs: opts.writeDirs, scriptArgs });
  return spawn(process.execPath, args, {
    cwd: opts.cwd, env: cleanEnv(opts.env), stdio: opts.stdio || ['ignore', 'ignore', 'pipe'],
  });
}

module.exports = { supportsPermissionModel, buildArgs, spawnSandboxed, cleanEnv };
