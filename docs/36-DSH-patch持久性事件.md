# 36 — 事件：DSH 插件管理器重写 patch（2026-11-15）

## 现象

- UAT 后 `factory-control` 与 11 个插件 MCP 已注入 patch（7104 bytes）。
- 11:18 DSH 重开/插件管理器安装 `@deepseek-ai/dsh-subagent-codex` 后：
  - `cordis.patch.yml` 被重写为 **668 bytes**，只剩 UI settings 条目；
  - 11 个插件 MCP + factory-control 全部丢失；
  - 备份 `cordis.patch.yml.bak-1794712701660`（7104 bytes）保留了旧内容；
  - `doctor --health` 报 33 项失败。
- 服务进程不受 patch 影响（但 12 服务因 DSH 重开被杀，另行恢复）。

## 根因

DSH plugin manager / profile 设置写入时会重写 `cordis.patch.yml`，不保留手工注入的 insert 条目。安装器注入本身正确，但**不持久**。

## 处置

```powershell
node apps\installer\installer.cjs repair
```

- 恢复后 patch 6693 bytes，`serverName: factory-control` 1 条，doctor 全绿（warn 1 legacy）。
- 12 服务已恢复；控制面已启动。

## 影响与建议

- 每次 DSH 安装/更新插件、或在设置里触发 profile 重写后，需要重跑 `repair` 并重启 DSH。
- 长期方案（M1 待办）：安装器提供“DSH 启动时自动 repair”的钩子/计划任务，或改用 DSH 支持的持久插件注册机制；不能假设 patch 永久。
- 安装器已有备份：`data/installer/backups/*`；uninstall/rollback 仍可用。
