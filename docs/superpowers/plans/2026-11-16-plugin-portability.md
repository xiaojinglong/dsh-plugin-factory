# 插件工厂通用化改造计划

> **2026-11-16 范围更新：** 30 个旧插件不迁移，冻结在 T0，仅保证现有安装/使用；Task 10 取消，其余任务按计划执行。
>
> **2026-11-16 Task 1 结果：** Host bundle 安装/激活成功，`portable_ping` 返回 `portable-ok`。安装版 DSH 中 `@deepseek-ai/dsh-tools` 不可解析，零依赖 `ctx.tools.register({...})` 可用；portable bundle 不得无声明 import 该包。
>
> **2026-11-16 Task 5 结果：** `portable-plugins/excel-status-mark` 安装成功，`excel_status_mark` 真实处理 6 行；无服务/端口/工厂路径；详见 `docs/55`。
>
> **2026-11-16 Task 6 结果：** `export-plugin.cjs` 生成 zip/checksum/scan；zip 8.8KB，禁止项 0；详见 `docs/56`。
>
> **2026-11-16 Task 7 结果：** 从工厂外临时目录安装 zip 成功（vendored deps），`excel_status_mark` 真实处理 6 行；详见 `docs/57`。
>
> **2026-11-16 Task 8 结果：** 包名 `dsh-plugin-excel-status-mark` 安装/调用通过；导出 zip + checksum + scan；release-portable workflow 已加；详见 `docs/58`。
>
> **2026-11-16 Task 9 结果：** `dsh-factory.cjs install zip` 成功；`dsh plugin add` 自动写入 `dsh.profile.bundles`，`--dump-config` 命中；详见 `docs/59`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让插件工厂产出的插件真正可插拔：同一工厂、另一台工厂机器、只有 DSH 的机器、公开下载、一条命令安装，并完成 30 个旧插件迁移。

**Architecture:** 保留现有 T0 工厂内插件格式作为开发/兼容层；新增 T1 `portable-host`（DSH 原生 bundle，工具在 DSH 进程内，无独立服务、无绝对路径、无工厂依赖）作为新插件主产物；复杂旧插件用 T2 `portable-mcp` 兼容包逐步迁移。工厂只做构建，运行时不依赖工厂仓库。

**Tech Stack:** Node 24、DSH Cordis bundle / `defineTool`、MCP SDK、`node:sqlite`/JSON job store、Playwright、pnpm、GitHub Actions、纯 JS zip。

---

## 1. 六个目标与验收

| 目标 | 交付物 | 验收 |
|---|---|---|
| 同一工厂仓库安装 | T0 保持 | `plugin-install install --source plugins/<id>` + `doctor` |
| 另一台机器，但装工厂 | T0 可拷贝 | 复制 `plugins/<id>`，目标工厂安装成功 |
| 另一台机器，只有 DSH | T1 portable bundle | 干净 profile / 无工厂目录，Add plugin 后工具可用 |
| 任意人下载安装 | T3 公开包 | `npm pack`/GitHub release，README/凭证/license 完整 |
| 一条 shell 命令安装 | `dsh-factory add <spec>` | 一条命令完成安装/注册/健康检查/失败回滚 |
| 30 个旧插件迁移 | 迁移矩阵 + 分批 | 每个插件有归属档位、回归测试、回滚 |

## 2. 目标分层

```
T0 factory-local（现有）
  plugins/<id> + service + mcp + skills + installer patch

T1 portable-host（新插件主目标）
  <id>/
    package.json          dsh.bundle.patch
    cordis.patch.yml      insert Host plugin row
    index.js              apply(ctx) + defineTool
    lib/                  业务逻辑
    skills/<id>/SKILL.md  可选，随包文档
    README.md / LICENSE

T2 portable-mcp（兼容旧服务）
  自包含 MCP stdio server + Host wrapper / 安装期路径注入
  用于必须独立进程/长任务/浏览器的插件

T3 public-package
  T1/T2 + npm/GitHub release + README + checksum + 版本兼容
```

**决策：新插件优先 T1。** 原因：T1 的 patch 只引用包名，不需要绝对路径；工具在 DSH 进程内，不需要端口/服务/工厂 CLI；最适合“下载即装”。

## 3. 文件结构

