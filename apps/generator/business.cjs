'use strict';

/**
 * apps/generator/business.cjs —— 业务执行层注入与静态校验（M3）
 *
 * 用途：DSH Agent / 人工在生成骨架后提供 `service/runner.js` 实现，流水线负责：
 *   1) 静态禁止项检查（child_process / eval / new Function / vm 等）
 *   2) 写入插件 service/runner.js
 *   3) 由 validate/staging + Node 权限沙箱执行验证
 * 边界：静态检查不能替代人工 review；真实业务仍需凭证/登录态与验收。
 */

const fs = require('node:fs');
const path = require('node:path');

const FORBIDDEN = [
  { re: /require\(\s*['"]node:child_process['"]\s*\)|require\(\s*['"]child_process['"]\s*\)/, msg: '禁止 child_process（沙箱边界）' },
  { re: /\beval\s*\(/, msg: '禁止 eval' },
  { re: /new\s+Function\s*\(/, msg: '禁止 new Function' },
  { re: /require\(\s*['"]node:vm['"]\s*\)|require\(\s*['"]vm['"]\s*\)/, msg: '禁止 vm 动态执行' },
  { re: /process\.exit\s*\(/, msg: '禁止 runner 内 process.exit' },
];
const WARN = [
  { re: /\bfetch\s*\(|https?:\/\//, msg: '包含网络访问：需在 permissions.network 声明并走 allowlist' },
];

function validateRunnerSource(source) {
  const text = String(source || '');
  const errors = [];
  const warnings = [];
  for (const f of FORBIDDEN) if (f.re.test(text)) errors.push(f.msg);
  for (const w of WARN) if (w.re.test(text)) warnings.push(w.msg);
  if (!/runJob/.test(text)) errors.push('runner 必须导出 runJob');
  if (!/module\.exports\s*=|exports\.runJob/.test(text)) errors.push('runner 必须导出 runJob（module.exports / exports）');
  return { ok: errors.length === 0, errors, warnings };
}

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
