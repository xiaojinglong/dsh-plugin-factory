# 51 — MCP Bundle P2：bundle-managed 迁移

## 1. 目标

让工厂承认“某插件由 DSH bundle 管理”，从而：

- `render` 不再为它写 `cordis.patch.yml`
- `installer repair` 不再要求它的 patch 条目
- `doctor` 跳过该插件的 patch 校验
- 迁移/回滚有明确命令，不靠手改 patch

## 2. 新增

### marker

```
platform/manifests/.bundles/<id>.json
```

本地状态，已 gitignore；内容记录 bundleName/serverName/managedAt。

### 命令

```powershell
node scripts/bundle-mode.cjs enable  --id <id>
node scripts/bundle-mode.cjs disable --id <id>
node scripts/bundle-mode.cjs status
```

- `enable`：写 marker → installer repair → patch 移除旧 `mcp-<id>`
- `disable`：删 marker → installer repair → patch 恢复旧条目
- 两者都要求 bundle 已安装/卸载由 DSH plugin manager 完成

### 代码

- `platform/factory/cli.cjs`：`bundleManaged()`，render/doctor 跳过
- `apps/installer/installer.cjs`：`verifyPatch` 跳过 marker
- `scripts/bundle-mode.cjs`

## 3. 真实迁移演练

对 `git-flow-audit`：

1. 导出 bundle（serverName `git-flow-audit-bundle`）
2. `plugin_manager install_bundle` → `application: applied`
3. `bundle-mode enable --id git-flow-audit`
4. patch 旧条目移除；doctor 绿；工具为 `mcp__git-flow-audit-bundle__*`
5. 真实 job `20261116031022-297e` → `succeeded`
6. `bundle-mode disable` → patch 恢复旧条目
7. `remove_bundle` → 工具恢复 `mcp__git-flow-audit__*`
8. doctor 绿

## 4. 发现并修复

`installer repair` 最初仍按普通插件要求 patch 条目，导致 marker 后 repair 失败；已在 `verifyPatch` 跳过 bundle-managed 插件。

## 5. 当前边界

- bundle 安装/卸载仍是 DSH plugin_manager 手动操作，工厂 CLI 不能直接调。
- bundle 不启动服务、不安装 skill；这两件事仍需工厂负责。
- marker 丢失/误删会让 repair 重新注入旧 patch，可能和 bundle 重复；`bundle-mode status` 可查。
- 迁移时工具名会从 `<id>` 变成 `<id>-bundle`（serverName 不同）；如果不希望改名，导出时用相同 serverName，但必须先移除旧 patch，窗口期会短暂无工具。

## 6. 下一步 P3

1. bundle 安装编排（DSH 侧接收安装请求）
2. 服务启动 + skill 安装与 bundle 同步
3. 迁移窗口期/失败自动回滚
4. 再评估是否默认切换到 bundle
