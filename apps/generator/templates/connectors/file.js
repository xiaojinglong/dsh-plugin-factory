import fs from 'node:fs';
import path from 'node:path';

export function readText(file) { return fs.readFileSync(file, 'utf8'); }
export function writeText(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8'); return file; }
export function readJson(file) { return JSON.parse(readText(file)); }
export function writeJson(file, value) { return writeText(file, JSON.stringify(value, null, 2) + '\n'); }
export function readCsv(file) {
  const lines = readText(file).trim().split(/\r?\n/);
  const head = lines.shift().split(',').map((x) => x.trim());
  return lines.map((line) => Object.fromEntries(line.split(',').map((x, i) => [head[i], x.trim()])));
}
export function writeCsv(file, rows) {
  const head = rows.length ? Object.keys(rows[0]) : [];
  const text = [head.join(','), ...rows.map((r) => head.map((k) => r[k] ?? '').join(','))].join('\n') + '\n';
  return writeText(file, text);
}
