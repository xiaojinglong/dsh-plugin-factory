// factory-control-mcp.test.mjs —— MCP 薄壳端到端（SDK Client over stdio ↔ 控制面）
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const require = createRequire(import.meta.url);
const config = require('../../packages/config');
const { createControlPlane } = require('../../apps/control-plane/server.cjs');
const ROOT = config.FACTORY_ROOT;
const MCP = path.join(ROOT, 'apps', 'factory-control-mcp', 'index.cjs');
const TOKEN = 'mcp-test-token';

function parseTool(res) {
  assert.ok(res && Array.isArray(res.content) && res.content[0] && res.content[0].type === 'text');
  return JSON.parse(res.content[0].text);
}

test('factory-control MCP：工具列表 + 创建/推进/查询需求单', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-a-mcp-'));
  const cp = createControlPlane({ dataRoot, token: TOKEN });
  const { port } = await cp.start({ port: 0 });
  const base = `http://127.0.0.1:${port}`;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP],
    cwd: ROOT,
    env: { ...process.env, CONTROL_PLANE_URL: base, CONTROL_PLANE_TOKEN: TOKEN },
  });
  const client = new Client({ name: 'mcp-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    for (const n of ['backup_state', 'create_request', 'get_metrics', 'get_request', 'list_plugins', 'list_requests', 'run_step']) {
      assert.ok(names.includes(n), `缺少工具 ${n}`);
    }

    const created = parseTool(await client.callTool({ name: 'create_request', arguments: { brief: 'MCP 端到端：做一个库存预警插件' } }));
    assert.equal(created.ok, true);
    const id = created.request.id;
    assert.match(id, /^req_/);

    const start = parseTool(await client.callTool({ name: 'run_step', arguments: { requestId: id, step: 'probe', status: 'running' } }));
    assert.equal(start.request.currentStep, 'probe');
    const ok = parseTool(await client.callTool({ name: 'run_step', arguments: { requestId: id, step: 'probe', status: 'succeeded', evidence: 'probe.json' } }));
    assert.equal(ok.request.state, 'probe');

    const got = parseTool(await client.callTool({ name: 'get_request', arguments: { requestId: id } }));
    assert.equal(got.request.id, id);

    const plugins = parseTool(await client.callTool({ name: 'list_plugins', arguments: {} }));
    assert.ok(plugins.plugins.length >= 12);

    const metrics = parseTool(await client.callTool({ name: 'get_metrics', arguments: {} }));
    assert.ok(metrics.requests.total >= 1);
  } finally {
    try { await client.close(); } catch { /* ignore */ }
    await cp.stop();
  }
});
