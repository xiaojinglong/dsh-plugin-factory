# PLAN-A · 单机版插件工厂（DSH Plugin Factory A）

> 本文件是 A 项目的**唯一开发入口**。新会话请先读：`HANDOFF.md` → `PLAN-A.md` → `docs/23-复杂场景插件与可靠性改进.md` → `docs/25-A+B双形态架构.md`。
> 基线：**v3.2.0**（2026-11-14）。仓库：`D:\www\dsh-plugin-factory`（GitHub: `xiaojinglong/dsh-plugin-factory`）。
> **今夜压缩冲刺**：完整计划约 6 周；若用户要求提前交付，按 `PROMPT-A.md` 的"今夜 MVP"范围执行（可运行最小切片 + 证据 + 推送），其余继续按本计划推进。
> 与 B 的关系：B 是本仓库的副本（`D:\www\dsh-plugin-factory-bc`，端口 889x、profile `desktop-bc`、`dshskills-bc`），**A 是共享内核的上游**；两仓库独立提交，不要跨仓库直接改文件。

---

## 0. 当前基线（开工前先验证）

```powershell
cd D:\www\dsh-plugin-factory\platform\factory
node cli.cjs status          # 12 个插件（8790–8801）应为 UP（若未启动，先按需 up）
node cli.cjs doctor --health # 应"全部通过（warn 1：concise-analysis legacy）"
node cli.cjs test            # 应 21/21 通过
```

已有资产：共享 runtime（SQLite 任务引擎/鉴权/写四闸/指标/日志）、manifest 单一事实源、`cli.cjs` 统一命令、12 个真实插件（4 类执行层）、21 个测试、report-kit、MCP 薄壳、DSH 热加载实测可用。
本轮已修复（勿回退）：鉴权注入、dry_run 幂等/额度、幂等优先于额度、render 注释幂等、doctor 深度检查。

---

## 1. 产品定义

**一句话**：下载安装包后，业务人员在 DSH 会话里描述业务流程，工厂自动完成"勘探 → 生成 → 测试 → 安装"，直接得到一个可运行、带 8 节报告的插件。

| 项 | 定义 |
|---|---|
| 目标用户 | 1–3 人小团队的业务/运营（自己有权拿到数据源凭证） |
| 输入 | 业务流程描述（数据源、步骤、规则、输出、凭证/登录态） |
| 输出 | DSH 插件：service + MCP + SKILL + HTML 报告 + 测试证据 |
| 北极星指标 | 干净 Windows 11 机器：安装成功率 ≥95%；首个插件从描述到 staging 报告 ≤30 分钟；人工介入 ≤1 次；生成失败 100% 可解释 |
| 非目标 | 账号体系、多用户、审批流、多租户、计费/SaaS（这些属于 B） |
| 边界 | 单机、单用户；凭证与数据留在本机（DPAPI） |

**A 的"能用"标准**：用户不需要打开终端、不需要改任何配置文件；出问题能看到"哪一步、为什么、怎么修"。

---

## 2. 现状与差距

| 已有 | 缺失（本计划要补） |
|---|---|
| 插件执行内核（runtime/manifest/CLI） | 一键安装器 + 依赖/Playwright 自动准备 |
| 12 个可参考插件、4 类执行层 | 本地控制面（请求/状态机/审计） |
| 报告 8 节与空数据守卫 | factory-agent Skill + factory-control MCP |
| 21 个测试、doctor/smoke | 生成流水线（需求卡→勘探→生成→校验→staging） |
| DSH 热加载（本会话实测） | 热加载失败兜底、安装/升级/卸载 |
| 文档与 SOP | 路径配置化（99 个文件硬编码 `D:/www/...`）、`package.json`/锁文件 |
| — | 分发与版本升级、许可证与开源治理 |

---

## 3. 目标架构（单机）

