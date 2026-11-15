# 35 — 真实 DSH UAT 执行记录（2026-11-15）

> 分支：`feat/prod-a-m4`（`284ce20`）；真实 profile：`desktop`；执行人：AI（owner 授权“剩下的你帮我做”）。
> 结论：**安装→MCP→pipeline→accept→install→插件任务→回滚** 全部走通；回滚后原状恢复（patch 哈希一致、12 服务恢复）。
> 唯一未做：在 DSH UI 里人工点击工具（当前会话在安装前启动）；MCP 已用 SDK 客户端验证。

## 1. 执行结果

| 步骤 | 结果 | 证据 |
|---|---|---|
| 安装器 check | 通过（error 0/warn 0） | 12 manifest、端口空闲、依赖 OK |
| 安装器 install | 成功 | 备份 `data/installer/backups/2026-11-15T03-00-18-916Z` |
| patch 注入 | factory-control 1 条 + 12 业务 MCP | 共 13 条 `- id: mcp-` |
| MCP 工具列表（SDK） | 9 个工具可见 | accept/create/get/list/run_step/write_runner/... |
| 需求单 | `req_20261115030045_5cf633` 首次失败（fixture BOM）；修正后 `req_20261115030055_1933c5` 成功 | 见 §2 |
| pipeline | probe/generate/validate/staging 全 succeeded | `data/generator/runs/req_.../pipeline.json` |
| 报告 | `uat-demo-report.html` 生成（4.9 KB） | staging report 目录 |
| accept（MCP） | state `accept` | acceptedBy=owner-UAT |
| 插件安装 | smoke 通过（health/401/200） | `plugins/uat-demo` 等 |
| 插件真实任务 | job `done`，dataset 2 行 | `plugins/uat-demo/service/data/jobs/...` |
| patch 含插件 | `serverName: uat-demo` 1 条 | repair 后 13 条 MCP |
| 回滚 | plugin uninstall + installer uninstall | 插件/manifest 移除 |
| 原状核对 | patch 6502 bytes / SHA256 `9CF6...F22C`（与安装前一致） | 12 manifest、无 uat-demo |
| 服务恢复 | 12/12 UP；doctor 全绿（warn 1 legacy） | 见 §3 |

## 2. 过程中发现的问题（已处理）

1. **PowerShell 执行策略**禁止运行 `setup.ps1` → 改用等价入口 `node apps/installer/installer.cjs`。
2. **fixture BOM**：PowerShell `Set-Content -Encoding utf8`（PS5.1）写入 BOM，probe JSON 解析失败。改用 Node 写无 BOM JSON 后成功；已定位为测试数据问题，不是生成器缺陷。
3. **回滚后 12 服务全 DOWN**：与 rollback 无关——owner 重开 DSH 结束了此前由旧会话拉起的 node 服务。已用 `factory up <id>` 全部恢复（12/12 UP，doctor 全绿）。

## 3. 回滚后环境

- `D:\www\dshskills` junction 完好；deployment 完好。
- `platform/manifests` 12 个；`plugins/uat-demo`、`deployment/tools/uat-demo-mcp`、`deployment/skills/uat-demo` 均已移除。
- 控制面已停止（8780 DOWN）。
- UAT 证据保留在 `data/uat/` 与 `data/generator/runs/req_20261115030055_1933c5/`（gitignored）。

## 4. 未完成 / 说明

- **DSH UI 工具点击**未做：当前 DSH 会话在安装前启动；patch 已含工具、MCP SDK 已验证。若需 UI 验证：重新安装后重开 DSH，确认 `factory-control`/`uat-demo` 工具并调用一次。
- 插件 `uat-demo` 是 fixture 样板，不是真实业务实现；已回滚，不留生产插件。
- 签名未做；发布包仍只有 SHA-256。
