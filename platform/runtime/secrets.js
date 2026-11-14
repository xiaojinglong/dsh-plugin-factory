'use strict';

/**
 * secrets.js —— 凭证加密存储（Windows DPAPI，用户级）
 *
 * 文件：platform/secrets/<id>.enc（DPAPI 密文，仅当前 Windows 用户可解）
 * 用法：runtime bootstrap 时 loadSecrets(pluginId) 解密并注入 process.env。
 * 无 DPAPI（非 Windows）时回退明文 JSON（仅开发环境，会打印警告）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SECRET_DIR = path.resolve(__dirname, '..', 'secrets');
const PS1 = path.join(__dirname, 'dpapi.ps1');

function ensureDir() { fs.mkdirSync(SECRET_DIR, { recursive: true }); }
function encFile(id) { return path.join(SECRET_DIR, `${id}.enc`); }

function runPs(args) {
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
}

function encryptPlain(id, plainJson) {
  ensureDir();
  const tmp = path.join(SECRET_DIR, `.tmp-${id}-${Date.now()}.json`);
  fs.writeFileSync(tmp, plainJson, 'utf8');
  try {
    runPs(['protect', '-In', tmp, '-Out', encFile(id)]);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function decrypt(id) {
  const f = encFile(id);
  if (!fs.existsSync(f)) return {};
  const out = runPs(['unprotect', '-In', f]);
  return JSON.parse(out);
}

function exists(id) { return fs.existsSync(encFile(id)); }

/** 读取凭证并注入 process.env；返回注入的键列表 */
function hydrate(pluginId, keys = []) {
  let secrets = {};
  try { secrets = decrypt(pluginId); } catch (e) {
    console.warn(`[secrets] 解密失败（${pluginId}）：${e.message}`);
  }
  const injected = [];
  for (const k of keys) {
    if (secrets[k] !== undefined && !process.env[k]) { process.env[k] = String(secrets[k]); injected.push(k); }
  }
  return injected;
}

module.exports = { encryptPlain, decrypt, exists, hydrate, SECRET_DIR, encFile };
