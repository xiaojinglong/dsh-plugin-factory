'use strict';

/**
 * packages/sdk —— 生成插件的契约与校验（M3）
 * 只约束"新生成插件"的 plugin.json；历史 manifest 兼容由 packages/config 处理。
 */

const { z } = require('zod');

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PluginSpecSchema = z.object({
  id: z.string().regex(slugRegex, 'id 必须是 kebab-case'),
  version: z.string().regex(/^\d+\.\d+\.\d+([-.+].*)?$/, 'version 必须是 semver'),
  name: z.string().min(1).max(100),
  type: z.enum(['api', 'browser', 'file']),
  effect: z.enum(['read', 'write', 'file', 'message', 'mixed']).default('read'),
  outputs: z.array(z.string()).default(['dataset', 'report']),
  runtimeRange: z.string().min(1).max(40),
  owner: z.string().min(1).max(64),
  taskType: z.string().regex(/^[a-z][a-z0-9_]*$/, 'taskType 必须是 snake_case'),
  paramsSchema: z.record(z.string(), z.any()).default({}),
  outputSchema: z.record(z.string(), z.any()).default({}),
  permissions: z.object({
    write: z.boolean().default(false),
    network: z.array(z.string()).default([]),
    browser: z.boolean().default(false),
  }).default({}),
  service: z.object({
    entry: z.string().default('server.js'),
    runner: z.string().default('runner.js'),
  }).default({}),
  mcp: z.record(z.string(), z.any()).default({}),
  skill: z.record(z.string(), z.any()).default({}),
  report: z.record(z.string(), z.any()).default({}),
}).strict();

function validatePluginSpec(spec) {
  const parsed = PluginSpecSchema.safeParse(spec);
  if (parsed.success) return { ok: true, spec: parsed.data, errors: [] };
  return {
    ok: false,
    spec: null,
    errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

module.exports = { PluginSpecSchema, validatePluginSpec, slugRegex };
