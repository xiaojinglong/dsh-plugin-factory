#!/usr/bin/env node
'use strict';

/**
 * scripts/install-from-release.cjs —— 从发布包安装（M5 分发）
 * 用法：node scripts/install-from-release.cjs --release <distDir> --to <targetDir> [--force]
 * 行为：校验 release.json/SHA-256 → 检查 tar 条目安全 → 解包到目标目录（strip=1）。
 * 使用纯 JS tar（跨平台，不依赖系统 tar 对 UTF-8/PAX 的支持）。
 * 不执行 npm ci/不启动服务；后续步骤见 docs/26。
 */

const fs = require('node:fs');
const path = require('node:path');
const tar = require('tar');
const { verifyRelease } = require('./verify-release.cjs');

async function listEntries(tarball) {
  const entries = [];
  await tar.list({
    file: tarball,
    onentry: (e) => { entries.push(e.path); },
  });
  return entries;
}

function assertSafeEntries(entries) {
  for (const e of entries) {
    const p = String(e).replace(/\\/g, '/');
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || /(^|\/)\.\.(\/|$)/.test(p)) {
      throw new Error(`发布包包含不安全路径：${e}`);
    }
  }
}

async function extractTar(tarball, target) {
  await tar.x({
    file: tarball,
    cwd: target,
    strip: 1,
    preservePaths: false,
    filter: (p) => { assertSafeEntries([p]); return true; },
  });
}

async function installFromRelease(opts = {}) {
  const releaseDir = path.resolve(opts.releaseDir || opts.release || path.join(__dirname, '..', 'dist'));
  const target = opts.to ? path.resolve(opts.to) : '';
  if (!target) throw new Error('需要 --to <targetDir>');
  const v = verifyRelease({ outDir: releaseDir });
  if (!v.ok) throw new Error(`发布包校验失败：${v.errors.join('; ')}`);
  const meta = JSON.parse(fs.readFileSync(path.join(releaseDir, 'release.json'), 'utf8'));
  const tarball = path.join(releaseDir, meta.tarball);
  const entries = await listEntries(tarball);
  assertSafeEntries(entries);
  if (fs.existsSync(target)) {
    const existing = fs.readdirSync(target);
    if (existing.length && !opts.force) throw new Error(`目标目录非空：${target}（如需覆盖加 --force）`);
  }
  let backup = '';
  if (fs.existsSync(target) && opts.force) {
    backup = `${target}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(target, backup);
  }
  fs.mkdirSync(target, { recursive: true });
  try {
    await extractTar(tarball, target);
  } catch (err) {
    fs.rmSync(target, { recursive: true, force: true });
    throw new Error(`解包失败：${err.message}`);
  }
  return { ok: true, to: target, version: meta.version, sha256: meta.sha256, files: entries.length, backup };
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[a.slice(2)] = next; i += 1; } else args[a.slice(2)] = 'true';
  }
  try { console.log(JSON.stringify(await installFromRelease({ releaseDir: args.release, to: args.to, force: args.force === 'true' }), null, 2)); }
  catch (err) { console.error(`[install-from-release] ${err.message}`); process.exit(1); }
}

if (require.main === module) main();
module.exports = { installFromRelease, listEntries, assertSafeEntries };
