# 56 — Portable 导出验收

## 命令

```powershell
node scripts/export-plugin.cjs --id excel-status-mark --out dist
```

产物：

```text
dist/local-excel-status-mark-portable/       # 解压/检查用目录
dist/excel-status-mark-0.1.0.zip             # 上传 GitHub Release
dist/excel-status-mark-0.1.0.zip.sha256      # 校验
dist/excel-status-mark-0.1.0.scan.json       # 禁止项扫描
```

## 结果

| 项 | 结果 |
|---|---|
| zip 大小 | 10,441,905 bytes（含 vendored exceljs） |
| sha256 | `a527a368c1cf7b8cb1ef903552bed6d6fd4234fb038e3a2805b4d38828a63adb` |
| 扫描 | ✅ 0 findings |
| 内容 | package.json, cordis.patch.yml, index.js, lib, skills, README, LICENSE, locale, docs, icon, node_modules |

## 安装

别人下载 zip 后：

```text
解压
DSH Plugins → Add plugin → 选择解压目录
```

或：

```text
plugin_manager install_bundle <解压目录>
```

## 扫描规则

导出时禁止：

- `FACTORY_ROOT`
- `serviceToken`
- `DPAPI`
- Windows 绝对路径 `C:\` / `D:\`
- `.enc`

## 当前限制

- 包名仍是 `@local/...`，`private:true`；GitHub 本地安装可以，npm 发布前要改成公开包名（Task 8）。
- `skills/` 随包，但 DSH 的 MCP/Host bundle 不会自动注册 skill；需要后续 Host skill 装载或 README 手动步骤。
- 干净 DSH profile 安装还需验收（Task 7）。
