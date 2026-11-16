# 49 — MCP Bundle POC（git-flow-audit）

> 目标：验证“标准 MCP bundle”能否替代工厂自定义 installer patch，只做 POC，默认流程不变。

## 1. 做法

- 用 `scripts/export-mcp-bundle.cjs` 把已安装插件导出为标准配置型 bundle：
  - `package.json`（`dsh.bundle.patch`）
  - `cordis.patch.yml`（插入 `@deepseek-ai/dsh-mcp-client`）
  - `locale/en.json`、`docs/DETAIL.md`、`icon.svg`
- bundle 使用**唯一 serverName** `git-flow-audit-bundle`，避免与现有 `git-flow-audit` 冲突。
- 用 DSH `plugin_manager install_bundle` 安装，不用 `installer` patch。

## 2. 过程中发现的两个真实问题

1. **服务未启动**：bundle 安装时 `git-flow-audit` 服务是 DOWN，MCP 连接失败。
2. **根依赖缺 `xlsx`**：MCP 壳启动时 `require('xlsx')` 失败，导致 `Connection closed`；原来只有部分旧部署目录带 `xlsx`。
   - 已在工厂根 `package.json` 增加 `xlsx@0.18.5`，保证所有 MCP 壳能启动。
   - `xlsx` 较旧，后续建议 MCP 壳改用 `exceljs`（已用于 Excel 动作插件）。

## 3. 成功验证

```text
服务启动
→ plugin_manager install_bundle
→ bundle row mcp-git-flow-audit-bundle
→ set_bundle enabled:false/true
→ application: applied
→ 出现 mcp__git-flow-audit-bundle__* 工具
→ submit_task taskType=git_flow_audit
→ job succeeded
→ 产物：git_flow_audit_dataset.json
```

- bundle 工具：`mcp__git-flow-audit-bundle__submit_task` 等
- 任务：`20261116024704-4045`，状态 `succeeded`
- 产物：`plugins/git-flow-audit/service/data/jobs/20261116024704-4045/git_flow_audit_dataset.json`

## 4. POC 后已清理

- 卸载 bundle（`remove_bundle`），profile package 依赖已移除。
- 删除生成的 `bundles/git-flow-audit-mcp-bundle`（含临时 token）。
- 默认 installer patch/30 插件流程保持不变。

## 5. 结论

- **MCP bundle 注册机制可用**，可作为 DSH 标准安装层。
- **但它只解决“注册”**：服务启动、skill 安装、凭证、依赖仍需工厂负责。
- 双注册会重复工具，迁移必须二选一。
- 完整标准化下一步：
  1. `--target mcp-bundle` 按插件生成 bundle（唯一 serverName）
  2. 安装时自动启动服务、安装 skill
  3. 移除旧 patch 中同插件条目
  4. 再做 Host 插件/生命周期打包

## 6. 复现

```powershell
node scripts/export-mcp-bundle.cjs --id git-flow-audit --server-name git-flow-audit-bundle
# 用 DSH Plugins / plugin_manager install_bundle 安装；POC 后 remove_bundle
```
