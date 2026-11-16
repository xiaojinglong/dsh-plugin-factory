# 59 — 一条命令安装验收

## 命令

```powershell
node scripts/dsh-factory.cjs install dist/excel-status-mark-0.1.0.zip --profile desktop
```

也支持目录或 npm/GitHub spec：

```powershell
node scripts/dsh-factory.cjs install <bundle-dir>
node scripts/dsh-factory.cjs install dsh-plugin-excel-status-mark@0.1.0
```

## 流程

1. zip 解压到 `%LOCALAPPDATA%\dsh-factory\bundles\<name>`
2. 校验 `dsh.bundle.patch`
3. 执行 `dsh plugin --profile <profile> add -w <dir>`
4. 执行 `dsh --profile <profile> --dump-config`，确认 bundle 行出现
5. 提示重开 DSH

## 验证结果

| 项 | 结果 |
|---|---|
| 临时 profile | `portable-e2e` |
| 安装 | `dsh plugin add` 成功 |
| `dsh.profile.bundles` | 自动包含 `dsh-plugin-excel-status-mark` |
| `--dump-config` | 命中 `dsh-plugin-excel-status-mark` |
| 当前 desktop profile | 未安装测试包 |

## 重要发现

`dsh plugin --profile ... add -w <dir>` 不只是 pnpm：

- 会初始化/更新 profile
- **会自动把包加入 `dsh.profile.bundles`**
- `--dump-config` 能看到 bundle row

所以“一条命令”可以成立，不需要自定义 installer patch。

## 限制

- 安装后仍需重开 DSH 才生效。
- 依赖本地目录是 link；zip 必须带 vendored `node_modules`（已实现）。
- npm/GitHub spec 需要包已发布/仓库可访问。
- 不启动服务：portable Host 插件本身无服务。
