# STATUS-A — 生产级冲刺交付状态（A 单机版）

> 更新时间：2026-11-15 00:0x（Asia/Shanghai）
> 分支：`feat/prod-a` · 基线：`7c94915`（本文档提交后另有一笔 docs 提交）
> 结论：**M0 工程基线 100% 完成并通过干净克隆验收；M1–M6 未开始（0%）。** 未完成项不冒充完成。

## 1. 总体完成度（按 PLAN-A 里程碑）

| 里程碑 | 完成度 | 状态 |
|---|---|---|
| M0 工程基线 | **100%** | ✅ 已完成并通过门禁 |
| M1 安装器与 DSH 自动配置 | 0% | ⏸ 未开始 |
| M2 控制面 | 0% | ⏸ 未开始 |
| M3 生成流水线 | 0% | ⏸ 未开始 |
| M4 验收与安装 | 0% | ⏸ 未开始 |
| M5 分发与升级 | 0% | ⏸ 未开始 |
| M6 硬化与试点 | 0% | ⏸ 未开始 |

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

## 3. 门禁对照（QUALITY-GATES-A）

| 门禁 | M0 适用项 | 结果 |
|---|---|---|
| G1 正确性 | 既有 22 测试 + 新增可移植性测试 | ✅ |
| G2 安全 | 无凭证入库；`git diff --cached` 敏感文件 0；audit 0 | ✅ |
| G3 可运维 | 配置可覆盖、路径可移植；控制面指标/日志属 M2 | ✅（M0 范围） |
| G5 测试 | 22/22；干净克隆可重复 | ✅ |
| G6 文档 | README/HANDOFF/CHANGELOG/QUALITY/DECISIONS 更新 | ✅ |
| G7 可审查 | 小步提交、diff 自查、无断言之类 stub | ✅ |
| G4 数据 / G8 回滚 | 本里程碑未涉及数据迁移/安装，不适用 | n/a |

## 4. 未完成 / BLOCKED（诚实清单）

| 项 | 状态 | 原因 / 下一步 |
|---|---|---|
| M1 安装器 + DSH 自动配置 | ⏸ 未开始 | 下一轮按 PLAN-A M1；需要备份 `desktop` profile + 回滚演练 |
| M2 本地控制面 | ⏸ 未开始 | 下一轮；8780 + SQLite + token + 审计 + 测试 |
| M3 生成流水线 | ⏸ 未开始 | 依赖 M2；probe/generate/validate/staging |
| M4–M6 | ⏸ 未开始 | 依赖前序里程碑 |
| LICENSE | 🚫 BLOCKED-PENDING-OWNER | 许可证属所有者法律决策，AI 不擅自选择；建议 Apache-2.0 |
| GitHub Actions 实跑 | ⏳ 待验证 | 代码已推送后由 owner 看一眼 CI 结果；本地等价命令已通过 |
| 遗留绝对路径脚本 | ⚠️ 已知 | `platform/factory/legacy/*`、`patch-*.mjs`、`plugins/*/probe`、`deploy-*` 为一次性历史脚本，不在产品路径；M1 清理（见 DECISIONS D8） |

## 5. 风险与回滚

- **路径迁移回滚**：`git revert <commit>` 或 `git checkout <baseline> -- platform/manifests platform/factory packages/config`；相对路径迁移有 `scripts/migrate-manifests.mjs`（仅前向）。
- **运行中服务**：本轮未重启 12 个服务；新代码在下次 `factory up` 时生效（bootstrap 已支持相对 manifest）。如需立即验证，可对单个服务 `down/up`。
- **未改用户 DSH profile**：`~/.dsh/profiles/desktop` 未动；安装器/热加载属 M1。
- **GitHub Actions**：推送后需确认两个 OS 的 CI 结果（依赖网络与 runner Node 24）。

## 6. 下一步（按 PLAN-A）

1. **M1**：`apps/installer` + `setup.ps1`（`--check/--repair/--uninstall`），备份/回滚 DSH profile，stdio 冒烟验证。
2. **M2**：`apps/control-plane`（8780 + SQLite + token + 审计 + 健壮性测试）。
3. **M3**：生成流水线（probe/generate/validate/staging），golden tickets。
4. M1 起按 `QUALITY-GATES-A` 全量启用 G4/G8。