```
DSH 会话
 ├─ factory-agent Skill（SOP/话术/门禁，不含业务逻辑）
 └─ factory-control MCP（stdio 薄壳）──HTTP──┐
                                            ▼
                         Local Control Plane（Fastify 127.0.0.1:8780，SQLite state.db）
                          ├─ 需求单/状态机/审计
                          ├─ 生成流水线（probe → generate → validate → staging）
                          ├─ 本地 Registry / artifact store / evidence
                          └─ install / upgrade / rollback / uninstall
                                            │
                          Plugin runtime（8790–8801，现有 shared runtime）
                                            │
                          DSH profile（MCP patch + skills junction，可热加载）
```

### 3.1 关键决策

1. **单进程控制面**：`apps/control-plane`（Fastify + SQLite），不引入队列中间件；生成任务用现有 job 模式串行执行。
2. **控制面固定端口 8780**；插件继续用 8790+；DSH MCP 通过本地 token（安装时随机生成）访问控制面。
3. **数据根与代码根分离**：`FACTORY_ROOT`（代码）/`FACTORY_DATA_ROOT`（默认 `%LOCALAPPDATA%\dsh-plugin-factory`，存 state.db/artifacts/logs/插件运行数据）；DSH 配置仍写用户 profile。
4. **先 JS 不重写 TS**：A 以尽快可用为目标；SDK 用 JSDoc + JSON Schema 校验。
5. **生成器是代码 + 模板**：AI 只做编排和填业务参数；模板、schema、测试、报告骨架都在仓库里可版本化。

### 3.2 建议目录（在本仓库内演进）

```
packages/
  config/       路径/环境/平台适配（DPAPI、DSH profile、junction）
  sdk/          definePlugin + plugin.json schema + 测试工具
  control-plane/需求单/状态机/审计/registry/artifact store
  cli/          new/install/doctor/test/smoke/upgrade/rollback/uninstall
  runtime/      现有 platform/runtime（迁移为包）
  report-kit/   现有 factory-kit
apps/
  installer/    setup.ps1 + 打包脚本（后续 MSI）
templates/plugin/  新插件脚手架
plugins/        现有 12 个插件（业务插件保持可运行）
docs/           现有文档 + PLAN-A
```

---

## 4. 核心契约（先定，避免返工）

### 4.1 `plugin.json`（每插件一份，manifest 的超集）

```jsonc
{
  "id": "stock-alert",
  "version": "3.0.0",
  "runtimeRange": "^3.2",
  "type": "api",                    // api | browser | file
  "name": "缺货预警",
  "owner": "chenxiongde",
  "paramsSchema": { "type": "object", "properties": {} },
  "outputSchema": { "type": "object" },
  "permissions": { "network": ["api.giikin.com"], "write": false, "browser": false },
  "service": { "entry": "server.js", "runner": "fetcher.js" },
  "mcp": {}, "skill": {}, "report": {}
}
```

### 4.2 需求单状态机

```
draft → submitted → probing → generated → validated → staging → accepted → installed
           │            │           │           │          │
           └────────────┴───────────┴───────────┴──────────┴──→ failed（带可读原因 + 修复建议）
```

### 4.3 控制面 API（本地，token 鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/requests` | 创建需求单（业务描述 + 参数） |
| GET | `/requests/:id` | 状态/待回答的问题/证据 |
| POST | `/requests/:id/probe` | 执行勘探（api/browser/file 适配器） |
| POST | `/requests/:id/generate` | 模板生成插件包 + diff |
| POST | `/requests/:id/validate` | 契约 + smoke + 报告空数据守卫 |
| POST | `/requests/:id/staging` | 安装到 staging 并跑样例，产出报告 |
| POST | `/requests/:id/accept` | 业务确认口径 |
| POST | `/requests/:id/install` | 安装到 DSH（热加载 + 失败兜底） |
| GET | `/plugins`、`/plugins/:id` | 本地目录/健康/版本 |
| POST | `/plugins/:id/rollback`、`/uninstall` | 回滚/卸载 |
| GET | `/jobs/:id`、`/audit` | 证据与审计 |

### 4.4 证据包（每次生成必须落盘）

