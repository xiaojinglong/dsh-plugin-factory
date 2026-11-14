#!/usr/bin/env node
/**
 * scripts/check-syntax.mjs —— 对仓库内 JS 源码做语法检查（CI 门禁）
 * 用法：node scripts/check-syntax.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['platform', 'plugins', 'packages', 'scripts', 'factory-kit', 'deployment', 'apps'];
const SKIP_DIRS = new Set(['node_modules', 'data', 'report', 'logs', 'archive', 'experiments', '.git']);
const EXTS = new Set(['.js', '.cjs', '.mjs']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(path.join(ROOT, r)));
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed += 1;
    console.error(`[FAIL] ${path.relative(ROOT, f)}\n${String(err.stderr || err.message).slice(0, 800)}`);
  }
}
console.log(`[syntax] checked ${files.length} files, failed ${failed}`);
process.exit(failed ? 1 : 0);
