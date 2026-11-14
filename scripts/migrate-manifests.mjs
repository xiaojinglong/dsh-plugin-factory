#!/usr/bin/env node
/**
 * scripts/migrate-manifests.mjs —— 把 manifest 中的绝对路径迁移为仓库相对路径
 * 用法：node scripts/migrate-manifests.mjs [--check]
 * --check：只报告需要迁移的字段，不写文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAN = path.join(ROOT, 'platform', 'manifests');
const LEGACY_ROOT = 'D:/www/dsh-plugin-factory';
const LEGACY_DSH = 'D:/www/dshskills';
const CHECK = process.argv.includes('--check');

function relToRoot(p) {
  if (!p) return p;
  const norm = String(p).replace(/\\/g, '/');
  const legacy = LEGACY_ROOT.toLowerCase();
  if (norm.toLowerCase() === legacy) return '.';
  if (norm.toLowerCase().startsWith(`${legacy}/`)) return norm.slice(LEGACY_ROOT.length + 1);
  return norm;
}
function dshToDeployment(p) {
  if (!p) return p;
  const norm = String(p).replace(/\\/g, '/');
  const base = `${LEGACY_DSH}`;
  if (norm.toLowerCase().startsWith(`${base}/tools/`.toLowerCase())) return `deployment/tools/${norm.slice(base.length + 7)}`;
  if (norm.toLowerCase().startsWith(`${base}/skills/`.toLowerCase())) return `deployment/skills/${norm.slice(base.length + 8)}`;
  return norm;
}

const files = fs.readdirSync(MAN).filter((f) => f.endsWith('.json')).sort();
let changes = 0;
for (const file of files) {
  const full = path.join(MAN, file);
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  const next = JSON.parse(JSON.stringify(raw));
  if (next.service) {
    next.service.dir = relToRoot(next.service.dir);
    next.service.dataDir = relToRoot(next.service.dataDir);
  }
  if (next.mcp) next.mcp.dir = dshToDeployment(next.mcp.dir);
  if (next.skill) next.skill.dir = dshToDeployment(next.skill.dir);
  if (next.report) {
    next.report.generator = relToRoot(next.report.generator);
    next.report.output = relToRoot(next.report.output);
  }
  const before = JSON.stringify(raw);
  const after = JSON.stringify(next);
  if (before === after) continue;
  changes += 1;
  if (CHECK) {
    console.log(`[need-migration] ${file}`);
    continue;
  }
  fs.writeFileSync(full, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log(`[migrated] ${file}`);
}
console.log(`${CHECK ? 'check' : 'migrate'} done: ${changes} manifest(s) ${CHECK ? 'need migration' : 'updated'}`);
process.exit(CHECK && changes ? 1 : 0);
