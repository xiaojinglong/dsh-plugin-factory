#!/usr/bin/env node
'use strict';

/**
 * scripts/verify-release.cjs —— 校验发布包（SHA-256/大小/清单）
 * 用法：node scripts/verify-release.cjs [--out dist]
 * 说明：签名需 owner 私钥（未实现）；本脚本验证发布包完整性与 release.json 一致。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function verifyRelease(opts = {}) {
  const outDir = path.resolve(opts.outDir || path.join(__dirname, '..', 'dist'));
  const releaseFile = path.join(outDir, 'release.json');
  if (!fs.existsSync(releaseFile)) throw new Error(`缺少 release.json：${releaseFile}`);
  const meta = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
  const tarball = path.join(outDir, meta.tarball);
  const errors = [];
  if (!fs.existsSync(tarball)) errors.push(`缺少 tarball：${meta.tarball}`);
  let actual = '';
  if (fs.existsSync(tarball)) {
    actual = sha256(tarball);
    if (actual !== meta.sha256) errors.push(`SHA-256 不匹配：expected ${meta.sha256}, actual ${actual}`);
    if (fs.statSync(tarball).size !== meta.bytes) errors.push(`大小不匹配：expected ${meta.bytes}`);
  }
  return {
    ok: errors.length === 0, name: meta.name, version: meta.version, commit: meta.commit,
    tarball: meta.tarball, expected: meta.sha256, actual, errors,
  };
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  try {
    const r = verifyRelease({ outDir: i >= 0 ? args[i + 1] : undefined });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  } catch (err) {
    console.error(`[verify-release] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { verifyRelease };