- `docs/53-portable-plugin-contract.md`：T1/T2 契约、禁止项、凭证/数据目录规则
- `packages/portable-runtime/`：job store、错误模型、数据目录、审计
- `packages/portable-plugins/<id>/`：迁移后的业务代码
- `apps/generator/templates/portable-host/`：生成器模板
- `scripts/export-plugin.cjs`：导出 T1/T2 包
- `scripts/verify-portable.cjs`：静态检查 + 干净环境安装验收
- `scripts/dsh-factory.cjs`：一条命令安装 CLI（P4）
- `platform/tests/portable-*.test.mjs`：portable 回归
- `docs/superpowers/plans/2026-11-16-plugin-portability.md`：本计划

---

## Task 0：契约与清点

**Files:**
- Create: `docs/53-portable-plugin-contract.md`
- Create: `data/uat/portable-inventory.json`（生成物，gitignore 可选）
- Test: `platform/tests/portable-contract.test.mjs`

- [ ] **Step 1：写契约**

`docs/53-portable-plugin-contract.md` 必须包含：

```markdown
# Portable Plugin Contract

## 禁止
- 禁止引用 FACTORY_ROOT、plugins/<id>/service/data、D:/www/... 绝对路径
- 禁止把 token/账号/DPAPI 写进包
- 禁止依赖工厂 installer 修改 cordis.patch.yml

## 必须
- package.json 含 dsh.bundle.patch
- 运行数据写到 DSH_PLUGIN_DATA_DIR 或 ~/.dsh/plugin-data/<id>
- 凭证从环境变量/DSH credentials 读取
- package.json 声明全部运行依赖
- README 写清安装、配置、卸载、限制
```

- [ ] **Step 2：写 inventory 脚本**

在 `scripts/portable-inventory.cjs` 读取 `platform/manifests/*.json`，输出：

```js
#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const dir = path.join(ROOT, 'platform', 'manifests');
const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const hasBrowser = m.type === 'browser';
  const hasService = !!m.service;
  const tier = hasBrowser ? 'T2-candidate' : 'T1-candidate';
  return { id: m.id, type: m.type, effect: m.effect || 'read', hasBrowser, hasService, tier, notes: [] };
});
console.log(JSON.stringify(rows, null, 2));
```

输出形状：

```json
{
  "id": "git-flow-audit",
  "type": "file",
  "effect": "read",
  "hasBrowser": false,
  "hasService": true,
  "tier": "T1-candidate",
  "notes": ["report generator optional"]
}
```

分类规则：无浏览器/无外部账号/短任务 → `T1-candidate`；浏览器/长任务/外部账号 → `T2-candidate`。

- [ ] **Step 3：测试**

`platform/tests/portable-contract.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
test('portable contract 禁止项存在', () => {
  const text = fs.readFileSync('docs/53-portable-plugin-contract.md', 'utf8');
  for (const word of ['FACTORY_ROOT', 'dsh.bundle.patch', 'DSH_PLUGIN_DATA_DIR']) {
    assert.ok(text.includes(word), word);
  }
});
```

- [ ] **Step 4：运行**

```powershell
node --test platform/tests/portable-contract.test.mjs
node scripts/portable-inventory.cjs
```

Expected: 1 test PASS；inventory 输出 30 条。

- [ ] **Step 5：提交**

```powershell
git add docs/53-portable-plugin-contract.md scripts/portable-inventory.cjs platform/tests/portable-contract.test.mjs
git commit -m "docs: portable plugin contract and inventory"
```

---

## Task 1：T1 Host bundle 最小验证

**Files:**
- Create: `spikes/portable-host/package.json`
- Create: `spikes/portable-host/cordis.patch.yml`
- Create: `spikes/portable-host/index.js`
- Create: `spikes/portable-host/locale/en.json`
- Create: `spikes/portable-host/docs/DETAIL.md`
- Create: `spikes/portable-host/icon.svg`
- Test: `platform/tests/portable-host-spike.test.mjs`

- [ ] **Step 1：写失败测试**

测试读取 bundle 文件，断言：

```js
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.match(index, /export function apply/);
assert.match(index, /ctx\.tools\.register/);
assert.match(patch, /name: "@local\/portable-host-spike"/);
```

- [ ] **Step 2：写 bundle**

`package.json`：

```json
{
  "name": "@local/portable-host-spike",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
  "files": ["cordis.patch.yml", "index.js", "locale", "docs", "icon.svg"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: portable-host-spike
      name: "@local/portable-host-spike"
```

`index.js`：

```js
export const name = 'portable-host-spike'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'portable_ping',
    description: 'Return a fixed portable bundle result.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() { return 'portable-ok' },
  })
}
```

- [ ] **Step 3：安装验证**

