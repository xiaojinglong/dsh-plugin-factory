# STATUS-A — 生产级冲刺交付状态（A 单机版）

> 更新时间：2026-11-15 08:1x（Asia/Shanghai）
> 分支：`main` = M0（`7aad188`，22 测试）；`feat/prod-a-m1` = M1 部分（28）；`feat/prod-a-m2` = M2 代码完成（44）；`feat/prod-a-m3` = M3 流水线（58，**未合并 main**）；`feat/prod-a-m4` = M4/M5/M6（68，**未合并 main**）
> 结论：**M0 100%；M1 ~60%；M2 ~95%（UAT 待 owner）；M3 ~97%；M4 ~60%；M5 ~25%；M6 ~15%（限流/health 就绪）。** 未完成项不冒充完成。

## 1. 总体完成度（按 PLAN-A 里程碑）

| 里程碑 | 完成度 | 状态 |
|---|---|---|
| M0 工程基线 | **100%** | ✅ 已完成并通过门禁（main） |
| M1 安装器与 DSH 自动配置 | **~60%** | 🟡 核心 + 测试；依赖自动准备/真实干净机验收未闭合 |
| M2 控制面 + factory-agent | **~95%** | ✅ 代码/自动测试完成；仅真实 DSH UAT 待 owner |
| M3 生成流水线 | **~97%** | 🟡 probe/iframe/登录检测/业务 runner/write_runner/生成/校验/staging/报告/编排/沙箱/金标/失败建议已通；DSH 端到端 UAT、自动修复未完成 |
| M4 验收与安装 | **~60%** | 🟡 accept + install/uninstall/rollback/upgrade/verify/render/preflight/兼容性检查已通；真实 DSH 安装/UAT、签名未完成 |
| M5 分发与升级 | **~25%** | 🟡 发布 tarball + SHA-256 + verify + release CI + 策略文档；分发渠道/签名/灰度未完成 |
| M6 硬化与试点 | **~15%** | 🟡 控制面限流/health 就绪已实现；告警/备份恢复演练/容量/试点未完成 |

> 说明：`PLAN-A.md` 完整周期约 6 周；本轮按生产级标准完成 M0，未用 MVP 替代或降低门禁。

## 2. M0 验收项与证据

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 根 `package.json` + `package-lock.json` + `.nvmrc` + `engines>=24` | ✅ | `package.json`（fastify 5.12.8 / playwright 1.65.0）、`package-lock.json`、`.nvmrc`=24 |
| 2 | 干净克隆可复现依赖与测试 | ✅ | 临时目录 `git clone` → `npm ci --ignore-scripts`：`added 50 packages in 5s`，exit 0 |
| 3 | CI 门禁（Windows + Ubuntu） | ✅ 文件就绪 / ⏳ 未在 GitHub 实际跑 | `.github/workflows/ci.yml`（`npm ci` → `npm run check` → `npm test`）；本地等价命令已全部通过。**推送后需 owner 看一次 Actions 结果**。 |
| 4 | `packages/config` 路径层 | ✅ | `packages/config/index.js`：`FACTORY_ROOT`/`FACTORY_DATA_ROOT`/`FACTORY_DSH_*`/`FACTORY_RUN_DIR`；CLI/bootstrap/测试已接入 |
| 5 | manifest 路径可移植 | ✅ | 12 个 manifest 迁移为仓库相对路径；新增契约测试「manifest 路径可移植（禁止绝对路径）」 |
| 6 | 语法门禁 | ✅ | `npm run check`：`checked 158 files, failed 0` |
| 7 | 测试门禁 | ✅ | `npm test`：**22/22 通过**（原 21 + 可移植性 1） |
| 8 | 既有服务/插件不受影响 | ✅ | 12 服务 UP；`doctor --health` 全绿（warn 1 legacy）；`smoke bulk-sync` 通过 |
| 9 | 依赖安全 | ✅ | `npm audit --omit=dev`：`found 0 vulnerabilities` |
| 10 | 文档同步 | ✅ | `HANDOFF.md`/`README.md`/`platform/README.md`/`CHANGELOG.md` 更新到 v3.2 / 12 插件 / 22 测试 |
| 11 | 质量/决策文档 | ✅ | `QUALITY-GATES-A.md`、`DECISIONS-A.md` |

### 2.1 关键命令输出（实测）

```
# 开发机
node cli.cjs test              → tests 22 / pass 22 / fail 0
node cli.cjs doctor --health   → 全部通过（warn 1：concise-analysis legacy）
node cli.cjs status            → 12 个插件全部 UP
node cli.cjs smoke bulk-sync   → 五连通过（首轮 500 → 重试成功）
npm.cmd run check              → checked 158 files, failed 0
npm.cmd audit --omit=dev       → found 0 vulnerabilities

# 干净克隆（%TEMP%\dsh-a-cleanclone）
git clone --branch feat/prod-a ...
npm.cmd ci --ignore-scripts    → added 50 packages in 5s（exit 0）
npm.cmd run check              → checked 158 files, failed 0
npm.cmd test                   → tests 22 / pass 22 / fail 0
```

