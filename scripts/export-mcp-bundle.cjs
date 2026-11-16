#!/usr/bin/env node
'use strict';
/**
 * scripts/export-mcp-bundle.cjs —— 把已安装插件导出为标准 MCP bundle
 * 单插件：node scripts/export-mcp-bundle.cjs --id git-flow-audit [--server-name git-flow-audit-bundle] [--out <dir>]
 * 全量：  node scripts/export-mcp-bundle.cjs --all [--out-root bundles]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else args[k] = 'true';
}
if (!args.id && args.all !== 'true') {
  console.error('用法：--id <plugin-id> 或 --all [--out-root bundles]');
  process.exit(1);
}
const manifestsDir = path.join(ROOT, 'platform', 'manifests');
const outRoot = path.resolve(args['out-root'] || path.join(ROOT, 'bundles'));
const posix = (p) => p.replace(/\\/g, '/');
const q = (s) => JSON.stringify(s);

function makeBundle(id, opts = {}) {
  const manifestFile = path.join(manifestsDir, `${id}.json`);
  if (!fs.existsSync(manifestFile)) throw new Error(`找不到 manifest：${manifestFile}`);
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (m.legacy) return null;
  const serverName = opts.serverName || `${id}-bundle`;
  const out = path.resolve(opts.out || path.join(outRoot, `${id}-mcp-bundle`));
  const toolDir = path.resolve(ROOT, 'deployment', 'tools', `${id}-mcp`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'locale'), { recursive: true });
  fs.mkdirSync(path.join(out, 'docs'), { recursive: true });

  const pkg = {
    name: `@local/${id}-mcp-bundle`,
    version: '0.1.0',
    private: true,
    type: 'module',
    exports: { './locale/*.json': './locale/*.json', './icon': './icon.svg' },
    files: ['cordis.patch.yml', 'locale/*.json', 'docs', 'icon.svg'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  };
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  const patch = `- insert:
    - id: mcp-${id}-bundle
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: ${q(serverName)}
        transport: stdio
        command: node
        args: [${q(posix(path.join(toolDir, 'index.js')))}]
        cwd: ${q(posix(toolDir))}
        toolCallTimeoutMs: ${m.runtime?.toolTimeoutMs || 60000}
        env:
          MCP_SERVICE_BASE_URL: ${q(`http://127.0.0.1:${m.port}`)}
          MCP_SERVICE_TOKEN: ${q(m.runtime?.serviceToken || '')}
        failOnStartupError: true
`;
  fs.writeFileSync(path.join(out, 'cordis.patch.yml'), patch, 'utf8');

  fs.writeFileSync(path.join(out, 'locale', 'en.json'), JSON.stringify({
    meta: {
      title: `${m.name} (MCP bundle)`,
      description: 'Connects the existing MCP service as a standard DSH bundle. The factory still owns service startup and skill installation.',
      detail: 'docs/DETAIL.md',
    },
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(out, 'docs', 'DETAIL.md'), `# ${m.name} MCP bundle\n\nConfiguration-only DSH bundle for \`${id}\`.\n\n- Service: http://127.0.0.1:${m.port}\n- Server name: \`${serverName}\`\n- Bundle does not start the service or install the skill; those remain factory responsibilities.\n`, 'utf8');
  fs.writeFileSync(path.join(out, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect x="6" y="10" width="24" height="16" rx="3" fill="#2f6fed"/><path d="M12 18h12m-4-4 4 4-4 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>\n', 'utf8');
  return { id, serverName, out };
}

const list = [];
try {
  if (args.all === 'true') {
    const ids = fs.readdirSync(manifestsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    for (const id of ids) {
      const r = makeBundle(id);
      if (r) list.push(r);
    }
    fs.writeFileSync(path.join(outRoot, 'catalog.json'), JSON.stringify({ generatedAt: new Date().toISOString(), bundles: list }, null, 2) + '\n', 'utf8');
  } else {
    const r = makeBundle(args.id, { serverName: args['server-name'], out: args.out });
    if (r) list.push(r);
  }
  console.log(JSON.stringify({ ok: true, bundles: list }, null, 2));
} catch (err) {
  console.error(`[export-mcp-bundle] ${err.message}`);
  process.exit(1);
}
