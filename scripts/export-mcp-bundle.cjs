#!/usr/bin/env node
'use strict';
/**
 * scripts/export-mcp-bundle.cjs —— 把已安装插件导出为标准 MCP bundle（POC）
 * 用法：node scripts/export-mcp-bundle.cjs --id git-flow-audit [--server-name git-flow-audit-bundle] [--out <dir>]
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
const id = args.id;
if (!id) { console.error('用法：node scripts/export-mcp-bundle.cjs --id <plugin-id>'); process.exit(1); }
const manifestFile = path.join(ROOT, 'platform', 'manifests', `${id}.json`);
if (!fs.existsSync(manifestFile)) { console.error(`找不到 manifest：${manifestFile}`); process.exit(1); }
const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const serverName = args['server-name'] || `${id}-bundle`;
const out = path.resolve(args.out || path.join(ROOT, 'bundles', `${id}-mcp-bundle`));
const toolDir = path.resolve(ROOT, 'deployment', 'tools', `${id}-mcp`);
const posix = (p) => p.replace(/\\/g, '/');
const q = (s) => JSON.stringify(s);

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
    title: `${m.name} (MCP bundle POC)`,
    description: 'Connects the existing MCP service as a standard DSH bundle for install/verification.',
    detail: 'docs/DETAIL.md',
  },
}, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(out, 'docs', 'DETAIL.md'), `# ${m.name} MCP bundle POC\n\nThis configuration-only bundle connects the existing MCP service \`${id}\` using \`@deepseek-ai/dsh-mcp-client\`.\n\n- Service: http://127.0.0.1:${m.port}\n- Server name: \`${serverName}\`\n- It does not start the service or install the skill; those remain factory responsibilities.\n`, 'utf8');
fs.writeFileSync(path.join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect x="6" y="10" width="24" height="16" rx="3" fill="#2f6fed"/><path d="M12 18h12m-4-4 4 4-4 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`, 'utf8');
console.log(JSON.stringify({ ok: true, id, serverName, out, toolDir }, null, 2));