在 DSH 中用 **Plugins → Add plugin** 或 `plugin_manager install_bundle` 安装 `spikes/portable-host`；新会话调用 `portable_ping`，期望 `portable-ok`。

- [ ] **Step 4：记录结果**

在 `docs/54-portable-host-spike.md` 记录：安装结果、工具名、是否出现路径/依赖问题。

- [ ] **Step 5：提交**

---

## Task 2：T2 MCP 兼容包路径验证

**Files:**
- Create: `spikes/portable-mcp/package.json`
- Create: `spikes/portable-mcp/cordis.patch.yml`
- Create: `spikes/portable-mcp/index.js`
- Test: `platform/tests/portable-mcp-spike.test.mjs`

- [ ] **Step 1：验证问题**

目标：确认 `@deepseek-ai/dsh-mcp-client` 的 `stdio` 能否用**包相对路径**启动 `index.js`，还是必须绝对路径/`cwd`。

`index.js`：

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'portable-mcp-spike', version: '0.1.0' })
server.tool('portable_ping', 'Return a fixed portable MCP result.', {}, async () => ({
  content: [{ type: 'text', text: 'portable-mcp-ok' }],
}))
await server.connect(new StdioServerTransport())
```

`cordis.patch.yml` 尝试：

```yaml
- insert:
    - id: portable-mcp-spike
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: portable-mcp-spike
        transport: stdio
        command: node
        args: ["index.js"]
        failOnStartupError: true
```

- [ ] **Step 2：安装测试**

安装后调用工具；如果失败，记录错误，并测试 `cwd`/绝对路径方案。

- [ ] **Step 3：写结论**

在 `docs/55-portable-mcp-spike.md` 明确：

```text
相对路径：可用 / 不可用
必须 cwd：是 / 否
必须绝对路径：是 / 否
结论：T2 需要安装期路径注入 / Host wrapper
```

- [ ] **Step 4：提交**

---

## Task 3：ADR 选择主目标

**Files:**
- Create: `docs/56-ADR-portable-format.md`

- [ ] **Step 1：写 ADR**

必须包含：

```markdown
# ADR-001 Portable plugin format

## Decision
新插件默认 T1 portable-host；T2 仅用于必须独立进程/浏览器的旧插件。

## Context
T1 无绝对路径/服务/端口；T2 需要安装期路径解析或 Host wrapper。

## Consequences
- 新插件重写为 apply(ctx)+defineTool
- 旧插件按迁移矩阵分批
- T0 保留为开发模式
```

- [ ] **Step 2：更新契约**

把 Task 1/2 的验证结果写回 `docs/53-portable-plugin-contract.md`。

- [ ] **Step 3：提交**

---

## Task 4：Portable runtime 核心

**Files:**
- Create: `packages/portable-runtime/index.js`
- Create: `packages/portable-runtime/job-store.js`
- Create: `packages/portable-runtime/data-dir.js`
- Create: `packages/portable-runtime/errors.js`
- Test: `platform/tests/portable-runtime.test.mjs`

- [ ] **Step 1：写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJobStore } from '../../packages/portable-runtime/index.js';

test('portable job store 持久化并限制 dataDir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-'));
  const store = createJobStore({ dataDir: dir });
  const job = store.create({ task: 'demo', params: {} });
  store.update(job.id, { status: 'done', result: { ok: true } });
  assert.equal(store.get(job.id).status, 'done');
  assert.ok(fs.existsSync(path.join(dir, 'jobs.json')));
});
```

- [ ] **Step 2：实现**

`data-dir.js` 解析顺序：`process.env.DSH_PLUGIN_DATA_DIR` → `path.join(os.homedir(), '.dsh', 'plugin-data', id)`；禁止落到插件包目录。

`job-store.js` 用 JSON 文件 + 原子写（`writeFileSync` temp + rename），保留最近 200 个 job；`create/get/update/list`。

- [ ] **Step 3：测试通过**

```powershell
node --test platform/tests/portable-runtime.test.mjs
```

- [ ] **Step 4：提交**

---

## Task 5：Excel portable 样板

**Files:**
- Create: `packages/portable-plugins/excel-status-mark/index.js`
- Create: `packages/portable-plugins/excel-status-mark/package.json`
- Create: `packages/portable-plugins/excel-status-mark/README.md`
- Test: `platform/tests/portable-excel.test.mjs`

- [ ] **Step 1：写失败测试**

测试调用导出的 `markWorkbook(inputPath)`，断言 6 行状态、原文件不变、输出新文件。

