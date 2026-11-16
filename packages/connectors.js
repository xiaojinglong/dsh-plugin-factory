'use strict';
// packages/connectors.js —— 连接器声明与约束
const CONNECTORS = {
  file: { description: 'read/write JSON, text and CSV', permissions: ['filesystem'] },
  http: { description: 'HTTP JSON requests with host allowlist', permissions: ['network'], credentials: true },
  browser: { description: 'Playwright browser automation', permissions: ['network', 'filesystem', 'process'], requires: ['playwright'] },
  desktop: { description: 'Windows desktop automation via PowerShell', permissions: ['process', 'filesystem'], platform: 'win32', requires: ['powershell'] },
};

function validateConnectors(list, spec = {}) {
  const errors = [];
  const names = Array.isArray(list) ? list.map(String) : [];
  for (const name of names) if (!CONNECTORS[name]) errors.push(`未知连接器：${name}`);
  const perms = spec.permissions || {};
  if (names.includes('http') && !(perms.network || []).length) errors.push('http 连接器需要 permissions.network');
  if (names.includes('desktop') && !perms.process) errors.push('desktop 连接器需要 permissions.process=true');
  if (names.includes('desktop') && spec.requires?.platform && spec.requires.platform !== 'win32') errors.push('desktop 连接器只支持 win32');
  return { names, errors };
}

module.exports = { CONNECTORS, validateConnectors };