### 2.2 M1 部分交付（分支 `feat/prod-a-m1`）

| 项 | 结果 | 证据 |
|---|---|---|
| 安装器核心 | ✅ | `apps/installer/installer.cjs`：`check / install / uninstall / rollback / --dry-run` |
| setup.ps1 | ✅ | `apps/installer/setup.ps1`（UTF-8 BOM，测试断言 0xEF 0xBB 0xBF） |
| 备份/回滚 | ✅ | 安装前备份 patch/registry；`uninstall` 恢复原 patch；`rollback` 单测通过 |
| 幂等 | ✅ | 重复 install：patch 条目稳定为 12（11 业务 + factory-control），不重复注入 |
| 不触碰真实 profile | ✅ | 测试全部使用临时 `--dsh-root/--patch/--data-root`；未运行真实 `desktop` |
| 测试 | ✅ | 28/28（新增 6 例：BOM/check/install/幂等/uninstall/dry-run/rollback） |
| 干净克隆 | ✅ | `git clone --branch feat/prod-a-m1` → `npm ci` → 28/28，check 160 文件通过 |
| 真实干净机 DSH 验收 | ⏳ 未做 | 需要真实 `desktop` profile + 热加载/重启兜底/卸载残留检查 |
| 依赖自动准备 | ⏳ 未做 | MCP `node_modules` / Playwright 浏览器 / npm 安装引导 |
| `--repair` / 升级测试 / 打包 | ⏳ 未做 | M1 剩余项 |

### 2.3 M2 部分交付（分支 `feat/prod-a-m2`）

| 项 | 结果 | 证据 |
|---|---|---|
| 控制面 `apps/control-plane` | ✅ | Fastify 8780 + SQLite（migration/WAL）+ token 鉴权 + 需求单状态机 + 步骤证据 + 审计 + 指标 + 备份 |
| 需求单状态机 | ✅ | submitted→probe→generate→validate→staging→accept→installed；跳步/并发/失败语义均有测试 |
| 幂等与审计 | ✅ | `Idempotency-Key` 重放返回同一单；审计含 actor/action/object/前后值/IP |
| factory-control MCP | ✅ | `apps/factory-control-mcp`：7 个工具；SDK Client over stdio 端到端测试通过 |
| factory-agent Skill | ✅ | `skills/factory-agent/SKILL.md`（已复制到 `deployment/skills`，DSH 已热加载可见） |
| 测试 | ✅ | **44/44**（M1 28 + 控制面 14 + MCP 1 + 安装器→patch→MCP→控制面全链路 1）；语法 166 文件通过 |
| 安装器注入 MCP/token | ✅ | installer 注入 `factory-control` managed block（含 `CONTROL_PLANE_TOKEN`），校验/幂等/卸载恢复；全链路测试通过 |
| 真实 DSH UAT | ⏳ 待 owner | 为防止夜间改用户 `desktop` profile，未执行真实安装；安装器已就绪，owner 一键 `setup.ps1 install` 后做会话验收 |
| 生成流水线 | 🟡 M3 进行中 | 见 §2.4 |

### 2.4 M3 垂直切片（分支 `feat/prod-a-m3`）