- [ ] **Step 2：实现**

把 `scenarios/excel-status-mark/runner.js` 的 Excel 逻辑移入 `lib/mark.js`，`index.js` 用 raw tool 对象注册 `excel_status_mark`：

```js
export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register({
    name: 'excel_status_mark',
    description: 'Mark order statuses in an xlsx and return the new file path.',
    parameters: {
      input_path: { type: 'string', required: true },
      output_path: { type: 'string', required: false },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args) {
      return markWorkbook(args.input_path, args.output_path)
    },
  })
}
```

- [ ] **Step 3：依赖**

`package.json`：

```json
{
  "dependencies": { "exceljs": "^4.4.0" }
}
```

- [ ] **Step 4：测试**

```powershell
node --test platform/tests/portable-excel.test.mjs
```

- [ ] **Step 5：提交**

---

## Task 6：导出命令

**Files:**
- Create: `scripts/export-plugin.cjs`
- Modify: `package.json`（加 `adm-zip` 或复用纯 JS zip）
- Test: `platform/tests/export-portable.test.mjs`

- [ ] **Step 1：命令**

```powershell
node scripts/export-plugin.cjs --id excel-status-mark --target portable --out dist/
```

产物：

```
dist/excel-status-mark/
  package.json
  cordis.patch.yml
  index.js
  lib/
  skills/
  README.md
dist/excel-status-mark-0.1.0.zip
```

- [ ] **Step 2：禁止项扫描**

导出后扫描 `dist/`：

