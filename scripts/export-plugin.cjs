#!/usr/bin/env node
'use strict';
/**
 * scripts/export-plugin.cjs —— 一键导出 portable bundle（zip + checksum + 禁止项扫描）
 * 用法：node scripts/export-plugin.cjs --id excel-status-mark [--out dist]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..');
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
const id = args.id;
if (!id) { console.error('用法：node scripts/export-plugin.cjs --id <portable-id> [--out dist]'); process.exit(1); }
const src = path.resolve(args.source || path.join(ROOT, 'portable-plugins', id));
if (!fs.existsSync(src)) { console.error(`portable 插件不存在：${src}`); process.exit(1); }
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
if (!pkg.dsh?.bundle?.patch) { console.error('package.json 缺少 dsh.bundle.patch'); process.exit(1); }
const outRoot = path.resolve(args.out || path.join(ROOT, 'dist'));
const staging = path.join(outRoot, pkg.name.replace(/^@/, '').replace(/[\\/]/g, '-'));
const zipFile = path.join(outRoot, `${id}-${pkg.version}.zip`);
const scanFile = path.join(outRoot, `${id}-${pkg.version}.scan.json`);

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });
fs.cpSync(src, staging, {
  recursive: true,
  filter: (p) => !/[\\/](node_modules|dist|\.git)([\\/]|$)/.test(p),
});

// 本地目录安装是 link，不会安装依赖；导出时把生产依赖 vendoring 进包，保证 zip 自包含。
if (args['no-deps'] !== 'true') {
  const win = process.platform === 'win32';
  const cmd = win ? process.env.ComSpec : 'npm';
  const cmdArgs = win
    ? ['/d', '/s', '/c', 'npm.cmd install --omit=dev --ignore-scripts --no-audit --no-fund']
    : ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  const dep = spawnSync(cmd, cmdArgs, { cwd: staging, encoding: 'utf8', timeout: 300000 });
  if (dep.status !== 0) {
    console.error(`[export] 依赖安装失败：${(dep.stderr || dep.stdout || dep.error?.message || '').slice(-800)}`);
    process.exit(1);
  }
  // 安装器生成的 lock 可能带本机路径；vendored zip 不需要它。
  fs.rmSync(path.join(staging, 'package-lock.json'), { force: true });
}

const FORBIDDEN = [
  { name: 'FACTORY_ROOT', re: /FACTORY_ROOT/ },
  { name: 'serviceToken', re: /serviceToken/ },
  { name: 'DPAPI', re: /DPAPI/ },
  { name: 'absolute Windows path', re: /\b[A-Za-z]:[\\/](?![\\/])/ },
  { name: '.enc', re: /\.enc\b/ },
];
const findings = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules') continue; // 第三方依赖不参与第一方禁止项扫描
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(js|mjs|cjs|json|ya?ml|md)$/i.test(name)) {
      if (name.endsWith('.enc')) findings.push({ file: p, rule: '.enc' });
      continue;
    }
    const text = fs.readFileSync(p, 'utf8');
    for (const rule of FORBIDDEN) {
      if (rule.re.test(text)) findings.push({ file: path.relative(staging, p), rule: rule.name });
    }
  }
}
walk(staging);
const scan = { ok: findings.length === 0, findings };
fs.writeFileSync(scanFile, JSON.stringify(scan, null, 2) + '\n', 'utf8');
if (!scan.ok) {
  console.error(`[export] 禁止项扫描失败：${findings.map((f) => `${f.file}:${f.rule}`).join(', ')}`);
  process.exit(1);
}

const zip = new AdmZip();
zip.addLocalFolder(staging, pkg.name.replace(/^@/, '').replace(/[\\/]/g, '-'));
zip.writeZip(zipFile);
const buf = fs.readFileSync(zipFile);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
fs.writeFileSync(`${zipFile}.sha256`, `${sha}  ${path.basename(zipFile)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, id, name: pkg.name, version: pkg.version, staging, zip: zipFile, sha256: sha, scan: scanFile }, null, 2));
