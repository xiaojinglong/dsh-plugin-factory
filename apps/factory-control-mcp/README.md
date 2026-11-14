# factory-control MCP（apps/factory-control-mcp）

MCP 薄壳：把本地控制面（默认 `http://127.0.0.1:8780`）暴露给 DSH 的 `factory-agent` 技能。

## 工具

| 工具 | 说明 |
|---|---|
| `create_request` | 创建需求单（brief/params/idempotency_key） |
| `get_request` | 查询状态/步骤/证据 |
| `list_requests` | 列表（state/limit） |
| `run_step` | 记录 probe/generate/validate/staging/accept/install/note |
| `write_runner` | 提交业务 runner 源码（静态校验 + 落盘 + 更新 params.runnerFile） |
| `list_plugins` | 插件目录（不含 token） |
| `get_metrics` | 控制面统计 |
| `backup_state` | SQLite 备份 |

## 环境变量

- `CONTROL_PLANE_URL`（默认 `http://127.0.0.1:8780`）
- `CONTROL_PLANE_TOKEN`（必填；来自 `<data-root>/control-plane/token`）

## 手动冒烟

```powershell
# 1) 启动控制面
node apps/control-plane/server.cjs --init
node apps/control-plane/server.cjs

# 2) 用 MCP 客户端/DSH 加载本进程（stdio）
$env:CONTROL_PLANE_URL='http://127.0.0.1:8780'
$env:CONTROL_PLANE_TOKEN=Get-Content .\data\control-plane\token
node apps/factory-control-mcp/index.cjs
```

集成测试见 `platform/tests/factory-control-mcp.test.mjs`（SDK Client over stdio）。

## 未完成

- 尚未由安装器自动注入 DSH patch（避免夜间修改用户 profile）；M2 收尾时由安装器写入 MCP 条目并做热加载验证。
