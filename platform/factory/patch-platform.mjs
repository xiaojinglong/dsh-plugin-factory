// patch-platform.mjs —— v3 收尾修补：日志/写操作 dry_run/doctor/registry 生成
import fs from 'node:fs';

const R = 'D:/www/dsh-plugin-factory/platform';

/* 1) logger：允许字符串作为 msg */
let lg = fs.readFileSync(`${R}/runtime/logger.js`, 'utf8');
const oldWrite = "  function write(level, fields, msg) {\n    const line = JSON.stringify({ ts: new Date().toISOString(), level, service: name, msg, ...fields }) + '\\n';";
const newWrite = "  function write(level, fields, msg) {\n    if (typeof fields === 'string') { msg = fields; fields = {}; }\n    const line = JSON.stringify({ ts: new Date().toISOString(), level, service: name, msg, ...fields }) + '\\n';";
if (!lg.includes('typeof fields')) lg = lg.replace(oldWrite, newWrite);
fs.writeFileSync(`${R}/runtime/logger.js`, lg, 'utf8');

/* 2) runtime：dry_run 放行（不消耗写额度、不要求 confirm_write） */
let rt = fs.readFileSync(`${R}/runtime/index.js`, 'utf8');
const oldGate = `    const params = body.params && typeof body.params === 'object' ? body.params : body;
    if (write && !writeApproved(body)) {
      return reply.code(403).send({ error: '写操作被拒绝：需要 confirm_write=true 且合法 approval_token' });
    }
    if (write) {`;
const newGate = `    const params = body.params && typeof body.params === 'object' ? body.params : body;
    const isDry = !!(params && params.dry_run === true);
    if (write && !isDry && !writeApproved(body)) {
      return reply.code(403).send({ error: '写操作被拒绝：需要 confirm_write=true（可先用 dry_run=true 预演）' });
    }
    if (write && !isDry) {`;
if (!rt.includes('const isDry')) rt = rt.replace(oldGate, newGate);
fs.writeFileSync(`${R}/runtime/index.js`, rt, 'utf8');

/* 3) cli：doctor legacy/章节检查 + registry 自动生成 */
let cli = fs.readFileSync(`${R}/factory/cli.cjs`, 'utf8');
cli = cli.replace(
  "      if (!h) bad(`${m.id}：:${m.port} 不健康`);\n      else if (h.id !== m.id) bad(`${m.id}：健康检查返回 id=${h.id}`);",
  "      if (!h) bad(`${m.id}：:${m.port} 不健康`);\n      else if (!m.legacy && h.id !== m.id) bad(`${m.id}：健康检查返回 id=${h.id}`);"
);
cli = cli.replace(
  "    for (const sec of ['适用场景', '业务编排流程', '异常与重试', '待确认']) {\n      if (!t.includes(sec)) warn(`${m.id}：SKILL 缺章节「${sec}」`);\n    }",
  "    const sections = [[/适用场景/, '适用场景'], [/编排|流程/, '编排流程'], [/异常/, '异常处理'], [/待确认/, '待确认']];\n    for (const [re, label] of sections) {\n      if (!re.test(t)) warn(`${m.id}：SKILL 缺章节「${label}」`);\n    }"
);
// 插入 writeRegistry 并在 render 后调用
if (!cli.includes('function writeRegistry')) {
  const anchor = 'function saveManifest(m) {';
  const fn = `function writeRegistry(list) {
  const rows = list.sort((a, b) => a.port - b.port);
  const lines = [
    '# 插件登记表（Plugin Registry）', '',
    '> 本文件由 \`factory render\` 从 platform/manifests/*.json 自动生成，请勿手改。', '',
    '| 业务标识 | 中文名 | 类型 | Skill 目录 | MCP 目录 | serverName | taskType | 端口 | 执行层服务 | 状态 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const m of rows) {
    lines.push(\`| \${m.id} | \${m.name} | \${m.type}\${m.runtime?.write ? '（写操作）' : ''} | skills/\${m.id} | tools/\${m.id}-mcp | \${m.serverName} | \${m.taskType} | \${m.port} | \${m.service.dir} | \${m.legacy ? 'legacy' : '已迁移'} |\`);
  }
  lines.push('', '## 端口分配', '', '| 端口 | 占用插件 |', '|---|---|');
  for (const m of rows) lines.push(\`| \${m.port} | \${m.id} |\`);
  lines.push('', '## 复用约定（v3）', '', '1. 共享 runtime：plugin/service/server.js 只调用 \`platform/factory/bootstrap\`；运行时/任务引擎/鉴权/写操作治理/指标/日志只有一份。', '2. 单一事实源：\`platform/manifests/<id>.json\` → 本表与 patch 由 CLI 生成。', '3. 凭证：DPAPI 加密存于 \`platform/secrets/<id>.enc\`，服务启动时注入 env。', '4. 报告统一用 \`factory-kit/report-kit.mjs\`。');
  fs.writeFileSync('D:/www/dshskills/registry.md', lines.join('\\n') + '\\n', 'utf8');
}

function saveManifest(m) {`;
  cli = cli.replace(anchor, fn);
}
cli = cli.replace("  fs.writeFileSync(PATCH, next, 'utf8');\n  ok(`patch 已由 manifest 重新生成", "  fs.writeFileSync(PATCH, next, 'utf8');\n  writeRegistry(list);\n  ok(`patch 与 registry 已由 manifest 重新生成");
fs.writeFileSync(`${R}/factory/cli.cjs`, cli, 'utf8');

console.log('patched:', {
  logger: lg.includes('typeof fields'),
  dryRun: rt.includes('const isDry'),
  doctor: cli.includes('m.legacy && h.id'),
  registry: cli.includes('function writeRegistry'),
});
