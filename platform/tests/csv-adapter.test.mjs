// csv-adapter.test.mjs —— CSV 解析/字段映射/布尔/数组
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, convertCsv } from '../../scenarios/csv-adapter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('CSV：引号内逗号/双引号/CRLF 解析', () => {
  const { header, rows } = parseCsv('\uFEFFa,b,c\r\n1,"x, y",2\r\n3,"he said ""ok""",4\r\n');
  assert.deepEqual(header, ['a', 'b', 'c']);
  assert.equal(rows[0].b, 'x, y');
  assert.equal(rows[1].b, 'he said "ok"');
  assert.equal(rows[1].c, '4');
});

test('CSV→跨境补货：数字/引号字段正确', () => {
  const csv = fs.readFileSync(path.join(ROOT, 'scenarios', 'samples', 'xborder.csv'), 'utf8');
  const data = convertCsv('xborder-restock', csv);
  assert.equal(data.rows.length, 5);
  assert.equal(data.rows[0].name, '折叠箱, 大号');
  assert.equal(data.rows[0].stock, 18);
  assert.equal(typeof data.rows[0].price, 'number');
});

test('CSV→账号审计：布尔字段正确', () => {
  const csv = fs.readFileSync(path.join(ROOT, 'scenarios', 'samples', 'assistant.csv'), 'utf8');
  const data = convertCsv('assistant-account-audit', csv);
  assert.equal(data.rows.length, 5);
  assert.equal(data.rows[0].admin, true);
  assert.equal(data.rows[1].two_factor, false);
  assert.equal(data.rows[1].shared, true);
});

test('CSV→HR：skills 分号数组 + 默认 JD', () => {
  const csv = 'name,years,skills,salary_expect,location,availability,current_company\n林晓,4,Excel;Shopee;英语,11000,深圳,两周内,A跨境\n';
  const data = convertCsv('hr-resume-screen', csv);
  assert.equal(data.candidates.length, 1);
  assert.deepEqual(data.candidates[0].skills, ['Excel', 'Shopee', '英语']);
  assert.equal(data.candidates[0].years, 4);
  assert.ok(data.job.must_have.includes('Excel'));
});
