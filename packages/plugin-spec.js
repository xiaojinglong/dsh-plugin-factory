'use strict';
// packages/plugin-spec.js —— portable 插件 Spec 契约（无第三方依赖）
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL = /^[a-z][a-z0-9_]*$/;

function fail(errors) { const e = new Error(errors.join('; ')); e.errors = errors; throw e; }

function normalizeSpec(input = {}) {
  const errors = [];
  const id = String(input.id || '').trim();
  if (!ID.test(id)) errors.push('spec.id 必须是 kebab-case');
  const name = String(input.name || '').trim();
  if (!name) errors.push('spec.name 不能为空');
  const target = input.target || 'portable-host';
  if (!['portable-host', 'mcp'].includes(target)) errors.push('spec.target 只支持 portable-host/mcp');
  const effect = input.effect || 'read';
  if (!['read', 'write', 'file', 'message', 'mixed'].includes(effect)) errors.push('spec.effect 非法');

  const toolsIn = Array.isArray(input.tools) && input.tools.length
    ? input.tools
    : [{ name: input.toolName || id.replace(/-/g, '_'), description: input.description || name }];
  const multi = toolsIn.length > 1;
  const tools = toolsIn.map((t, i) => {
    const name = String(t.name || '').trim();
    if (!TOOL.test(name)) errors.push(`spec.tools[${i}].name 必须是 snake_case`);
    const description = String(t.description || `${name} tool`).trim();
    const handler = String(t.handler || (multi ? name : 'execute')).trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(handler)) errors.push(`spec.tools[${i}].handler 必须是合法函数名`);
    const parameters = t.parameters && typeof t.parameters === 'object' && !Array.isArray(t.parameters)
      ? t.parameters
      : { input_path: { type: 'string', required: false, description: 'Optional input path' } };
    const output = t.output && typeof t.output === 'object' ? t.output : { type: 'object' };
    return { name, description, handler, parameters, output };
  });
  const handlers = tools.map((t) => t.handler);
  if (new Set(handlers).size !== handlers.length) errors.push('spec.tools[].handler 必须唯一');
  if (!multi && tools[0].handler !== 'execute') errors.push('单工具插件 handler 必须是 execute');

  const permissionsIn = input.permissions || {};
  const permissions = {
    filesystem: Array.isArray(permissionsIn.filesystem) ? permissionsIn.filesystem.map(String) : ['read'],
    network: Array.isArray(permissionsIn.network) ? permissionsIn.network.map(String) : [],
    browser: permissionsIn.browser === true,
    process: permissionsIn.process === true,
  };
  for (const p of permissions.filesystem) if (!['read', 'write'].includes(p)) errors.push('permissions.filesystem 只允许 read/write');
  if (permissions.browser && !permissions.network.length) errors.push('browser=true 需要声明 network');

  const dependencies = input.dependencies && typeof input.dependencies === 'object' && !Array.isArray(input.dependencies)
    ? input.dependencies : {};
  for (const [k, v] of Object.entries(dependencies)) {
    if (!/^[a-z0-9@][a-z0-9@/._-]*$/i.test(k) || typeof v !== 'string') errors.push(`dependencies.${k} 非法`);
  }

  const acceptance = Array.isArray(input.acceptance) ? input.acceptance.map(String) : [];
  const rules = Array.isArray(input.rules) ? input.rules.map(String) : [];
  if (errors.length) fail(errors);
  return {
    schemaVersion: 1, id, name, description: String(input.description || name), target,
    effect, tools, permissions, dependencies, acceptance, rules,
    outputs: Array.isArray(input.outputs) ? input.outputs.map(String) : ['dataset', 'audit'],
  };
}

function legacySpec({ id, name, toolName, description, effect, outputs }) {
  return normalizeSpec({
    id, name, description: description || name, effect: effect || 'read', outputs,
    tools: [{ name: toolName || id.replace(/-/g, '_'), description: description || name }],
  });
}

module.exports = { normalizeSpec, legacySpec, ID, TOOL };
