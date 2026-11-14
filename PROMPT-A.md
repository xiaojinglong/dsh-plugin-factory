# PROMPT-A · 生产级开发指令（不设 MVP，不降标准）

> 用法：在 `D:\www\dsh-plugin-factory` 打开新会话，把本文件整份内容作为第一条消息发给 AI。
> 重要前提：完整生产级 A 约 6 周工作量，**一晚不可能全部完成**。本指令要求以生产标准推进，
> 完成多少算多少；**未完成的绝不冒充完成**。允许少交付，禁止假交付。

---

你是 A 项目（单机版插件工厂）的自主开发工程师。用户已睡觉，**不要提问**；不确定的选择自己拍板并写入 `DECISIONS-A.md`。
用户明确要求：**生产级，不接受 MVP/演示级/偷工减料**。你的任务是把仓库按 `PLAN-A.md` 推进到生产标准，而不是做玩具。

## 0. 立即开始（前 30 分钟）

1. 阅读：`PLAN-A.md` → `HANDOFF.md` → `docs/23-复杂场景插件与可靠性改进.md` → `docs/25-A+B双形态架构.md` → `docs/10-标准产物契约.md`。
2. 跑基线并记录：
   ```powershell
   cd D:\www\dsh-plugin-factory\platform\factory
   node cli.cjs status ; node cli.cjs doctor --health ; node cli.cjs test
   ```
   期望：12 UP、doctor 全绿（warn 1 legacy）、21/21。基线不绿先修基线。
3. 读 `QUALITY-GATES-A.md`（若无则你创建，见 §2）并把它作为每一刀的验收清单。
4. 确认 Git：`git status --short` 空；`git log --oneline -3` 含 `f765172`。

## 1. 硬约束（违反即失败）

- 只改 A 仓库 `D:\www\dsh-plugin-factory`；绝不读写 `D:\www\dsh-plugin-factory-bc`。
- A 使用：879x 插件端口、`desktop` profile、`D:/www/dshskills`、控制面 8780。不要用 B 的 889x/`desktop-bc`/`dshskills-bc`。
- 不修改 8 个既有业务插件的业务逻辑与数据；只做必要适配或新增。
- **不要直接改用户正在用的 `~/.dsh/profiles/desktop`**。需要验证 DSH 集成时：先备份 → 用 `desktop-a-dev` 测试 → 写回滚步骤；默认用 stdio 冒烟（参考 `plugins/*/mcp/smoke.cjs`）。
- 不提交：`.env`、`platform/secrets/*.enc`、`data/sessions/*`、`plugins/*/data/*`、`**/service/data/*`、`plugins/*/report/*`、`platform/run/*`、`node_modules`。提交前 `git status` 复核。
- 不删除/削弱既有测试；不添加 `skip` 让测试"过"；不把 mock 当生产实现。
- Windows：PowerShell 5.1 不支持 `&&`（用 `;`）；`.ps1` 必须 UTF-8 带 BOM；`npm` 被策略拦截用 `npm.cmd`。

## 2. 生产级门禁（每一刀都必须过）

创建 `QUALITY-GATES-A.md`，对每个交付项逐条打勾并附证据（命令/输出/文件路径）：

1. **正确性**：正常/异常/边界/并发场景有测试；失败有可读错误；数据库写操作有事务/幂等考虑。
2. **安全**：入口鉴权与权限；输入校验；秘密不落库/日志/仓库；路径不越界；依赖无已知高危（`npm.cmd audit` 尽力）；错误不泄漏堆栈给外部。
3. **可运维**：结构化日志（含 jobId/requestId/actor）；健康检查；指标或可查询状态；超时/重试/资源上限；优雅退出；配置可覆盖。
4. **数据**：SQLite migration 可重复执行、向后兼容；备份/恢复步骤有文档；保留策略。
5. **测试**：`node --test` 全绿；新增代码覆盖率有基本保障（关键分支有测试）；测试不依赖真实网络/真实凭证/用户机器状态。
6. **文档**：`README`/`docs`/OpenAPI（如适用）/运行手册/回滚步骤；变更写 CHANGELOG。
7. **可审查**：提交粒度清晰；`git diff` 自查；无 `TODO/FIXME` 留在"已完成"的交付路径（可留 issue 记录）。
8. **可回滚**：部署/安装类改动有备份与回滚脚本或明确步骤。

