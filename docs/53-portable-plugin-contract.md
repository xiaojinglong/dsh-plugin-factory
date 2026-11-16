# Portable Plugin Contract

> 目标：新插件不依赖插件工厂仓库、不依赖本机绝对路径、不依赖工厂 installer，拿到 bundle 即可在 DSH 安装。

## 禁止

- 禁止引用 `FACTORY_ROOT`、`platform/factory`、`plugins/<id>/service/data`
- 禁止写死 `D:\`、`D:/www`、`C:\Users\...` 等本机绝对路径
- 禁止把 token、密码、DPAPI `.enc`、Cookie 写进包
- 禁止依赖 `installer` 修改 `cordis.patch.yml` 才能注册
- 禁止要求目标机器安装插件工厂才能运行

## 必须

- `package.json` 含 `dsh.bundle.patch`
- 运行数据写到 `DSH_PLUGIN_DATA_DIR` 或 `~/.dsh/plugin-data/<id>`
- 凭证从环境变量或 DSH credentials 读取，缺失时给出明确提示
- `package.json` 声明全部运行依赖
- README 写清安装、配置、卸载、限制
- 工具名、参数、输出在干净 DSH profile 中验证

## 产物分层

| 层级 | 说明 | 用途 |
|---|---|---|
| T0 | 现有 `plugins/<id>` + service + installer patch | 旧插件冻结/本地开发 |
| T1 | `portable-host`：DSH 原生 bundle，`apply(ctx)` + `ctx.tools.register(...)`（可用 raw object；不要假设 `@deepseek-ai/dsh-tools` 一定可解析） | 新插件默认（pipeline 默认 target） |
| T2 | `portable-mcp`：自包含 MCP/Host wrapper | 必须独立进程的复杂插件/旧流程显式 `target: "mcp"` |
| T3 | 公开包：npm/GitHub + README/LICENSE/checksum | 任意人下载 |

## 验收

```text
[ ] 无工厂目录的 DSH profile 可安装
[ ] 工具可调用，真实 fixture 通过
[ ] 卸载后工具消失
[ ] 扫描无 token / 绝对路径 / FACTORY_ROOT
[ ] README 说明配置和限制
```