`probe.json`（接口/字段/枚举/分页实测） · `generation.diff` · `validation.json`（contract+smoke） · `staging/<jobId>/<dataset>` + `report.html` · `acceptance.md`（谁在何时确认了什么） · 运行日志（脱敏）。

---

## 5. 里程碑与任务（单人，AI 辅助；约 6 周）

### M0 工程基线（2 天）

- [ ] 根 `package.json` + `package-lock.json`（`engines.node >=24`，scripts：`test/doctor/render`）；`.nvmrc`。
- [ ] `packages/config`：`resolveRoot()` / `resolveDataRoot()` / platform adapter；清理源码内 `D:/www/...`（保留 SKILL/文档示例可后置）。
- [ ] `.gitignore`（已完成）、LICENSE（建议 Apache-2.0）、CHANGELOG 同步到 v3.2.0。
- [ ] GitHub Actions（windows-latest）：`npm ci` → `node --test` → `node --check` → `doctor`（静态）；secret scan。
- [ ] 更新 HANDOFF/README：12 插件、6 个修复、A 定位。
- **验收**：干净克隆 `npm ci && npm test` 全绿；`grep -r "D:/www/dsh" packages apps` 为 0。

### M1 安装器与 DSH 自动配置（4 天）

- [ ] 分发形态：`zip` + `setup.ps1`（后续 MSI）；检测 Node/PowerShell/端口/Playwright，按需下载 Chromium。
- [ ] DSH 配置：识别 profile（默认 `desktop`），备份 patch，注入 skill junction 与 MCP patch 条目；失败自动回滚。
- [ ] 初始化数据根、生成控制面 token、引导配置数据源凭证（DPAPI）。
- [ ] `factory install --check/--repair/--uninstall`；卸载不残留（保留用户数据需显式 `--purge-data`）。
- **验收**：干净 Win11 机器一条命令安装；DSH 出现 factory-agent 技能与工具；卸载后 profile/服务无残留。

### M2 factory-agent + 控制面骨架（5 天）

- [ ] `apps/control-plane`：SQLite 表（requests/plugins/jobs/audit），API 按 §4.3，token 鉴权。
- [ ] `factory-control` MCP：`create_request / answer / probe / generate / diff / staging / accept / install / list_plugins / rollback`。
- [ ] `factory-agent` SKILL：需求卡 6 要素、≤3 问、门禁话术、失败解释模板；**禁止在 prompt 里写业务逻辑**。
- **验收**：DSH 对话能创建需求单、查看状态、调用 stub 步骤；审计有 actor/时间/参数 hash。

### M3 生成流水线（6 天）

- [ ] 需求卡校验：数据源/凭证/登录态/输出/规则缺项必须显式提问，禁止猜。
- [ ] Probe 适配器：api（HTTP/OpenAPI，先做）、file（目录扫描，先做）、browser（Playwright+storageState，后置）。
- [ ] 模板生成：service/mcp/skill/report/test/sample；`plugin.json` 校验；diff 输出。
- [ ] 自动校验：contract + smoke（mock 夹具）+ 报告空数据守卫 + 无明文凭证扫描。
- [ ] 本地 staging：安装到 staging 端口段，跑样例任务，产出证据包。
- **验收**：3 个 golden ticket（API 盘点类 2 个、文件类 1 个）从描述到 staging 报告全绿。

### M4 验收与安装（4 天）

- [ ] 业务验收：在对话中展示 diff 摘要 + 样例报告 + 覆盖/限制；`accept` 记录确认人。
- [ ] 安装：写入 DSH profile（skills junction + MCP patch）→ 热加载校验 → 失败自动重启 DSH 提示。
- [ ] 一键回滚/卸载；版本 pin。
- **验收**：真实业务人员（非开发）在指导下完成一次"描述→安装→跑一次→拿报告"，全程无终端命令。

### M5 分发与升级（3 天）

