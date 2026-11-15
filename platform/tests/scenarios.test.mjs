// scenarios.test.mjs —— 9 个岗位场景业务规则回归（不启动服务，直接跑 runner）
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadRunner(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-a-scn-${id}-`));
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'service'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scenarios', id, 'fixture.json'), path.join(dir, 'fixtures', 'data.json'));
  fs.copyFileSync(path.join(ROOT, 'scenarios', id, 'runner.js'), path.join(dir, 'service', 'runner.js'));
  delete require.cache[path.join(dir, 'service', 'runner.js')];
  return require(path.join(dir, 'service', 'runner.js'));
}

async function run(id) {
  const runner = loadRunner(id);
  const saved = [];
  const ctx = {
    params: {},
    setProgress() {},
    addMissing() {},
    async saveFile(file) { saved.push(file); },
  };
  await runner.runJob({ jobId: `test-${id}` }, ctx);
  assert.equal(saved.length, 1, `${id} 应保存一个 dataset`);
  return JSON.parse(saved[0].content);
}

const rowsOf = (ds) => (ds.pages || []).flatMap((p) => p.rows || []);
const kpi = (ds, k) => (ds.extra.summary || []).find((x) => x.k === k)?.v;

test('hr-resume-screen：8 份简历，3 人进面，硬性技能缺失淘汰', async () => {
  const ds = await run('hr-resume-screen');
  assert.equal(ds.task, 'hr_resume_screen');
  assert.equal(rowsOf(ds).length, 8);
  assert.equal(kpi(ds, '进入面试'), 3);
  assert.ok(rowsOf(ds).some((r) => /缺硬性技能/.test(r.reason)));
});

test('xborder-restock：5 个 P1 断货，风险销售额 $17,066', async () => {
  const ds = await run('xborder-restock');
  assert.equal(rowsOf(ds).length, 10);
  assert.equal(kpi(ds, 'P1 断货风险'), 5);
  assert.equal(kpi(ds, '风险销售额'), '$17,066');
  assert.ok(rowsOf(ds).every((r) => typeof r.reorder_qty === 'number'));
});

test('admin-asset-audit：10 项异常，3 个 P1，重复编号被抓', async () => {
  const ds = await run('admin-asset-audit');
  assert.equal(rowsOf(ds).length, 10);
  assert.equal(kpi(ds, '异常项'), 10);
  assert.equal(kpi(ds, 'P1 责任/编号'), 3);
  assert.ok(rowsOf(ds).some((r) => /资产编号重复/.test(r.issues)));
});

test('cs-ticket-triage：2 个 SLA 超时，1 个 P1 升级', async () => {
  const ds = await run('cs-ticket-triage');
  assert.equal(rowsOf(ds).length, 10);
  assert.equal(kpi(ds, 'SLA 超时'), 2);
  assert.equal(kpi(ds, 'P1 风险'), 1);
  assert.ok(rowsOf(ds).some((r) => r.intent === '账号安全'));
});

test('dev-repo-audit：3 个疑似密钥 P1，P2 3 个', async () => {
  const ds = await run('dev-repo-audit');
  assert.equal(rowsOf(ds).length, 10);
  assert.equal(kpi(ds, 'P1 密钥'), 3);
  assert.equal(kpi(ds, 'P2 质量'), 3);
  assert.ok(rowsOf(ds).filter((r) => r.secrets_hits > 0).every((r) => r.severity === 'P1'));
});

test('seo-content-preflight：2 个禁止发布，6 个修改后发布，均分 55', async () => {
  const ds = await run('seo-content-preflight');
  assert.equal(rowsOf(ds).length, 8);
  assert.equal(kpi(ds, '禁止发布'), 2);
  assert.equal(kpi(ds, '修改后发布'), 6);
  assert.equal(kpi(ds, '平均得分'), 55);
});

test('opt-keyword-gap：4 个 P1 机会，预估月收入 ¥3,118', async () => {
  const ds = await run('opt-keyword-gap');
  assert.equal(rowsOf(ds).length, 8);
  assert.equal(kpi(ds, 'P1 机会'), 4);
  assert.equal(kpi(ds, '预估月收入'), '¥3,118');
  assert.ok(rowsOf(ds).every((r) => r.score >= 0));
});

test('promo-channel-roi：整体 ROAS 2.54，1 个渠道需降/停', async () => {
  const ds = await run('promo-channel-roi');
  assert.equal(rowsOf(ds).length, 7);
  assert.equal(kpi(ds, '整体 ROAS'), 2.54);
  assert.equal(kpi(ds, '需降/停'), 1);
  assert.ok(rowsOf(ds).some((r) => r.action === '加预算'));
});

test('assistant-account-audit：9 个 P1，8 个管理员，6 个共用', async () => {
  const ds = await run('assistant-account-audit');
  assert.equal(rowsOf(ds).length, 10);
  assert.equal(kpi(ds, 'P1 风险'), 9);
  assert.equal(kpi(ds, '管理员账号'), 8);
  assert.equal(kpi(ds, '共用账号'), 6);
});