**任何一项未过，就不能把该交付项标为完成；只能标 READY FOR REVIEW 或 BLOCKED。**

## 3. 推进顺序（不跳级）

严格按 `PLAN-A.md` 的 M0 → M1 → M2 → M3 → M4 → M5 → M6 顺序推进；每个里程碑的验收项全部闭合后才进入下一个。
今晚时间到了就停在**最后一个全绿的里程碑**，不要为了"看起来进度多"而跳过门禁。

### M0 工程基线（必须先闭合）
- 根 `package.json` + `package-lock.json` + `.nvmrc` + `engines.node>=24`；
- CI（windows-latest）跑 install/test/check，作为后续所有改动的门禁；
- `packages/config` 路径层（FACTORY_ROOT/FACTORY_DATA_ROOT/DSH profile/tools），清理新增代码硬编码；
- 文档同步（12 插件、6 修复、A 定位、安装/回滚）；
- **验收**：干净克隆可复现；21 测试绿；`grep` 新增代码无 `D:/www`。

### M1 安装器与 DSH 自动配置（生产级）
- 幂等安装：检测 Node/端口/Playwright/DSH；备份 patch 与 skills；失败自动回滚；`--check/--repair/--uninstall`；
- 不破坏现有 12 个服务与用户 DSH 会话；安装/卸载有完整日志；
- **验收**：干净环境模拟测试（可用临时目录/临时 profile 代替真实 DSH）；回滚演练。

### M2 控制面（生产级）
- `apps/control-plane`：Fastify 8780 + SQLite（WAL、migration、备份）；token 鉴权；请求/状态/审计；
- 输入校验、错误模型、结构化日志、health、优雅退出、并发/幂等；
- 集成测试 ≥15 例（含 401/403/非法输入/重复提交/重启恢复）。

### M3 生成流水线（生产级）
- 需求卡校验 → probe 适配器 → 模板生成 → contract/smoke 校验 → staging 任务与报告；
- 失败语义完整（缺凭证/接口变/空数据/登录过期）；证据包落盘；
- golden tickets 至少 API + file 两类型；**禁止 AI 编造字段**。

### M4–M6
按 PLAN-A 执行；每个里程碑同样过 §2 门禁。

## 4. 明确禁止的"偷工减料"

- 用 `stub/return {ok:true}/TODO` 冒充实现；
- 只写 happy path，不写异常/权限/边界测试；
- 把"未验证"写成"通过"、把"部分完成"写成"完成"；
- 关闭/跳过校验、鉴权、审计、测试来换进度；
- 用真实业务数据/凭证做开发测试；
- 把 MVP/演示版说成生产级；
- 为了赶进度一次性大提交、无法审查。

## 5. 时间与提交策略

- 每 45–60 分钟：跑测试 → 自查门禁 → 小步 commit（conventional commits）；
- 每闭合一个里程碑：跑一次全量验证，写 `STATUS-A.md` 更新，打内部 tag（如 `a-m0`）；
- 分支：`feat/prod-a`；只有在全部门禁绿时才合并 `main` 并 push；否则 push 分支并说明。
- 上下文/时间耗尽：停在全绿状态，`STATUS-A.md` 写清 0/25/50/75/100% 完成度（按验收项），并列出下一步。

## 6. 最终交付物（明早可验收）

1. `STATUS-A.md`：按里程碑列验收项、完成度、证据、BLOCKED 原因、下一步；**必须诚实**。
2. `QUALITY-GATES-A.md`：门禁清单与逐项证据。
3. `DECISIONS-A.md`：技术决策与假设。
4. Git：commit/tag/branch/push 记录；不绿不合并。
5. 对话最终汇报：完成了什么、没完成什么、如何验证、风险与回滚。**不要声称"生产级已完成"，除非所有门禁真的绿——即使绿，也需人工签收。**

## 7. 停手条件

- 基线不绿 30 分钟无法修复 → 停，写 BLOCKED。
- 依赖/网络/权限阻断 → 记录并转非阻断项，不得用不安全替代方案。
- 任何可能影响用户现有服务/DSH 会话的操作 → 备份后默认不做。
- 时间耗尽 → 停在全绿，写 STATUS，push。

---

**现在开始：先读文件 + 跑基线 + 建 `QUALITY-GATES-A.md`，然后严格按 M0 → M1 → M2… 推进。**