- [ ] release 产物 + 版本检查 + 数据迁移；离线安装包；可选代码签名（避免 SmartScreen 拦截）。
- [ ] 升级失败回滚；兼容矩阵（A 版本 ↔ plugin runtimeRange）。
- **验收**：从 v3.2.0 升级到下一版本，插件与数据不丢；升级失败可回滚。

### M6 硬化与试点（5 天）

- [ ] 干净 VM 矩阵（Win10/11）、杀软误报、无网环境、路径含中文/空格。
- [ ] 失败注入：接口 500、空数据、凭证过期、磁盘满、DSH 未启动。
- [ ] 3 个试点用户 + 反馈闭环；埋点只记匿名步骤耗时（可选，默认关闭）。
- **验收**：DoD 全部满足（见 §7）。

---

## 6. 测试与 CI

| 层 | 内容 |
|---|---|
| 单元/契约 | 现有 21 例 + `plugin.json` schema + 状态机 + 证据包完整性 |
| 集成 | 控制面 API（临时 SQLite/随机端口）→ 生成 mock 插件 → 校验 |
| e2e | 干净 Windows runner：安装 → DSH 配置 → 生成 fixture 插件 → smoke → 卸载 |
| 故障注入 | 无网、端口占用、权限不足、DSH 未装、Playwright 下载失败 |
| 发布 | tag → 构建 zip → 安装测试 → Release 附件 |

CI 关键：**安装器必须在干净 runner 上测**，不能只在开发机验证。

---

## 7. 完成定义（DoD）

1. 干净 Win11 机器：一条命令安装成功，失败有可读原因。
2. DSH 会话内完成"描述 → 生成 → 校验 → staging → 验收 → 安装 → 运行 → 报告"。
3. 生成插件必须带：`plugin.json`、8 节报告、SKILL、测试证据、空数据守卫、无明文凭证。
4. 失败路径：接口失败/空数据/凭证缺失/登录过期，都有明确下一步。
5. 热加载失败可兜底（重启 DSH 或提示）；安装/卸载/升级可回滚。
6. 21+ 测试全绿；CI 在干净 Windows runner 通过。
7. 仓库不含凭证/业务数据/`.enc`/cookie；LICENSE/CONTRIBUTING 就位（开源前）。

---

## 8. 与 B 的边界与共享策略

- A 是**共享内核上游**（runtime/sdk/report-kit/config）；B 复制基线后独立演进。
- A 的发布打 tag；B 通过 `sync-from-a` 脚本/子模块拉取共享包，并记录同步 tag。
- 禁止跨仓库直接改文件；共享内核的改动先合 A，再同步 B。
- 本机并行开发时：A 用 `desktop` profile + `dshskills` + 879x；B 用 `desktop-bc` + `dshskills-bc` + 889x（已完成隔离）。

---

## 9. 风险

| 风险 | 对策 |
|---|---|
| Windows 绑定（DPAPI/junction/PowerShell） | platform adapter；A 明确只支持 Windows |
| Playwright 体积/下载失败 | 按需下载 + 镜像/离线包 + 可跳过浏览器插件 |
| DSH 热加载不稳定 | 安装后主动校验 + 重启兜底 + 版本探测 |
| AI 生成质量不稳 | 模板化 + 强制校验 + 证据包 + 失败可解释；设 golden tickets |
| 凭证引导复杂 | 首次安装向导 + 明确"缺凭证时该找谁" |
| SmartScreen 误报 | 代码签名（可选）+ 安装说明 |

---

## 10. 第一批任务（按顺序）

1. 跑基线验证（status/doctor/test），确认 21/21。
2. 建 `package.json` + lock + config 包，清理源码绝对路径（先 `packages/ apps/`）。
3. 写 `plugin.json` JSON Schema + 需求单状态机（纯类型/常量 + 单测）。
4. 搭 `apps/control-plane` 骨架（health + requests CRUD + SQLite + token）。
5. 写 `factory-control` MCP 薄壳 + `factory-agent` SKILL 骨架，先打通"创建需求单"。

> 完成后在 PR/提交说明里贴：`git log -1`、测试输出、改动文件清单。禁止无证据声称完成。
