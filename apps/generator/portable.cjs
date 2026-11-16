'use strict';
// apps/generator/portable.cjs —— 生成 DSH 原生 portable-host bundle
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeSpec, legacySpec } = require('../../packages/plugin-spec');

const ROOT = path.resolve(__dirname, '..', '..');

function fail(msg) { throw new Error(msg); }
function safeId(id) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id); }

function icon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect x="6" y="8" width="24" height="20" rx="3" fill="#1f7a4d"/><path d="M11 14h14M11 19h14M11 24h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>\n';
}

function implSource(inputPathExpr) {
  return `import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data.json')

export async function execute(args = {}) {
  const file = args.input_path || FIXTURE
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const rows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : [])
  return { input_path: ${inputPathExpr ? 'file' : 'FIXTURE'}, total: rows.length, rows: rows.slice(0, 50) }
}
`;
}

function generatePortable(opts) {
  const id = String(opts.id || '').trim();
  const name = String(opts.name || '').trim();
  if (!safeId(id)) fail('id 必须是 kebab-case');
  if (!name) fail('缺少 name');
  const out = path.resolve(opts.out || path.join(ROOT, 'portable-plugins', id));
  fs.rmSync(out, { recursive: true, force: true });
  const spec = opts.spec
    ? normalizeSpec({ ...opts.spec, id, name })
    : legacySpec({ id, name, toolName: opts.toolName, description: opts.description, effect: opts.effect, outputs: opts.outputs });
  const pkgName = `dsh-plugin-${id}`;
  const tool = spec.tools[0];
  const toolName = tool.name;
  const description = spec.description;
  const effect = spec.effect;
  const outputs = spec.outputs;
  const dependencies = spec.dependencies || {};

  for (const d of ['lib', 'fixtures', 'skills', 'locale', 'docs', 'evidence', 'tests']) fs.mkdirSync(path.join(out, d), { recursive: true });
  fs.mkdirSync(path.join(out, 'skills', id), { recursive: true });
  const fixture = opts.fixture ? path.resolve(opts.fixture) : '';
  if (fixture) {
    if (!fs.existsSync(fixture)) fail(`fixture 不存在：${fixture}`);
    fs.copyFileSync(fixture, path.join(out, 'fixtures', 'data.json'));
  } else {
    fs.writeFileSync(path.join(out, 'fixtures', 'data.json'), JSON.stringify({ rows: [{ id: 'ROW-1', value: 10 }, { id: 'ROW-2', value: 20 }] }, null, 2) + '\n', 'utf8');
  }

  const implFile = path.join(out, 'lib', 'impl.js');
  if (opts.implFile) {
    fs.copyFileSync(path.resolve(opts.implFile), implFile);
  } else if (opts.implSource) {
    fs.writeFileSync(implFile, String(opts.implSource), 'utf8');
  } else {
    fs.writeFileSync(implFile, implSource(false), 'utf8');
  }

  // 多文件：仅允许 lib/、tests/、fixtures/；index/package/patch 由生成器拥有
  const extraFiles = Array.isArray(opts.files) ? opts.files : [];
  for (const f of extraFiles) {
    const rel = String(f.path || '').replace(/\\/g, '/');
    if (!rel || path.posix.isAbsolute(rel) || rel.split('/').includes('..')) fail(`非法文件路径：${rel}`);
    if (!/^(lib|tests|fixtures)\//.test(rel)) fail(`文件只允许放在 lib/tests/fixtures：${rel}`);
    const target = path.join(out, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(f.content ?? ''), 'utf8');
  }

  const tools = spec.tools;
  const multi = tools.length > 1;
  if (multi && !fs.existsSync(path.join(out, 'lib', 'handlers.js'))) fail('多工具插件必须在 files 中提供 lib/handlers.js');
  if (!multi && !fs.existsSync(path.join(out, 'lib', 'impl.js'))) fail('单工具插件缺少 lib/impl.js');

  const importLine = multi ? "import { handlers } from './lib/handlers.js'" : "import { execute } from './lib/impl.js'";
  const registrations = tools.map((t) => `  ctx.tools.register({
    name: ${JSON.stringify(t.name)},
    description: ${JSON.stringify(t.description)},
    parameters: ${JSON.stringify(t.parameters, null, 6)},
    output: {
      schema: ${JSON.stringify(t.output)},
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) { return ${multi ? `handlers[${JSON.stringify(t.handler)}](args)` : 'execute(args)'} },
  })`).join('\n');
  const skillFile = path.join(out, 'skills', id, 'SKILL.md');
  fs.writeFileSync(skillFile, `# ${name}\n\n${description}\n\nTools:\n${tools.map((t) => `- \`${t.name}\`: ${t.description}`).join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(out, 'index.js'), `import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
${importLine}

const SKILL_FILE = fileURLToPath(new URL('./skills/${id}/SKILL.md', import.meta.url))

export const name = ${JSON.stringify(pkgName)}
export const inject = ['tools', 'skills']

export function apply(ctx) {
  ctx.skills.register({
    name: ${JSON.stringify(id)},
    description: ${JSON.stringify(description)},
    whenToUse: ${JSON.stringify(`Use when the user needs ${name}.`)},
    source: 'runtime',
    content: fs.readFileSync(SKILL_FILE, 'utf8'),
    resourceBase: { kind: 'directory', path: path.dirname(SKILL_FILE) },
    invocation: { modelInvocable: true, userInvocable: false },
  })
${registrations}
}
`, 'utf8');

  const pkg = {
    name: pkgName, version: opts.version || '0.1.0', private: false, type: 'module',
    description, license: 'Apache-2.0', effect, outputs,
    ...(Object.keys(dependencies).length ? { dependencies } : {}),
    repository: { type: 'git', url: 'git+https://github.com/xiaojinglong/dsh-plugin-factory.git', directory: `portable-plugins/${id}` },
    exports: { '.': './index.js', './locale/*.json': './locale/*.json', './icon': './icon.svg' },
    files: ['cordis.patch.yml', 'index.js', 'lib', 'skills', 'tests', 'fixtures', 'README.md', 'LICENSE', 'locale', 'docs', 'icon.svg'],
    engines: { node: '>=24' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  };
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(out, 'cordis.patch.yml'), `- insert:\n    - id: ${id}\n      name: "${pkgName}"\n`, 'utf8');
  fs.writeFileSync(path.join(out, 'locale', 'en.json'), JSON.stringify({ meta: { title: name, description, detail: 'docs/DETAIL.md' } }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(out, 'docs', 'DETAIL.md'), `# ${name}\n\n${description}\n\n- Tool: \`${toolName}\`\n- Target: portable-host\n- No factory runtime dependency\n`, 'utf8');
  fs.writeFileSync(path.join(out, 'README.md'), `# ${name}\n\nInstall this directory with DSH **Plugins → Add plugin** or:\n\n\`\`\`text\nplugin_manager install_bundle <this-directory>\n\`\`\`\n\nTool: \`${toolName}\`\n`, 'utf8');
  fs.writeFileSync(path.join(out, 'icon.svg'), icon(), 'utf8');
  const license = path.join(ROOT, 'LICENSE');
  if (fs.existsSync(license)) fs.copyFileSync(license, path.join(out, 'LICENSE'));
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), target: 'portable-host', id, name, toolName, effect, outputs, spec,
    files: extraFiles.map((f) => String(f.path).replace(/\\/g, '/')),
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(out, 'evidence', 'generation.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), target: 'portable-host', spec, files: fs.readdirSync(out),
  }, null, 2) + '\n', 'utf8');
  return { out, packageName: pkgName, toolName, id, name };
}

