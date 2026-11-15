# ACCEPTANCE-A — A 单机版交付验收记录

> 分支：`main`（A 工程收口，`c13975f` 起）
> 生成时间：2026-11-15
> 结论：A 工程/自动化交付收口完成；代码签名、分发渠道、真实业务试点为 owner 外部项。**不冒充完成。**

## 1. 验证证据

| 项 | 结果 |
|---|---|
| 测试 | **81/81**（`npm test`） |
| 语法检查 | **193 文件通过**（`npm run check`） |
| 干净克隆 | 待最终 tag 后复跑 |
| 合并预演 | main + M4 自动合并且无冲突（docs/32） |
| 发布包 | 见 §2（SHA-256，最终 tag 后重建） |
| 控制面 | health/限流/备份恢复/prune/巡检/演练测试覆盖 |
| 真实 DSH UAT | **已执行**：安装→MCP 9 工具→pipeline→accept→安装插件→smoke→插件任务→回滚；patch 原状恢复、12 服务恢复（docs/35）。 |
| DSH 工具可用 | **已验证**：本会话内 `factory-control.get_request/list_plugins` 实际调用成功；patch YAML 通过解析（docs/36）。 |
| patch 回归 | 修复 `render` Windows 反斜杠写 YAML 的 bug，新增 `render-patch.test.mjs`。 |

## 2. 发布包

```powershell
npm run release:package -- --out dist
npm run release:verify -- --out dist
```

- 产物：`dist/dsh-plugin-factory-<version>.tgz` + `dist/release.json`
- 打包校验：敏感路径拦截（`.env` 模板除外、secrets、data、db、token）
- **本次包 SHA-256**：`00a4e4d62ef07a94be4d058b32732d800a049d4ed729f8b999910f6998961065`
- **包大小 / 文件数**：427147 bytes / 382 files
- **打包基准 commit**：`816e15c`（`release.json` 为权威；之后仅文档修改）
- 签名：**未做**（需 owner 密钥）；当前只有 SHA-256，不声称已签名。

## 3. Owner 验收步骤（必须）

按 `docs/28-owner-UAT清单.md` 执行：

1. `setup.ps1 check/install` → 确认 `factory-control` 工具出现。
2. 需求单 → `write_runner` → `pipeline` → staging 报告。
3. 业务确认 → `accept_request` → `plugin-install install --render`。
4. `verify/list` → DSH 使用 → **uninstall/setup uninstall/rollback** 回滚一次。
5. `backup/restore`、`health-check`、`pilot-drill` 演练。

## 4. 已知限制（验收时不得误判为通过）

- M2/M3 DSH 端到端 UAT 未做；M3 AI 自动修复 runner 未实现（只有建议 + 瞬态重试）。
- M4 签名、真实 install/UAT 未完成。
- M5 分发渠道/灰度未完成。
- M6 真实试点未开始；告警仅 webhook。
- 沙箱仅 Node 权限模型，无容器级网络隔离。
- 真实业务 API/登录态需 allowlist/凭证/人工扫码。
- LICENSE 待 owner 决策（建议 Apache-2.0）。

## 5. 回滚

- 插件：`plugin-install uninstall --id <id>`（恢复旧目录/manifest）。
- DSH：`setup.ps1 uninstall` / `rollback`（备份在 data/installer/backups）。
- 控制面：`restore.cjs --backup <file> --data-root <dir>`（离线）。
- 代码：main 未合并；`git checkout main` 回 M0；M4 分支可删/重置。
