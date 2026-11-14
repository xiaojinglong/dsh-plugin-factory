// patch-cli.mjs —— 给 cli.cjs 打两个补丁（legacy 启动 + smoke 注入 token）
import fs from 'node:fs';

const f = 'D:/www/dsh-plugin-factory/platform/factory/cli.cjs';
let s = fs.readFileSync(f, 'utf8');

const oldUp = 'const list = manifests().filter((m) => (!onlyId || m.id === onlyId) && !m.legacy);';
const newUp = 'const list = manifests().filter((m) => (!onlyId || m.id === onlyId));';
if (!s.includes(newUp)) s = s.replace(oldUp, newUp);

const oldSmoke = "  console.log(execFileSync('node', ['smoke.cjs'], { cwd: dir, encoding: 'utf8' }));";
const newSmoke = `  const man = manifests().find((m) => m.id === id) || {};
  const env = { ...process.env };
  if (man.runtime && man.runtime.serviceToken) env.MCP_SERVICE_TOKEN = man.runtime.serviceToken;
  console.log(execFileSync('node', ['smoke.cjs'], { cwd: dir, encoding: 'utf8', env }));`;
if (!s.includes(newSmoke)) s = s.replace(oldSmoke, newSmoke);

fs.writeFileSync(f, s, 'utf8');
console.log('patched:', s.includes('MCP_SERVICE_TOKEN'), 'legacy-start:', !s.includes('&& !m.legacy'));
