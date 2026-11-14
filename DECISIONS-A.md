# DECISIONS-A — 技术决策与假设（A 单机版生产化）

> 记录本轮生产级冲刺中拍板的决策；后续变更需在此追加，不覆盖历史。

## D1 路径配置层（packages/config）

- 一律通过 `packages/config` 解析：`FACTORY_ROOT`、`FACTORY_DATA_ROOT`、`FACTORY_DSH_PROFILE`、`FACTORY_DSH_PATCH`、`FACTORY_DSH_TOOLS`、`FACTORY_DSH_SKILLS`、`FACTORY_DSH_REGISTRY`、`FACTORY_RUN_DIR`。
- `FACTORY_ROOT` 缺省由 `packages/config/index.js` 相对位置推导，不依赖 cwd；因此仓库可克隆到任意路径。
- 旧绝对路径由 `resolveManifest()` 兼容映射（仅作为迁移期兜底）；新代码不得再写死 `D:/www/...`。

## D2 manifest 改为仓库相对路径

- `service.dir`、`service.dataDir`、`mcp.dir`、`skill.dir`、`report.*` 全部改为相对仓库根（e.g. `plugins/shop-list/service`、`deployment/tools/shop-list-mcp`）。
- CLI 内区分 `rawManifests()`（保持相对路径，用于渲染 patch/registry）与 `manifests()`（解析为绝对路径，用于运行/校验）。
- 迁移脚本 `scripts/migrate-manifests.mjs` 可重复执行；契约测试新增“manifest 不得含绝对路径”门禁。

## D3 DSH 路径回退策略

- 默认优先 `D:/www/dshskills`（当前机器 junction），不存在时回退到仓库内 `deployment/tools|skills`，保证干净克隆/CI 可用；生产安装器将显式设置 `FACTORY_DSH_*`。
- 未改动用户当前 `~/.dsh/profiles/desktop`：本轮只做 stdio/HTTP 验证，避免夜间破坏用户会话。安装器（M1）会备份 + 可回滚。

## D4 测试中的 patch 校验

- 契约测试在 `DSH patch` 不存在时（CI/干净克隆）**条件跳过**并在测试名中写明原因；在开发机存在 patch 时必须全量校验。
- 这不是“为过测试而跳过功能”：patch 校验在存在 DSH 配置的环境仍强制执行。

## D5 运行时与依赖

- Node 固定 `>=24`（`.nvmrc`=24；`engines.node>=24`）。
- 依赖精确锁定：`fastify@5.12.8`、`playwright@1.65.0`；根 `package-lock.json` 入库。
- CI 设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`（测试不依赖浏览器内核；浏览器插件按需安装）。

## D6 CI

- GitHub Actions 双平台（windows-latest + ubuntu-latest）：`npm ci --ignore-scripts` → `npm run check` → `npm test`。
- 不在 CI 跑 `doctor --health`（需要 DSH profile/端口），避免把环境依赖伪装成代码门禁。

## D7 本轮范围

- 执行 `PLAN-A.md` 的 **M0（工程基线）**；M1–M6 未开始，不冒充完成。
- 未实现安装器/控制面/factory-agent；`STATUS-A.md` 中如实列出。

## D8 遗留绝对路径

- `platform/factory/legacy/*`、`platform/factory/patch-*.mjs`、`plugins/*/probe/*`、`plugins/*/deploy-*.mjs`、`plugins/*/run-course.mjs` 仍含历史绝对路径；这些是**一次性迁移/部署/勘探脚本，不在产品运行路径**，后续 M1 清理或迁移到 `scripts/legacy/`。
- 报告生成器已改为基于 `import.meta.url` 解析插件目录（可移植）；gsmp 浏览器默认 session 路径改为仓库内相对路径。

## D9 许可证

- 仓库尚未添加 LICENSE：许可证是所有者法律决策，AI 不应擅自选择；在 `STATUS-A.md` 标 `BLOCKED-PENDING-OWNER`，建议 Apache-2.0。

## D10 与 B 项目的边界

- 本仓库为 A；B 仓库 `D:\www\dsh-plugin-factory-bc` 未被读写。A 作为共享内核上游，后续 B 按 `docs/sync-log.md` 同步 tag。
