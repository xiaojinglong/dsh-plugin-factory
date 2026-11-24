#!/usr/bin/env node
'use strict';
/**
 * scripts/package-factory.cjs
 * 打包工厂源码（不含 node_modules/data/.git），生成 zip + SHA-256。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const outDir = path.join(ROOT, 'release');
fs.mkdirSync(outDir, { recursive: true });
const name = `dsh-plugin-factory-${pkg.version}.zip`;
const out = path.join(outDir, name);

const includeDirs = [
  'apps', 'packages', 'platform', 'scripts', 'config',
  'docs', 'deployment', 'templates', 'factory-kit', 'catalog', 'fixtures',
  'portable-plugins', 'scenarios', 'spikes',
];
const includeFiles = [
  'package.json', 'pnpm-lock.yaml', 'README.md', 'CHANGELOG.md',
  'ACCEPTANCE-A.md', 'DECISIONS-A.md', '.nvmrc', '.gitignore',
];
const excludeNames = new Set(['node_modules', 'data', '.git', 'release', '.dsh']);

const zip = new AdmZip();
function addFile(file, rel) {
  const content = fs.readFileSync(file);
  zip.addFile(`dsh-plugin-factory/${rel.replace(/\\/g, '/')}`, content);
}
for (const f of includeFiles) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) addFile(p, f);
}
for (const d of includeDirs) {
  const base = path.join(ROOT, d);
  if (!fs.existsSync(base)) continue;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (excludeNames.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) addFile(p, path.relative(ROOT, p));
    }
  };
  walk(base);
}
zip.writeZip(out);
const hash = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(`${out}.sha256`, `${hash}  ${name}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, zip: out, size: fs.statSync(out).size, sha256: hash }, null, 2));
