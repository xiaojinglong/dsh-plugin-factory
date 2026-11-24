import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createControlPlane } = require(path.join(ROOT, 'apps', 'control-plane', 'server.cjs'));

function textOf(result) {
  const text = result?.content?.find((c) => c.type === 'text')?.text || '{}';
  return JSON.parse(text);
}

test('异步 create/finalize：默认不代签验收', { timeout: 120000 }, async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-async-'));
  const cp = createControlPlane({ dataRoot, token: 'test-token' });
  const { port } = await cp.start({ port: 0 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'apps', 'factory-control-mcp', 'index.cjs')],
    env: {
      ...process.env,
      CONTROL_PLANE_URL: `http://127.0.0.1:${port}`,
      CONTROL_PLANE_TOKEN: 'test-token',
      FACTORY_DATA_ROOT: dataRoot,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'factory-async-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const created = textOf(await client.callTool({
      name: 'create_plugin',
      arguments: {
        brief: 'async acceptance test',
        pluginId: 'async-accept-demo',
        name: 'Async Accept Demo',
        wait: false,
        install: false,
        toolName: 'async_accept_demo',
        spec: {
          description: 'Async acceptance demo.',
          effect: 'read',
          permissions: { filesystem: [], network: [] },
          tools: [{ name: 'async_accept_demo' }],
        },
        files: [{
          path: 'lib/impl.js',
          content: 'export async function execute() { return { ok: true } }\n',
        }],
      },
    }));
    assert.equal(created.ok, true);
    assert.ok(created.requestId);
    let request = null;
    for (let i = 0; i < 60; i += 1) {
      request = textOf(await client.callTool({ name: 'get_request', arguments: { requestId: created.requestId } })).request;
      if (request?.state === 'staging' || request?.state === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(request?.state, 'staging', JSON.stringify(request));

    const staged = textOf(await client.callTool({
      name: 'finalize_plugin',
      arguments: { requestId: created.requestId, install: false, autoAccept: false },
    }));
    assert.equal(staged.ok, true);
    assert.equal(staged.accepted, false);
    assert.equal(staged.state, 'staging');

    const accepted = textOf(await client.callTool({
      name: 'finalize_plugin',
      arguments: { requestId: created.requestId, install: false, autoAccept: true },
    }));
    assert.equal(accepted.ok, true);
    assert.equal(accepted.state, 'accepted');
    assert.equal(accepted.installed, false);
  } finally {
    await client.close().catch(() => {});
    await cp.stop().catch(() => {});
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
