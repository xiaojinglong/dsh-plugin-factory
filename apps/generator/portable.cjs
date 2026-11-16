'use strict';
// apps/generator/portable.cjs —— 生成 DSH 原生 portable-host bundle
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
  const pkgName = `dsh-plugin-${id}`;
  const toolName = opts.toolName || id.replace(/-/g, '_');
  const description = String(opts.description || `${name} portable DSH plugin`);
  const effect = opts.effect || 'read';
  const outputs = Array.isArray(opts.outputs) ? opts.outputs : ['dataset', 'audit'];

  for (const d of ['lib', 'fixtures', 'skills', 'locale', 'docs', 'evidence']) fs.mkdirSync(path.join(out, d), { recursive: true });
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

  const skillFile = path.join(out, 'skills', id, 'SKILL.md');
  fs.writeFileSync(skillFile, `# ${name}\n\nUse \`${toolName}\` for this portable DSH plugin.\n\n${description}\n`, 'utf8');
  fs.writeFileSync(path.join(out, 'index.js'), `import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execute } from './lib/impl.js'

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
  ctx.tools.register({
    name: ${JSON.stringify(toolName)},
    description: ${JSON.stringify(description)},
    parameters: {
      input_path: { type: 'string', required: false, description: 'Optional JSON input; defaults to bundled fixture' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) { return execute(args) },
  })
}
`, 'utf8');

  const pkg = {
    name: pkgName, version: opts.version || '0.1.0', private: false, type: 'module',
    description, license: 'Apache-2.0', effect, outputs,
    repository: { type: 'git', url: 'git+https://github.com/xiaojinglong/dsh-plugin-factory.git', directory: `portable-plugins/${id}` },
    exports: { '.': './index.js', './locale/*.json': './locale/*.json', './icon': './icon.svg' },
    files: ['cordis.patch.yml', 'index.js', 'lib', 'skills', 'README.md', 'LICENSE', 'locale', 'docs', 'icon.svg'],
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
    generatedAt: new Date().toISOString(), target: 'portable-host', id, name, toolName, effect, outputs,
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(out, 'evidence', 'generation.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), target: 'portable-host', spec: { id, name, toolName, effect, outputs }, files: fs.readdirSync(out),
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
  add('package:name', /^dsh-plugin-[a-z0-9-]+$/.test(pkg.name || ''), pkg.name || '');
  add('package:bundle', pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', JSON.stringify(pkg.dsh || {}));
  for (const f of ['cordis.patch.yml', 'index.js', 'lib/impl.js', 'skills', 'fixtures/data.json']) add(`exists:${f}`, fs.existsSync(path.join(out, f)), f);
  for (const f of ['index.js', 'lib/impl.js']) {
    if (!fs.existsSync(path.join(out, f))) continue;
    const r = await nodeCheck(path.join(out, f));
    add(`syntax:${f}`, r.ok, r.error);
  }
  const text = ['index.js', 'lib/impl.js', 'package.json', 'cordis.patch.yml'].map((f) => fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : '').join('\n');
  add('no-factory-path', !/FACTORY_ROOT|D:[\\/]www|C:[\\/]Users/.test(text), 'forbidden path');
  add('no-token', !/serviceToken|MCP_SERVICE_TOKEN/.test(text), 'token');
  fs.mkdirSync(path.join(out, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(out, 'evidence', 'validation.json'), JSON.stringify({ validatedAt: new Date().toISOString(), ok: errors.length === 0, checks, errors }, null, 2) + '\n', 'utf8');
  return { ok: errors.length === 0, errors, checks };
}

module.exports = { generatePortable, validatePortable };
