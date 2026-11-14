// patch-watch.mjs —— 增加 factory watch（守护进程：服务 down 自动拉起）
import fs from 'node:fs';
const f = 'D:/www/dsh-plugin-factory/platform/factory/cli.cjs';
let s = fs.readFileSync(f, 'utf8');
if (!s.includes('async function watch()')) {
  const anchor = '/* ------------------------------ main ------------------------------ */';
  const fn = `async function watch(intervalSec = 15) {
  info(\`watch 模式：每 \${intervalSec}s 检查一次，服务 down 自动重启（Ctrl+C 退出）\`);
  for (;;) {
    for (const m of manifests()) {
      const h = await health(m.port);
      if (!h) { warn(\`\${m.id} 掉线，自动重启\`); await up(m.id); }
    }
    await sleep(intervalSec * 1000);
  }
}

${anchor}`;
  s = s.replace(anchor, fn);
}
s = s.replace("    case 'status': await status(); break;", "    case 'status': await status(); break;\n    case 'watch': await watch(Number(args[0]) || 15); break;");
s = s.replace("  status              查看各服务状态", "  status              查看各服务状态\n  watch [秒]          守护模式：服务掉线自动拉起");
fs.writeFileSync(f, s, 'utf8');
console.log('watch added:', s.includes('async function watch()') && s.includes("case 'watch'"));
