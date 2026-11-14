'use strict';

/**
 * packages/sdk/runner.cjs —— 业务 runner 静态校验（供控制面 / 生成器共用）
 * 注意：静态检查不能替代人工 review 与沙箱运行验证。
 */

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

module.exports = { validateRunnerSource, FORBIDDEN };
