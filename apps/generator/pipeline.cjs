#!/usr/bin/env node
'use strict';

/**
 * apps/generator/pipeline.cjs —— M3 生成流水线编排（需求单 → probe → generate → validate → staging）
 *
 * 前置：控制面已在 127.0.0.1:8780 运行，且需求单 params 包含：
 *   { pluginId, name, type?, fixture? | apiUrl?, port? }
 *
 * 每一步都写入控制面 steps 与本地 evidence；任一步失败会把需求单标为 failed 并保留现场。
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('../../packages/config');
const { probe } = require('./probe.cjs');
const { generate, validateDir } = require('./generator.cjs');

function api(baseUrl, token) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  return {
    get: async (p) => {
      const r = await fetch(`${baseUrl}${p}`, { headers, signal: AbortSignal.timeout(10000) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`GET ${p} → ${r.status}：${body.error && body.error.message}`);
      return body;
    },
    post: async (p, body) => {
      const r = await fetch(`${baseUrl}${p}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`POST ${p} → ${r.status}：${out.error && out.error.message}`);
      return out;
    },
  };
}

async function runPipeline({ baseUrl = 'http://127.0.0.1:8780', token, requestId, dataRoot = config.FACTORY_DATA_ROOT } = {}) {
  if (!token) throw new Error('缺少控制面 token（CONTROL_PLANE_TOKEN）');
  const cli = api(baseUrl, token);
  const { request } = await cli.get(`/requests/${encodeURIComponent(requestId)}`);
  if (request.state !== 'submitted') throw new Error(`需求单状态必须为 submitted，当前 ${request.state}`);
  const p = request.params || {};
  const pluginId = String(p.pluginId || p.id || '').trim();
  const name = String(p.name || '').trim();
  if (!pluginId || !name) throw new Error('request.params 需要 pluginId 与 name');
  const runDir = path.join(dataRoot, 'generator', 'runs', requestId);
  fs.mkdirSync(runDir, { recursive: true });
  const evidence = {};

  async function step(stepName, fn) {
    await cli.post(`/requests/${requestId}/steps`, { step: stepName, status: 'running' });
    try {
      const ev = await fn();
      await cli.post(`/requests/${requestId}/steps`, { step: stepName, status: 'succeeded', evidence: ev });
      return ev;
    } catch (err) {
      try { await cli.post(`/requests/${requestId}/steps`, { step: stepName, status: 'failed', error: String(err.message).slice(0, 1000) }); } catch { /* ignore */ }
      throw err;
    }
  }

  evidence.probe = await step('probe', async () => {
    const r = await probe(p);
    const file = path.join(runDir, 'probe.json');
    fs.writeFileSync(file, JSON.stringify(r, null, 2) + '\n', 'utf8');
    return path.relative(dataRoot, file).split(path.sep).join('/');
  });

  const gen = await step('generate', async () => {
    const out = path.join(runDir, pluginId);
    const g = await generate({ id: pluginId, name, type: p.type, fixture: p.fixture, port: p.port, out });
    evidence.pluginDir = out;
    return path.relative(dataRoot, path.join(out, 'evidence', 'generation.json')).split(path.sep).join('/');
  });
  const pluginDir = path.join(runDir, pluginId);

  evidence.validate = await step('validate', async () => {
    const v = await validateDir(pluginDir, { staticOnly: true });
    if (!v.ok) throw new Error(`静态校验失败：${v.errors.join('; ')}`);
    return path.relative(dataRoot, path.join(pluginDir, 'evidence', 'validation-static.json')).split(path.sep).join('/');
  });

  evidence.staging = await step('staging', async () => {
    const v = await validateDir(pluginDir);
    if (!v.ok) throw new Error(`staging 失败：${v.errors.join('; ')}`);
    return path.relative(dataRoot, path.join(pluginDir, 'evidence', 'validation.json')).split(path.sep).join('/');
  });

  const final = await cli.get(`/requests/${encodeURIComponent(requestId)}`);
  const summary = { ok: true, requestId, pluginDir, evidence, state: final.request.state, steps: final.request.steps.map((s) => ({ step: s.step, status: s.status })) };
  fs.writeFileSync(path.join(runDir, 'pipeline.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  return summary;
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[a.slice(2)] = next; i += 1; } else args[a.slice(2)] = 'true';
  }
  const token = args.token || process.env.CONTROL_PLANE_TOKEN || '';
  try {
    const r = await runPipeline({
      baseUrl: args['control-plane-url'] || process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:8780',
      token, requestId: args.request, dataRoot: args['data-root'] || config.FACTORY_DATA_ROOT,
    });
    console.log(JSON.stringify(r, null, 2));
  } catch (err) {
    console.error(`[pipeline] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { runPipeline, api };
