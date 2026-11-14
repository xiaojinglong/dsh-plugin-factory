// patch-runtime-parser.mjs —— 允许无 content-type 的 POST（取消接口等）
import fs from 'node:fs';
const f = 'D:/www/dsh-plugin-factory/platform/runtime/index.js';
let s = fs.readFileSync(f, 'utf8');
if (!s.includes("addContentTypeParser")) {
  const anchor = "  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });";
  const add = `${anchor}
  // 允许无 content-type 的 POST（如 /jobs/:id/cancel），空 body 视为 {}
  app.addContentTypeParser('*', { parseAs: 'string' }, (req, body, done) => {
    try { done(null, body ? JSON.parse(body) : {}); } catch { done(null, {}); }
  });`;
  s = s.replace(anchor, add);
  fs.writeFileSync(f, s, 'utf8');
  console.log('patched content-type parser');
} else {
  console.log('already patched');
}