| 项 | 结果 | 证据 |
|---|---|---|
| SDK 契约 | ✅ | `packages/sdk`：zod `PluginSpecSchema`（id/version/type/taskType/owner/permissions/service/mcp/skill/report），单测覆盖非法 id/taskType/type/多余字段 |
| 插件模板 | ✅ | `templates/plugin/`：service(server/runner/.env) + mcp(index/config/package/smoke) + skill + report + fixture |
| 生成器 | ✅ | `apps/generator`：`generate / validate / staging`；生成 plugin.json+manifest+文件+evidence；默认拒绝覆盖 |
| 结构/语法校验 | ✅ | 生成后 `node --check` 全部文件；schema/端口/SKILL name/fixture 存在性检查 |
| 起服务预演 | ✅ | 生成服务真实启动 → `/health` → `POST /jobs` → done → result → dataset（2 行样本），进程回收 |
| 证据落盘 | ✅ | `evidence/generation.json`、`evidence/validation.json`（检查项/dataset/report/stderr） |
| probe 适配器 | ✅ | `apps/generator/probe.cjs`：fixture + HTTP + 浏览器（Playwright，主页面/iframe 表格、标题、截图）；allowlist、SSRF/私网/DNS rebinding、重定向重校验、1MB 上限、authEnv 不回显 |
| 业务 runner 注入 | ✅ | `apps/generator/business.cjs` + `packages/sdk/runner.cjs`：静态拒绝 child_process/eval/new Function/vm/process.exit；`runnerFile/runnerSource` 注入 → 沙箱 staging 真实执行 |
| write_runner 桥 | ✅ | 控制面 `POST /requests/:id/runner` + MCP `write_runner`：DSH Agent 提交 runner 源码 → 静态校验 → 落盘 → 更新 request.params.runnerFile（仅 submitted 状态） |
| 报告 staging 执行 | ✅ | 生成报告在 staging 真实执行（动态解析 factory-kit/dataset），HTML 非空校验 |
| 控制面编排 | ✅ | `apps/generator/pipeline.cjs`：需求单 → probe → generate（可带业务 runner）→ validate → staging → 报告；失败落 failed + 现场证据 |
| 沙箱执行 | ✅ | `apps/generator/sandbox.cjs`：Node `--permission`（只读仓库/staging、只写 staging）；单测验证外部写被拒绝；生成服务与报告均在沙箱内执行 |
| 金标用例 | ✅ | 订单/库存两类 golden tickets：生成→校验→dataset→报告全绿 |
| 登录态检测 | ✅ | probeBrowser 检测登录跳转/密码框：无 storageState → "需要登录态"；有 storageState 仍登录 → "登录态已过期"；测试覆盖 |
| 失败建议 | ✅ | pipeline 失败写 `failure.json`（step/error/suggestion），step.failed 错误携带建议（登录/凭证/参数/runner/沙箱） |
| 测试 | ✅ | **58/58**（M2 44 + M3 14：SDK/生成器/probe/pipeline/浏览器 iframe/登录/沙箱/金标/业务 runner/write_runner/失败建议） |
| DSH 自动生成业务代码 | ⏳ 未做 | 桥已就绪（write_runner），但"AI 自动产出 runner"仍依赖 DSH 会话流程，未端到端验证 |
| 自动修复 | ⏳ 未做 | 已有 failure.json + 建议；自动重试/自动改代码未实现 |
| 真实业务 API 凭证 | ⏳ 未做 | 允许 allowlist 主机；真实业务凭证需安全流程提供 |

### 2.5 M4 验收/安装（分支 `feat/prod-a-m4`）

| 项 | 结果 | 证据 |
|---|---|---|
| accept 门禁 | ✅ | `POST /requests/:id/accept`：仅 staging、必须 acceptedBy、记录 accept 证据；重复验收 409 |
| 生成插件安装器 | ✅ | `apps/installer/plugin-install.cjs`：install/uninstall/rollback；复制 plugin/MCP/SKILL、写相对 manifest、状态/备份 |
| 安装 smoke | ✅ | health + 无 token 401 + token 200（install 默认执行；测试用 --no-smoke） |
| 覆盖回滚 | ✅ | `--force` 旧目录备份；uninstall 恢复旧目录与旧 manifest |
| 升级/审计 | ✅ | `upgrade`（只允许更高版本，--force 降级）、`list`、`verify`、`--render`（调用工厂 render，失败回滚） |
| 预检/干跑 | ✅ | `preflight`/`check` + `install --dry-run`：零写入发现冲突 |
| 兼容性检查 | ✅ | `runtimeRange` vs 工厂版本；不兼容拒绝安装（测试覆盖 ^9.9） |
| 发布包/校验 | ✅ | `scripts/package-release.cjs` + `verify-release.cjs`：tarball + SHA-256 + release.json；敏感路径拦截 |
| 发布 CI/策略 | ✅ | `.github/workflows/release.yml`（tag→测试→打包→校验→artifact）；`docs/26-M5分发与升级.md` |
| 测试 | ✅ | **67/67**（M3 58 + install 7 + accept 1 + release 1） |
| 真实 DSH 安装/UAT | ⏳ 未做 | 需要 owner 真实 profile（安装器 M1 已具备备份/回滚） |
| 签名/分发渠道 | ⏳ 未做 | 需要 owner 签名密钥与分发账号；灰度未实现 |

## 3. 门禁对照（QUALITY-GATES-A）

