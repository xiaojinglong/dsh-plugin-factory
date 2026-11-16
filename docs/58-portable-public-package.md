# 58 — Portable 公开包

## 包信息

| 项 | 值 |
|---|---|
| npm 名 | `dsh-plugin-excel-status-mark` |
| 版本 | `0.1.0` |
| license | Apache-2.0 |
| repo | `xiaojinglong/dsh-plugin-factory` / `portable-plugins/excel-status-mark` |
| bundle patch | `cordis.patch.yml` |
| 安装工具 | `excel_status_mark` |

## 验证

- `verify-package.cjs`：通过
- 从导出目录安装：`application: applied`
- 真实调用：6 行、6 行变更
- 测试：新增 `portable-package.test.mjs`

## 发布方式

### GitHub

```powershell
node scripts/export-plugin.cjs --id excel-status-mark --out dist
```

上传：

```
dist/excel-status-mark-0.1.0.zip
dist/excel-status-mark-0.1.0.zip.sha256
```

别人：

```text
解压 → DSH Plugins → Add plugin → 选目录
```

或：

```text
plugin_manager install_bundle <解压目录>
```

### npm（可选）

```powershell
cd portable-plugins/excel-status-mark
npm publish --access public
```

需要 npm 登录；包名 `dsh-plugin-excel-status-mark` 当前未被占用。

## 注意

- zip 含 vendored `node_modules`，约 10MB；npm 包不用 vendoring，依赖由 npm 安装。
- 包名/版本一旦发布不要改；升级用 semver。
- skill 仍随包但未自动注册。
- 真实外部账号/API 插件需要使用者配置。
