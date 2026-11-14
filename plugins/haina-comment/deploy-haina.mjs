// deploy-haina.mjs —— 部署 haina-comment：MCP 副本 + patch + registry
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'D:/www/dsh-plugin-factory/plugins/haina-comment/mcp';
const REPO = 'D:/www/dshskills';
const TGT = path.join(REPO, 'tools', 'haina-comment-mcp');
fs.mkdirSync(TGT, { recursive: true });
for (const f of ['index.js', 'config.json', 'package.json', 'smoke.cjs']) {
  fs.copyFileSync(path.join(SRC, f), path.join(TGT, f));
}
const nm = path.join(TGT, 'node_modules');
if (!fs.existsSync(nm)) {
  // Windows junction via fs.symlinkSync 'junction'
  fs.symlinkSync(path.join(REPO, 'tools', 'listing-list-mcp', 'node_modules'), nm, 'junction');
}
console.log('mcp deployed:', TGT);

// patch 追加
const patch = path.join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
let py = fs.readFileSync(patch, 'utf8');
if (!py.includes('mcp-haina-comment')) {
  py += `
# haina-comment（写操作插件，2026-11-14）
- insert:
    - id: mcp-haina-comment
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: haina-comment
        transport: stdio
        command: node
        toolCallTimeoutMs: 1200000
        args: ["D:/www/dshskills/tools/haina-comment-mcp/index.js"]
        cwd: "D:/www/dshskills/tools/haina-comment-mcp"
        env:
          MCP_SERVICE_BASE_URL: "http://127.0.0.1:8796"
`;
  fs.writeFileSync(patch, py, 'utf8');
  console.log('patch appended');
} else console.log('patch already has haina-comment');

// registry 追加（插件行 + 端口行）
const reg = path.join(REPO, 'registry.md');
let r = fs.readFileSync(reg, 'utf8');
if (!r.includes('| haina-comment |')) {
  const row = '| haina-comment | 海纳博客评论 | 爬虫（写操作） | skills/haina-comment | tools/haina-comment-mcp | haina-comment | haina_comment | 8796 | D:\\www\\dshspirder\\haina-comment\\service | 已跑通 |\n';
  const anchor = '\n## 端口分配';
  r = r.replace(anchor, row + anchor);
  r = r.replace('| 8794+ | 空闲 |', '| 8794 | draft-cleanup |\n| 8795 | stock-alert |\n| 8796 | haina-comment |\n| 8797+ | 空闲 |');
  if (!r.includes('| 8795 |')) {
    r = r.replace('| 8794 | draft-cleanup |', '| 8794 | draft-cleanup |\n| 8795 | stock-alert |');
  }
  fs.writeFileSync(reg, r, 'utf8');
  console.log('registry updated');
} else console.log('registry already has haina-comment');