| 门禁 | M0 适用项 | 结果 |
|---|---|---|
| G1 正确性 | 既有 22 测试 + 新增可移植性测试 | ✅ |
| G2 安全 | 无凭证入库；`git diff --cached` 敏感文件 0；audit 0 | ✅ |
| G3 可运维 | 配置可覆盖、路径可移植；控制面指标/日志属 M2 | ✅（M0 范围） |
| G5 测试 | 22/22；干净克隆可重复 | ✅ |
| G6 文档 | README/HANDOFF/CHANGELOG/QUALITY/DECISIONS 更新 | ✅ |
| G7 可审查 | 小步提交、diff 自查、无断言之类 stub | ✅ |
| G4 数据 / G8 回滚 | M0 不涉及；M1 备份/回滚已单测；M2 SQLite migration/WAL/备份已测 | ✅（M1/M2 部分） |
| M2 补充 | G1（14 集成测试）/ G2（token、校验、审计、无 token 泄漏）/ G3（health/metrics/日志/优雅退出）/ G4（migration/备份） | ✅ |
| M3 补充 | G1（probe/浏览器+iframe/登录/生成/pipeline/沙箱/金标/业务 runner/write_runner/失败建议测试）/ G2（allowlist+SSRF+凭证不回显；Node 权限沙箱拒写外部；runner 静态禁止项）/ G5（58/58）/ G6（生成证据） | ✅（fixture/本机范围） |

## 4. 未完成 / BLOCKED（诚实清单）

| 项 | 状态 | 原因 / 下一步 |
|---|---|---|
| M1 安装器 + DSH 自动配置 | 🟡 部分（~60%） | 核心 + 测试已完成；剩余：依赖自动准备、真实干净机 DSH 验收、`--repair`/升级测试、打包签名 |
| M2 本地控制面 + factory-agent | ✅ 代码完成（~95%） | 安装器注入/全链路测试已完成；仅真实 DSH UAT 待 owner 一键执行 |
| M3 生成流水线 | 🟡 ~97% | probe/iframe/登录检测/业务 runner+write_runner/生成/校验/staging/报告/编排/沙箱/金标/失败建议已通；DSH 端到端 UAT、自动修复未完成 |
| M4 验收/安装 | 🟡 ~60% | accept + install/uninstall/rollback/upgrade/list/verify/render/preflight/兼容性已通；真实 DSH 安装/UAT、签名未完成 |
| M5 分发与升级 | 🟡 ~25% | 发布 tarball + SHA-256 + verify + release CI + 策略文档；分发渠道/签名/灰度未完成 |
| M6 硬化与试点 | 🟡 ~15% | 限流/health 就绪已实现；告警/备份恢复演练/容量/试点未完成 |
| LICENSE | 🚫 BLOCKED-PENDING-OWNER | 许可证属所有者法律决策，AI 不擅自选择；建议 Apache-2.0 |
| GitHub Actions 实跑 | ⏳ 待验证 | 代码已推送后由 owner 看一眼 CI 结果；本地等价命令已通过 |
| 遗留绝对路径脚本 | ⚠️ 已知 | `platform/factory/legacy/*`、`patch-*.mjs`、`plugins/*/probe`、`deploy-*` 为一次性历史脚本，不在产品路径；M1 清理（见 DECISIONS D8） |

## 5. 风险与回滚

- **路径迁移回滚**：`git revert <commit>` 或 `git checkout <baseline> -- platform/manifests platform/factory packages/config`；相对路径迁移有 `scripts/migrate-manifests.mjs`（仅前向）。
- **运行中服务**：本轮未重启 12 个服务；新代码在下次 `factory up` 时生效（bootstrap 已支持相对 manifest）。如需立即验证，可对单个服务 `down/up`。
- **未改用户 DSH profile**：`~/.dsh/profiles/desktop` 未动；M2 全链路用临时 profile 验证。真实安装/热加载 UAT 由 owner 执行 `apps/installer/setup.ps1 install`（自动备份，可 `uninstall/rollback`）。
- **生成插件安装**：`plugin-install.cjs` 默认 smoke；`--force` 会备份旧目录/manifest，uninstall 可恢复；真实安装前必须有 accept 记录。
- **GitHub Actions**：推送后需确认两个 OS 的 CI 结果（依赖网络与 runner Node 24）。

## 6. 下一步（按 PLAN-A）

1. **M2 UAT（owner）**：真实 DSH 会话执行 `setup.ps1 install` → 确认 `factory-control` 工具出现 → 创建需求单 → 回滚/卸载验收。
2. **M3 收尾**：DSH 端到端验证（write_runner → pipeline）、自动修复/重试、真实业务凭证安全接入。
3. **M4 收尾**：真实 install（owner profile/UAT）、签名（owner 密钥）、安装 smoke 扩展。
4. **M5 收尾**：分发渠道/升级策略、兼容性矩阵、release 校验。
5. **M1 收尾**：依赖自动准备、真实干净机 DSH 安装、`--repair`、打包/签名。
6. **M6**：备份恢复演练、告警、容量/保留策略、试点（见 `docs/27-M6硬化与试点.md`）。
7. M1/M2/M3/M4/M5/M6 闭合前保持分支，不合并 main；M0 仍是可回滚稳定基线。
