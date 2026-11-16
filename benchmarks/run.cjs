'use strict';
// benchmarks/run.cjs —— 对公开工作流基准集执行生成 + 静态/测试校验
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generatePortable, validatePortable } = require('../apps/generator/portable.cjs');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(__dirname, 'workflows');
const json = process.argv.includes('--json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bench-'));
const results = [];

(async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const started = Date.now();
    const wf = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const out = path.join(tmp, wf.id);
    let ok = false;
    let errors = [];
    try {
      generatePortable({ id: wf.id, name: wf.name, spec: wf.spec, files: wf.files, out });
      const v = await validatePortable(out);
      ok = v.ok;
      errors = v.errors;
    } catch (e) {
      errors = [e.message];
    }
    results.push({ id: wf.id, ok, ms: Date.now() - started, errors });
    if (!json) console.log(`${ok ? 'PASS' : 'FAIL'} ${wf.id} (${Date.now() - started}ms)${ok ? '' : `\n  ${errors.join('\n  ')}`}`);
  }
  const passed = results.filter((r) => r.ok).length;
  if (json) console.log(JSON.stringify({ passed, total: results.length, results }, null, 2));
  else console.log(`\n${passed}/${results.length} passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (passed !== results.length) process.exitCode = 1;
})();
