# A 本地控制面（apps/control-plane）

> 状态：M2 核心实现（需求单状态机 / 审计 / 插件目录 / 指标 / 备份 + 集成测试）。
> 未完成：factory-control MCP 薄壳、factory-agent Skill、真实生成流水线接入（见 STATUS-A）。

## 启动

```powershell
# 初始化 token（数据根下 control-plane/token；不入库/不入仓库）
node apps/control-plane/server.cjs --init

# 启动（默认 127.0.0.1:8780）
node apps/control-plane/server.cjs
# 或
npm run control-plane

# 自定义端口/数据根
node apps/control-plane/server.cjs --port 8780 --data-root D:\data\dsh-factory
```

Token 文件：`<data-root>/control-plane/token`（默认 `<repo>/data/control-plane/token`，Windows 下 ACL 由用户目录保护；禁止提交）。

## API

所有接口除 `/health` 外都需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活/就绪（无鉴权；含 `checks.db`，DB 异常 503） |
| GET | `/metrics` | 请求/审计统计 |
| GET | `/plugins` | 插件目录（不含 token/路径） |
| POST | `/requests` | 创建需求单 `{brief, params?}`；可选 `Idempotency-Key` header |
| GET | `/requests?state=&limit=` | 列表 |
| GET | `/requests/:id` | 详情（含步骤） |
| GET | `/requests/:id/audit` | 该需求单审计 |
| POST | `/requests/:id/runner` | `{source}`：静态校验业务 runner → 落盘 `<data-root>/generator/runs/<id>/runner.js` → 更新 `params.runnerFile`（仅 submitted） |
| POST | `/requests/:id/steps` | `{step,status,evidence?,error?}`，step∈probe/generate/validate/staging/accept/install/note，status∈running/succeeded/failed |
| GET | `/audit?limit=` | 全局审计 |
| POST | `/admin/backup` | `{fileName?}` → `VACUUM INTO` 备份到 `control-plane/backups/` |
| POST | `/admin/prune` | `{olderThanDays?, dryRun}` 审计保留清理（默认 dry-run） |

错误统一：`{ error: { code, message, requestId } }`；401/403/404/409/400。
POST 默认限流 120 次/分钟/IP（`CONTROL_PLANE_RATE_LIMIT` 可调），超限 429 + `Retry-After`。

恢复（需先停控制面）：`node apps/control-plane/restore.cjs --backup <backup.db> --data-root <dir>`；当前库保留为 `.before-restore-<ts>`。

## 状态机

```
submitted → probe → generate → validate → staging → accept → installed
                     └────────────── failed（任一步失败即终态）
```

- `running`：要求前序状态匹配且无并发步骤；
- `succeeded`：要求该步骤已 running，推进状态；
- `failed`：必须提供 error，进入终态；
- `note`：允许任意时刻记录证据，不改变状态。

## 备份与恢复

```powershell
# 备份（服务运行中也可）
curl -X POST http://127.0.0.1:8780/admin/backup -H "Authorization: Bearer $token" -H "content-type: application/json" -d "{\"fileName\":\"before-upgrade.db\"}"

# 恢复：停服务 → 用备份覆盖 <data-root>/control-plane/state.db（同时删除 state.db-wal/state.db-shm）→ 启动
```

## 安全边界

- 只监听 `127.0.0.1`；token 不入库、不入日志、不入仓库；
- 审计记录 actor/action/object/前后值/IP/时间；日志 JSON 5MB 轮转；
- 输入长度/类型校验；bodyLimit 256KB；备份文件名白名单；
- 不执行 AI 生成代码（生成流水线属 M3，需沙箱设计）。

## 测试

```powershell
npm test   # platform/tests/control-plane.test.mjs（与全量测试一起跑）
```
