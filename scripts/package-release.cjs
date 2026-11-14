#!/usr/bin/env node
'use strict';

/**
 * scripts/package-release.cjs —— A 单机版发布包（npm tarball + SHA-256 清单）
 *
 * 用法：node scripts/package-release.cjs [--out dist]
 * 产出：dist/dsh-plugin-factory-<version>.tgz + dist/release.json
 * 说明：签名需要 owner 私钥（未实现，见 STATUS）；本脚本只做可复现打包与校验和。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SENSITIVE = [/^node_modules\//, /(^|\/)\.env(?!\.(?:tmpl|example|sample))($|\.)/, /^platform\/secrets\//, /(^|\/)data\//, /\.db$/, /control-plane\/token/];

function npmBin() { return process.platform === 'win32' ? 'npm.cmd' : 'npm'; }

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function packageRelease(opts = {}) {
  const outDir = path.resolve(opts.outDir || path.join(ROOT, 'dist'));
  fs.mkdirSync(outDir, { recursive: true });
  const args = ['pack', '--json', '--ignore-scripts', '--pack-destination', outDir];
  // 直接用 node + npm-cli.js，避免 Windows .cmd 的 shell 引号问题
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const r = fs.existsSync(npmCli)
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120000 })
    : spawnSync(npmBin(), args, { cwd: ROOT, encoding: 'utf8', timeout: 120000, shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`npm pack 失败：${(r.stderr || r.stdout || '').slice(0, 800)}`);
  let info;
  try { info = JSON.parse(r.stdout); } catch { throw new Error('npm pack 输出不是 JSON'); }
  const packed = Array.isArray(info) ? info[0] : info;
  const tarball = path.resolve(outDir, packed.filename);
  const files = (packed.files || []).map((f) => f.path);
  const bad = files.filter((f) => SENSITIVE.some((re) => re.test(f)));
  if (bad.length) throw new Error(`发布包包含敏感路径：${bad.slice(0, 5).join(', ')}`);
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const release = {
    name: packed.name, version: packed.version, commit, generatedAt: new Date().toISOString(),
    tarball: path.basename(tarball), bytes: fs.statSync(tarball).size,
    sha256: sha256(tarball), files: files.length,
  };
  fs.writeFileSync(path.join(outDir, 'release.json'), JSON.stringify(release, null, 2) + '\n', 'utf8');
  return { ok: true, ...release, path: tarball };
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;
  try { console.log(JSON.stringify(packageRelease({ outDir }), null, 2)); }
  catch (err) { console.error(`[package-release] ${err.message}`); process.exit(1); }
}

if (require.main === module) main();
module.exports = { packageRelease, SENSITIVE };