- 不含 `serviceToken`
- 不含 `FACTORY_ROOT`
- 不含 `D:\`/`D:/www`
- 不含 `.enc`/`password`/`token`

- [ ] **Step 3：测试**

`platform/tests/export-portable.test.mjs` 运行导出到临时目录，断言：

```js
assert.ok(fs.existsSync(path.join(out, 'package.json')));
assert.match(fs.readFileSync(path.join(out, 'cordis.patch.yml'), 'utf8'), /@local\/excel-status-mark/);
assert.doesNotMatch(scanText, /FACTORY_ROOT|serviceToken|D:\/www/);
```

- [ ] **Step 4：提交**

---

## Task 7：干净 DSH 验收

**Files:**
- Create: `scripts/verify-portable.cjs`
- Create: `docs/57-clean-dsh-acceptance.md`

- [ ] **Step 1：验收清单**

```text
[ ] 目标机器只有 DSH + Node，没有插件工厂
[ ] 解压 dist/excel-status-mark
[ ] DSH Plugins → Add plugin → 选目录
[ ] 调用 excel_status_mark
[ ] 输入 xlsx，输出新 xlsx
[ ] 原文件未修改
[ ] 卸载后工具消失
```

- [ ] **Step 2：自动化**

`verify-portable.cjs` 检查 bundle 结构、依赖、禁止项；无法自动安装 DSH 的部分输出明确手工步骤。

- [ ] **Step 3：记录**

`docs/57-clean-dsh-acceptance.md` 记录机器/profile/版本/结果。

- [ ] **Step 4：提交**

---

## Task 8：公开包与安全

**Files:**
- Modify: `package.json`
- Create: `scripts/verify-package.cjs`
- Create: `README.md`（bundle 内）
- Create: `.github/workflows/release-portable.yml`

- [ ] **Step 1：包元数据**

`package.json` 必须有：

```json
{
  "name": "dsh-plugin-excel-status-mark",
  "version": "0.1.0",
  "files": ["cordis.patch.yml", "index.js", "lib", "skills", "README.md", "LICENSE"],
  "engines": { "node": ">=24" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- [ ] **Step 2：安全扫描**

`verify-package.cjs` 检查：

- 无 `private: true`
- 无 token/绝对路径
- 必含 README/LICENSE
- `npm pack --dry-run` 文件清单符合预期

- [ ] **Step 3：发布**

GitHub release 上传 `dist/*.zip` + checksum；npm 发布可选。

- [ ] **Step 4：提交**

---

## Task 9：一条 shell 命令安装

**Files:**
- Create: `scripts/dsh-factory.cjs`
- Create: `docs/58-one-command-install.md`
- Test: `platform/tests/one-command-install.test.mjs`

- [ ] **Step 1：先验证 DSH CLI 行为**

在临时 profile 验证：

```powershell
dsh plugin --profile portable-test add -w <本地 bundle 目录>
dsh --profile portable-test --dump-config
```

记录：是否进入 `dsh.profile.bundles`。

- [ ] **Step 2：确定实现路径**

二选一，ADR 记录：

- A：`dsh plugin add` 能自动注册 → `dsh-factory` 直接封装。
- B：不能 → 宿主侧调用 `plugin_manager`；或写 profile package + bundles（高风险，不默认）。

- [ ] **Step 3：实现命令**

```powershell
node scripts/dsh-factory.cjs install <spec>
```

步骤：解析 spec → 校验 bundle → 安装包 → 注册 bundle → 启动/健康检查 → 失败回滚。

- [ ] **Step 4：测试**

`one-command-install.test.mjs` 用 mock spec 测试参数解析/禁止项；真实安装作为手工验收。

- [ ] **Step 5：提交**

---

## Task 10：30 个旧插件迁移

**Files:**
- Create: `docs/59-plugin-migration-matrix.md`
- Modify: 按插件逐个迁移

- [ ] **Step 1：分类**

每个插件标记：

```text
A T1 可直接迁移（文件/短任务/无账号）
B T1 + 浏览器依赖（Playwright）
C T2 兼容（独立服务/长任务/复杂状态）
D 保留 T0（外部账号/登录态/暂不公开）
```

- [ ] **Step 2：排序**

Wave 1：`excel-status-mark`、`api-status-mark`、`message-outbox`
Wave 2：文件/报告类
Wave 3：浏览器类
Wave 4：账号/长任务类

- [ ] **Step 3：每个插件验收**

```text
[ ] 工具定义与旧插件等价
[ ] 真实 fixture 通过
[ ] 无工厂路径/token
[ ] 干净 profile 安装
[ ] 旧插件回归测试通过
```

- [ ] **Step 4：提交**

每迁移 1–2 个插件提交一次，禁止一次全迁。

---

## Task 11：旧安装路径降级

**Files:**
- Modify: `README.md`
- Modify: `docs/45-上线判断与使用说明.md`
- Modify: `apps/installer/plugin-install.cjs`（只加弃用提示，不删兼容）

- [ ] **Step 1：文档标注**

```text
plugin-install / installer patch = 本地开发/旧插件兼容
portable bundle + plugin_manager = 分发/安装标准
```

- [ ] **Step 2：回归**

```powershell
node platform/factory/cli.cjs test
node platform/factory/cli.cjs doctor --health
```

- [ ] **Step 3：提交**

---

## 4. 验收矩阵

| 验收 | 命令/动作 | 期望 |
|---|---|---|
| 工厂内 | `plugin-install install` | 30/30 可用 |
| 另一台工厂 | 复制插件 + install | 成功 |
| 只有 DSH | Add plugin portable | 工具可用、无工厂目录 |
| 公开下载 | unzip/npm pack | 无秘密/绝对路径 |
| 一条命令 | `dsh-factory install` | 成功/失败回滚 |
| 30 迁移 | matrix 全绿 | 每插件有回归 |

## 5. 估算与风险

| 阶段 | 估算 |
|---|---|
| Task 0–3 契约/SPIKE/ADR | 3–5 天 |
| Task 4–6 runtime/Excel/导出 | 5–7 天 |
| Task 7–8 干净验收/公开包 | 3–5 天 |
| Task 9 一条命令 | 5–8 天（取决于 DSH host API） |
| Task 10 30 插件迁移 | 2–4 周，按波次 |
| Task 11 清理 | 2–3 天 |

风险：

- DSH bundle API 版本变化；需固定 `runtimeRange` 并做兼容测试。
- `dsh plugin add` 是否自动注册未定；Task 9 必须先验证，不能假设。
- 浏览器/账号类插件无法零配置；必须标 `configuration required`。
- skill 自动安装依赖 DSH 能力；若不可行，工具描述 + README 作为降级。
- 旧插件迁移会引入行为差异；每个插件必须保留旧回归测试。

## 6. 执行顺序

```text
Task 0 → Task 1 → Task 2 → Task 3（决策门）
→ Task 4 → Task 5 → Task 6 → Task 7
→ 先发布 excel-status-mark
→ Task 8 → Task 9
→ Task 10 波次迁移
→ Task 11
```

**第一个可交付里程碑：** `excel-status-mark` 在无工厂目录的 DSH profile 安装并真实跑通。

---

## 7. 执行方式

建议按 Task 0–7 先做“可移植样板”，不要先做 P4/P6。  
Task 9 是唯一需要 DSH 宿主能力验证的高风险任务，放在样板通过之后。
