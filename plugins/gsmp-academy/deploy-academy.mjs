// deploy-academy.mjs —— 部署 gsmp-academy：MCP 副本 + patch + registry
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'D:/www/dsh-plugin-factory/plugins/gsmp-academy/mcp';
const REPO = 'D:/www/dshskills';
const TGT = path.join(REPO, 'tools', 'gsmp-academy-mcp');
fs.mkdirSync(TGT, { recursive: true });
for (const f of ['index.js', 'config.json', 'package.json', 'smoke.cjs']) {
  fs.copyFileSync(path.join(SRC, f), path.join(TGT, f));
}
const nm = path.join(TGT, 'node_modules');
if (!fs.existsSync(nm)) fs.symlinkSync(path.join(REPO, 'tools', 'listing-list-mcp', 'node_modules'), nm, 'junction');
console.log('mcp deployed:', TGT);

const patch = path.join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
let py = fs.readFileSync(patch, 'utf8');
if (!py.includes('mcp-gsmp-academy')) {
  py += `
# gsmp-academy（浏览器·视频播放，2026-11-14）
- insert:
    - id: mcp-gsmp-academy
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: gsmp-academy
        transport: stdio
        command: node
        toolCallTimeoutMs: 1800000
        args: ["D:/www/dshskills/tools/gsmp-academy-mcp/index.js"]
        cwd: "D:/www/dshskills/tools/gsmp-academy-mcp"
        env:
          MCP_SERVICE_BASE_URL: "http://127.0.0.1:8797"
`;
  fs.writeFileSync(patch, py, 'utf8');
  console.log('patch appended');
} else console.log('patch already has gsmp-academy');

const reg = path.join(REPO, 'registry.md');
let r = fs.readFileSync(reg, 'utf8');
if (!r.includes('| gsmp-academy |')) {
  const row = '| gsmp-academy | AI学苑课程播放 | 浏览器 | skills/gsmp-academy | tools/gsmp-academy-mcp | gsmp-academy | gsmp_academy | 8797 | D:\\www\\dshspirder\\gsmp-academy\\service | 已跑通 |\n';
  r = r.replace('\n## 端口分配', row + '\n## 端口分配');
  r = r.replace('| 8797+ | 空闲 |', '| 8797 | gsmp-academy |');
  fs.writeFileSync(reg, r, 'utf8');
  console.log('registry updated');
} else console.log('registry already has gsmp-academy');
