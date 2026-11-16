# 50 — MCP Bundle P1：批量导出与迁移策略

## 1. 已做

`scripts/export-mcp-bundle.cjs` 支持：

```powershell
# 单插件
node scripts/export-mcp-bundle.cjs --id git-flow-audit --server-name git-flow-audit-bundle

# 全量（生成到 bundles/<id>-mcp-bundle）
node scripts/export-mcp-bundle.cjs --all
```

每个 bundle 包含：

```
package.json          # dsh.bundle.patch
cordis.patch.yml      # @deepseek-ai/dsh-mcp-client
locale/en.json        # 标题/描述/detail
docs/DETAIL.md
icon.svg
```

- 每个 bundle 使用唯一 `serverName`（`<id>-bundle`），避免和现有 patch 的 `<id>` 冲突。
- 全量导出会写 `bundles/catalog.json`。
- `bundles/` 已加入 `.gitignore`：**bundle 的 patch 含 serviceToken，不能提交**。

## 2. POC 验证结论

- `plugin_manager install_bundle` 可安装、可激活、可移除。
- 激活后工具为 `mcp__<serverName>__*`，真实 job 成功。
- bundle 只负责**注册**；服务启动、skill、凭证、依赖仍由工厂负责。
- 同一插件不要同时保留旧 patch 行和 bundle 行，否则会出现重复工具。

## 3. 迁移策略（下一步实现）

单插件迁移顺序：

1. 确认服务运行、token 正确
2. `export-mcp-bundle --id <id>`（唯一 serverName）
3. `plugin_manager install_bundle` / DSH Plugins 安装
4. 验证工具
5. 从 `cordis.patch.yml` 删除旧 `mcp-<id>` 行（或让 render 跳过该插件）
6. 重开 DSH/重新加载，确认只剩一套工具
7. 记录 marker：`platform/manifests/.bundles/<id>.json`

> 第 5 步需要 render/doctor 支持“bundle 管理的插件跳过 patch 注入”，否则 `repair` 会把旧行加回来。这是 P2。

## 4. 当前不建议

- 不建议直接默认切 bundle：factory-control 本身还依赖 installer patch。
- 不建议无 marker 混用：重复工具/重复连接。
- 不建议把 bundle 目录提交仓库：含 token。

## 5. 状态

- 30 个插件、109/109 测试。
- 默认 `plugin-install` 流程不变。
- POC bundle 已卸载；profile 已恢复。