async function nodeCheck(file) {
  return new Promise((resolve) => {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 30000 });
    resolve({ ok: r.status === 0, error: (r.stderr || '').slice(0, 500) });
  });
}

async function validatePortable(dir) {
  const out = path.resolve(dir);
  const errors = [];
  const checks = [];
  const add = (n, ok, detail = '') => { checks.push({ n, ok, detail }); if (!ok) errors.push(`${n}: ${detail}`); };
  const pkgFile = path.join(out, 'package.json');
  if (!fs.existsSync(pkgFile)) return { ok: false, errors: ['缺少 package.json'], checks };
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  let spec = null;
  if (fs.existsSync(path.join(out, 'build.json'))) {
    try { spec = JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')).spec; } catch { /* ignore */ }
  }
  const multi = Array.isArray(spec?.tools) && spec.tools.length > 1;
  const implRel = multi ? 'lib/handlers.js' : 'lib/impl.js';
  add('package:name', /^dsh-plugin-[a-z0-9-]+$/.test(pkg.name || ''), pkg.name || '');
  add('package:bundle', pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', JSON.stringify(pkg.dsh || {}));
  for (const f of ['cordis.patch.yml', 'index.js', implRel, 'skills', 'fixtures/data.json']) add(`exists:${f}`, fs.existsSync(path.join(out, f)), f);
  for (const f of ['index.js', implRel]) {
    if (!fs.existsSync(path.join(out, f))) continue;
    const r = await nodeCheck(path.join(out, f));
    add(`syntax:${f}`, r.ok, r.error);
  }
  const text = ['index.js', implRel, 'package.json', 'cordis.patch.yml'].map((f) => fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : '')
    .concat(fs.existsSync(path.join(out, 'lib')) ? fs.readdirSync(path.join(out, 'lib')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(out, 'lib', f), 'utf8')) : [])
    .join('\n');
  add('no-factory-path', !/FACTORY_ROOT|D:[\\/]www|C:[\\/]Users/.test(text), 'forbidden path');
  add('no-token', !/serviceToken|MCP_SERVICE_TOKEN/.test(text), 'token');

  const deps = Object.keys(pkg.dependencies || {});
  if (deps.length && !fs.existsSync(path.join(out, 'node_modules'))) {
    const win = process.platform === 'win32';
    const cmd = win ? process.env.ComSpec : 'npm';
    const cmdArgs = win
      ? ['/d', '/s', '/c', 'npm.cmd install --omit=dev --ignore-scripts --no-audit --no-fund']
      : ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
    const r = spawnSync(cmd, cmdArgs, { cwd: out, encoding: 'utf8', timeout: 300000 });
    add('deps:install', r.status === 0, `${deps.join(',')}${r.status === 0 ? '' : `: ${(r.stderr || r.stdout || '').slice(-500)}`}`);
  }
  const perms = spec?.permissions || { filesystem: ['read'], network: [] };
  if (/\b(require\(['"]node:fs|from ['"]node:fs|require\(['"]fs|from ['"]fs)/.test(text) && !perms.filesystem?.includes('read')) add('permission:fs-read', false, '代码读取文件但未声明 filesystem read');
  if (/\b(fetch\(|require\(['"](?:node:)?https?|from ['"](?:node:)?https?)/.test(text) && !perms.network?.length) add('permission:network', false, '代码访问网络但未声明 network');
  if (/\b(child_process|spawn\(|exec\()/.test(text) && !perms.process) add('permission:process', false, '代码启动子进程但未声明 process');

  const testsDir = path.join(out, 'tests');
  const testFiles = fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter((f) => /\.(test|spec)\.(mjs|js)$/.test(f)) : [];
  if (testFiles.length) {
    const r = spawnSync(process.execPath, ['--test', ...testFiles.map((f) => path.join('tests', f))], {
      cwd: out, encoding: 'utf8', timeout: 120000, env: { ...process.env, FACTORY_ROOT: ROOT },
    });
    add('tests:node', r.status === 0, r.status === 0 ? `${testFiles.length} files` : `${r.stdout || ''}${r.stderr || ''}`.slice(-800));
  }
  fs.mkdirSync(path.join(out, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(out, 'evidence', 'validation.json'), JSON.stringify({ validatedAt: new Date().toISOString(), ok: errors.length === 0, checks, errors }, null, 2) + '\n', 'utf8');
  return { ok: errors.length === 0, errors, checks };
}

module.exports = { generatePortable, validatePortable };
