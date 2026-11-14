# PROMPT-A · 今夜 MVP 开发指令（单机版 A）

> 用法：在 `D:\www\dsh-plugin-factory` 打开新会话，把本文件整份内容作为第一条消息发给 AI。
> 说明：`PLAN-A.md` 的 6 周是完整产品周期；本文件把今晚压缩为**可运行的最小垂直切片**，其余按 PLAN-A 后续推进。

---

你是 A 项目（单机版插件工厂）的自主开发工程师。用户已睡觉，**不要提问**；遇到不确定项自己拍板，写进 `DECISIONS-A.md`。目标是在今晚尽可能交付一个**可运行、可验证、已提交推送**的最小切片，而不是假装完成全部计划。

## 0. 立即开始（先做，10 分钟内）

1. 阅读顺序：`PLAN-A.md` → `HANDOFF.md` → `docs/23-复杂场景插件与可靠性改进.md` → `docs/25-A+B双形态架构.md` → `docs/10-标准产物契约.md`。
2. 运行基线并记录输出：
   ```powershell
   cd D:\www\dsh-plugin-factory\platform\factory
   node cli.cjs status
   node cli.cjs doctor --health
   node cli.cjs test
   ```
   期望：12 服务 UP、doctor 全绿（warn 1 legacy）、21/21 测试通过。**如果基线不绿，先修基线再开发。**
3. 确认 Git 状态：`git status --short` 应为空；`git log --oneline -3` 应包含 `13cd5a9`。

## 1. 硬约束（违反即失败）

- **只改 A 仓库**：`D:\www\dsh-plugin-factory`。绝对不要读写 `D:\www\dsh-plugin-factory-bc`。
- **不要动 B 的命名空间**：不要使用 889x 端口、`desktop-bc` profile、`D:/www/dshskills-bc`。
- **不要修改 8 个既有业务插件的业务逻辑/数据**（`plugins/concise-analysis|listing-list|shop-list|ads-list|draft-cleanup|stock-alert|haina-comment|gsmp-academy`）；只允许新增代码或必要的路径/配置适配。
- **不要改用户正在使用的 DSH profile** `~/.dsh/profiles/desktop`。需要验证 MCP/技能时用 **stdio 直接测试**（参考 `plugins/*/mcp/smoke.cjs`）；如确需写入 DSH，必须先用 `desktop-a-dev` 测试 profile，并写清回滚步骤。
- **不要提交**：`.env`、`platform/secrets/*.enc`、`data/sessions/*`、`plugins/*/data/*`、`plugins/*/service/data/*`、`plugins/*/report/*`、`platform/run/*`、`node_modules`（已被 `.gitignore` 覆盖，提交前用 `git status` 复核）。
- **不伪造完成**：没跑过的验证不能写"通过"；未完成项必须在 `STATUS-A.md` 标 `TODO/BLOCKED` 并写原因。
- **不要长时间卡在一个问题**：同一问题尝试 3 次仍失败 → 记录 `BLOCKED`，转下一项。
- Windows 环境规则：PowerShell 5.1 **不支持 `&&`**（用 `;`）；`.ps1` 必须 UTF-8 带 BOM；`npm` 被 ExecutionPolicy 拦截时用 **`npm.cmd`**；不要假设 Linux 命令可用。

## 2. 今夜交付定义（DoD）

按优先级从 P0 往下做。**P0 未完成则 P1/P2 不做**；每完成一项立即提交并记录证据。

### P0（必须完成，约 4–6 小时）

1. **工程基线**
   - 根 `package.json`（`name/version/private/engines>=24/scripts`：`test`、`doctor`、`render`）+ `package-lock.json`（若 registry 不可用，用 `npm.cmd install --package-lock-only --offline`，仍不行则记录 BLOCKED 并保证现有 `node_modules` 下 `node --test` 可跑）。
   - `.nvmrc`、GitHub Actions `.github/workflows/ci.yml`（windows-latest：`npm.cmd ci` → `node --test` → `node --check`；允许失败时降级为 `npm.cmd install`）。
   - 更新 `HANDOFF.md`/`README.md`/`CHANGELOG.md`：12 插件、6 项修复、A 单机版定位；不改写历史章节。
2. **路径配置层**
   - 新增 `packages/config/`：`resolveRoot()`、`resolveDataRoot()`、`resolveDshProfile()`、`resolveDshTools()`；支持 `FACTORY_ROOT`/`FACTORY_DATA_ROOT` 环境变量。
   - 让 `platform/factory/cli.cjs` 与测试优先使用该层（保留环境变量覆盖），禁止在**新增代码**里硬编码 `D:/www/...`。
   - 验收：`grep` 新增目录无 `D:/www`；现有 21 测试仍通过。
