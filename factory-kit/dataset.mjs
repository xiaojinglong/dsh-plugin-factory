// dataset.mjs —— 报告层统一数据集解析（契约 §3.1）
// 1) 命令行参数（dataset.json 路径）
// 2) 自动取该插件 service/data/jobs 下最新的 *_dataset.json
// 3) 回退到旧的 data/dataset.json
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function resolveDataset(pluginDir) {
  const arg = process.argv[2];
  if (arg) {
    const ds = JSON.parse(await readFile(arg, 'utf8'));
    return { ds, source: arg };
  }
  const jobsDir = path.join(pluginDir, 'service', 'data', 'jobs');
  try {
    const dirs = (await readdir(jobsDir)).sort().reverse();
    for (const d of dirs) {
      const files = await readdir(path.join(jobsDir, d)).catch(() => []);
      const f = files.find((x) => x.endsWith('_dataset.json'));
      if (f) {
        const p = path.join(jobsDir, d, f);
        const ds = JSON.parse(await readFile(p, 'utf8'));
        return { ds, source: p, jobId: d };
      }
    }
  } catch {}
  const p = path.join(pluginDir, 'data', 'dataset.json');
  return { ds: JSON.parse(await readFile(p, 'utf8')), source: p };
}

export const rowsOf = (ds) => (Array.isArray(ds) ? ds : (ds.pages || [])).flatMap((p) => p.rows || []);
