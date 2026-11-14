'use strict';

/**
 * apps/generator/business.cjs —— 业务执行层注入（M3）
 * 静态校验复用 packages/sdk/runner.cjs；本模块负责写入 service/runner.js。
 */

const fs = require('node:fs');
const path = require('node:path');
const { validateRunnerSource, FORBIDDEN } = require('../../packages/sdk/runner.cjs');

function applyBusinessRunner(pluginDir, source) {
  const v = validateRunnerSource(source);
  if (!v.ok) {
    const err = new Error(`业务 runner 校验失败：${v.errors.join('; ')}`);
    err.validation = v;
    throw err;
  }
  const target = path.join(pluginDir, 'service', 'runner.js');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(source), 'utf8');
  return { ...v, file: target };
}

module.exports = { validateRunnerSource, applyBusinessRunner, FORBIDDEN };
