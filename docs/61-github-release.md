# 61 — GitHub Release 发布记录

## Release

- Tag：`portable-v0.1.0`
- URL：https://github.com/xiaojinglong/dsh-plugin-factory/releases/tag/portable-v0.1.0
- Commit：`7f2807c`
- 发布内容：`excel-status-mark` portable bundle

## 资产

| 文件 | 大小 | 校验 |
|---|---|---|
| `excel-status-mark-0.1.0.zip` | 10,441,905 | sha256 `a527a368c1cf7b8cb1ef903552bed6d6fd4234fb038e3a2805b4d38828a63adb` |
| `excel-status-mark-0.1.0.zip.sha256` | 94 | 文本 |
| `excel-status-mark-0.1.0.scan.json` | 35 | 禁止项 0 |

API 下载复核：大小/hash 与本地一致。

## 安装

```powershell
# 下载 zip 后
node scripts/dsh-factory.cjs install excel-status-mark-0.1.0.zip --profile desktop
```

或 DSH Plugins → Add plugin 选择解压目录。

## 注意

- 仓库当前不是匿名可下载；浏览器下载需 GitHub 登录（API 带 token 校验通过）。
- npm 发布未执行，需要 npm 登录/scope。
- 30 个旧插件未迁移。
