'use strict';

/**
 * packages/config —— 统一路径/环境解析（A 生产级基线）
 *
 * 目标：代码不再硬编码 D:/www/...；仓库可在任意路径克隆；Windows 专属路径可被环境变量覆盖。
 * 环境变量：
 *   FACTORY_ROOT          仓库根（默认：本包向上两级）
 *   FACTORY_DATA_ROOT     运行数据根（默认 <root>/data）
 *   FACTORY_DSH_PROFILE   DSH profile（默认 desktop）
 *   FACTORY_DSH_PATCH     patch 文件路径（默认 <home>/.dsh/profiles/<profile>/cordis.patch.yml）
 *   FACTORY_DSH_TOOLS     MCP tools 根（默认优先 D:/www/dshskills/tools，否则 <root>/deployment/tools）
 *   FACTORY_DSH_SKILLS    skills 根（默认优先 D:/www/dshskills/skills，否则 <root>/deployment/skills）
 *   FACTORY_DSH_REGISTRY  registry 路径（默认与 tools 同级 registry.md）
 *   FACTORY_RUN_DIR       PID 目录（默认 <root>/platform/run）
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function env(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : '';
}

/** 仓库根：优先环境变量，否则由本文件位置推导（不依赖 cwd） */
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FACTORY_ROOT = path.normalize(env('FACTORY_ROOT') || REPO_ROOT);
const FACTORY_DATA_ROOT = path.normalize(env('FACTORY_DATA_ROOT') || path.join(FACTORY_ROOT, 'data'));
const DSH_HOME = path.normalize(env('DSH_HOME') || path.join(os.homedir(), '.dsh'));
const DSH_PROFILE = env('FACTORY_DSH_PROFILE') || 'desktop';
const DSH_PATCH = path.normalize(env('FACTORY_DSH_PATCH') || path.join(DSH_HOME, 'profiles', DSH_PROFILE, 'cordis.patch.yml'));
const RUN_DIR = path.normalize(env('FACTORY_RUN_DIR') || path.join(FACTORY_ROOT, 'platform', 'run'));
const MANIFEST_DIR = path.join(FACTORY_ROOT, 'platform', 'manifests');

/** 旧仓库绝对前缀：用于兼容历史 manifest（迁移后不再出现） */
const LEGACY_ROOT = 'D:/www/dsh-plugin-factory';

const LEGACY_DSH = 'D:/www/dshskills';
function firstExisting(candidates, fallback) {
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return fallback;
}
const DSH_TOOLS = path.normalize(env('FACTORY_DSH_TOOLS')
  || firstExisting([path.join(LEGACY_DSH, 'tools')], path.join(FACTORY_ROOT, 'deployment', 'tools')));
const DSH_SKILLS = path.normalize(env('FACTORY_DSH_SKILLS')
  || firstExisting([path.join(LEGACY_DSH, 'skills')], path.join(FACTORY_ROOT, 'deployment', 'skills')));
const DSH_REGISTRY = path.normalize(env('FACTORY_DSH_REGISTRY') || path.join(path.dirname(DSH_TOOLS), 'registry.md'));

function toAbsolute(p) {
  if (!p) return p;
  const norm = String(p).replace(/\\/g, '/');
  return path.isAbsolute(norm) ? path.normalize(norm) : path.resolve(FACTORY_ROOT, norm);
}

/** 历史绝对路径 → 相对仓库根（仅映射旧根前缀，其它绝对路径保持不变） */
function relToRoot(p) {
  if (!p) return p;
  const norm = String(p).replace(/\\/g, '/');
  const legacy = LEGACY_ROOT.toLowerCase();
  if (norm.toLowerCase() === legacy) return '.';
  if (norm.toLowerCase().startsWith(`${legacy}/`)) return norm.slice(LEGACY_ROOT.length + 1);
  return norm;
}

/** 历史 DSH 绝对路径 → 仓库内 deployment（迁移后不再出现） */
function dshRelToDeployment(p) {
  if (!p) return p;
  const norm = String(p).replace(/\\/g, '/').toLowerCase();
  const base = `${LEGACY_DSH}/`.toLowerCase();
  if (norm.startsWith(`${base}tools/`)) return `deployment/tools/${String(p).replace(/\\/g, '/').slice(`${LEGACY_DSH}/tools/`.length)}`;
  if (norm.startsWith(`${base}skills/`)) return `deployment/skills/${String(p).replace(/\\/g, '/').slice(`${LEGACY_DSH}/skills/`.length)}`;
  return p;
}

/**
 * 把 manifest 内的路径解析为绝对路径（返回副本，不修改入参）。
 * 同时兼容：仓库相对路径、旧仓库绝对路径、旧 DSH 绝对路径。
 */
function resolveManifest(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const m = JSON.parse(JSON.stringify(raw));
  const svc = m.service || {};
  if (svc.dir) svc.dir = toAbsolute(relToRoot(svc.dir));
  if (svc.dataDir) svc.dataDir = toAbsolute(relToRoot(svc.dataDir));
  else if (svc.dir) svc.dataDir = path.join(svc.dir, 'data');
  m.service = svc;
  if (m.mcp && m.mcp.dir) m.mcp.dir = toAbsolute(relToRoot(dshRelToDeployment(m.mcp.dir)));
  if (m.skill && m.skill.dir) m.skill.dir = toAbsolute(relToRoot(dshRelToDeployment(m.skill.dir)));
  if (m.report && typeof m.report === 'object') {
    if (m.report.generator) m.report.generator = toAbsolute(relToRoot(m.report.generator));
    if (m.report.output) m.report.output = toAbsolute(relToRoot(m.report.output));
  }
  return m;
}

module.exports = {
  REPO_ROOT,
  FACTORY_ROOT,
  FACTORY_DATA_ROOT,
  DSH_HOME,
  DSH_PROFILE,
  DSH_PATCH,
  DSH_TOOLS,
  DSH_SKILLS,
  DSH_REGISTRY,
  RUN_DIR,
  MANIFEST_DIR,
  LEGACY_ROOT,
  toAbsolute,
  relToRoot,
  resolveManifest,
};