3. **本地控制面骨架**（核心）
   - `apps/control-plane/`：Fastify 服务，默认 `127.0.0.1:8780`，SQLite `state.db`（数据根下）。
   - 表：`requests`（id/brief/state/params/created_at/updated_at）、`step_runs`（request_id/step/status/evidence/error）、`audit`（actor/action/object/before/after/at）。
   - API：`GET /health`、`POST /requests`、`GET /requests/:id`、`POST /requests/:id/step`（先支持 `note`），token 鉴权（安装时生成，写入数据根配置文件）。
   - 统一错误结构 + 请求校验；写最小集成测试（临时 SQLite/随机端口，`fetch` 调用）≥6 例。
   - 提供 `npm.cmd run control-plane` 启动脚本；不能影响 8790–8801 现有服务。
4. **提交与证据**
   - `STATUS-A.md`：完成/未完成/阻塞、命令与输出摘要、假设、回滚方法。
   - `DECISIONS-A.md`：今晚拍板的技术选择（如 SQLite 表结构、token 存放、为何未改 DSH profile）。
   - 分支 `feat/night-mvp-a`，每 45–60 分钟小步提交（conventional commits）；结束时若全绿：合并 `main`、打 tag `night-2026-11-15-a`、push（含 tag）。

### P1（P0 完成后做，约 2–4 小时）

5. **插件契约 SDK**
   - `packages/sdk/`：`plugin.json` JSON Schema（id/version/runtimeRange/type/name/owner/paramsSchema/outputSchema/permissions/service/mcp/skill/report），`validatePlugin()` + 单测。
   - `templates/plugin/`：一个新插件脚手架（service/mcp/skill/report/test/sample），可被 `factory new` 使用。
6. **factory-control MCP + factory-agent Skill 骨架**
   - `apps/factory-control-mcp/`：stdio MCP 薄壳，工具：`create_request`、`get_request`、`run_step`、`list_plugins`；转发到控制面 token。
   - `skills/factory-agent/SKILL.md`：需求卡 6 要素（数据源/凭证/登录态/输出/规则/边界）、≤3 问、门禁话术、失败解释模板；**不写业务逻辑**。
   - 用 node stdio 冒烟（参考 `smoke.cjs`）验证工具可调用；**不写入用户 DSH profile**。
7. **一条 golden path（模板级）**
   - 用 fixture（API 或文件类）跑通：`request → probe(fixture) → generate(模板) → validate(contract+smoke) → staging report`。
   - 产物落数据根 `artifacts/<requestId>/`；报告用 `report-kit`。
   - 如果时间不够，至少完成到 `validate`，并在 STATUS 写清缺口与下一步。

### P2（可选，时间允许才做）

8. 安装器骨架 `apps/installer/setup.ps1`：`--check`（Node/端口/Playwright/DSH 检测）+ 备份/回滚框架，不实际改 DSH。
9. `doctor` 增加控制面健康检查。
10. 生成器探测适配器（file 类优先）单测。

## 3. 质量要求

- 所有新增 JS/TS 必须能 `node --check`；测试用 `node --test`。
- 每个 API 必须有输入校验、可读错误、审计记录；控制面测试不得依赖真实网络/真实凭证。
- 提交前跑：`node cli.cjs test`（21+ 新测试全绿）、`git status` 无敏感文件、`git diff --stat` 自查。
- 不要为了让测试过而删/改既有测试；可以新增。

## 4. Git 与汇报

- 分支：`feat/night-mvp-a`；commit 前缀：`feat:`/`fix:`/`test:`/`docs:`/`chore:`。
- 结束时：`main` 全绿则合并 + tag `night-2026-11-15-a` + `git push origin main --tags`；不绿则只 push 分支并在 STATUS 说明。
- 最终输出（对话里）：
  1) 完成/未完成清单；2) 关键命令与输出；3) commit/tag/远端；4) 下一步（按 PLAN-A）；5) 风险与回滚。

## 5. 停手条件

- 基线不绿且 30 分钟内无法修复 → 停止新增，写 BLOCKED，提交现有状态。
- 依赖安装被网络/策略阻断 → 用现有 `node_modules` 继续，`package-lock` 标 BLOCKED。
- 任何可能影响用户现有 12 个服务/DSH 会话的操作 → 先备份，默认不做。
- 时间/上下文耗尽 → 停在全绿状态，写清 STATUS，push。

---

**现在开始：先读文件 + 跑基线，然后按 P0-1 → P0-2 → P0-3 顺序执行。**
