# 36 — 事件：DSH 重写 patch 的根因与修复（2026-11-15）

## 现象

- UAT 后 `factory-control` + 11 个插件 MCP 已注入 patch（7104 bytes）。
- DSH 重开/插件管理器安装 `@deepseek-ai/dsh-subagent-codex` 后，`cordis.patch.yml` 变为 **668 bytes**，只剩 UI settings；`doctor --health` 报 33 项失败。
- 备份 `cordis.patch.yml.bak-1794712701660`（7104 bytes）保留旧内容。

## 根因（已确认）

不是 DSH 主动丢弃，而是 **`factory render` 生成了非法 YAML**：

```yaml
args: ["D:\www\dshskills\tools/listing-list-mcp/index.js"]
cwd: "D:\www\dshskills\tools/listing-list-mcp"
```

双引号内 `\w` / `\d` 是非法转义。PyYAML 报：
`ScannerError: found unknown escape character 'w'`（line 47）。
DSH 解析失败后回退/重置为默认 UI-only patch。

原 patch（迁移前）使用正斜杠 `D:/www/dshskills/...`，所以一直正常；M0 相对路径迁移后 `path.resolve()` 在 Windows 产生反斜杠，回归被漏测。

## 修复

- `platform/factory/cli.cjs` `renderPatch()`：写入 YAML 前统一 `DSH_TOOLS.replace(/\\/g, '/')`。
- 新增回归测试 `platform/tests/render-patch.test.mjs`：断言 YAML 双引号内不得出现 `X:\`，必须是 `X:/`。
- 执行 `installer repair` 后：patch 6693 bytes、PyYAML 解析成功（15 条目）、doctor 全绿（warn 1 legacy）。

## 影响与教训

- 这是 A 项目必须修复的 bug；修好后 DSH 重开不会再因 patch 解析失败而重置。
- 以后改 render/manifest 路径格式必须跑 `render-patch.test.mjs`。
- 安装器备份仍在 `data/installer/backups/*`；uninstall/rollback 可用。
