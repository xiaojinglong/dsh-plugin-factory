# 插件平台 v3（Platform / Shared Runtime）

> 版本 3.2.0 · 2026-11-15
> 目标：把"能生成插件"升级为"能长期运维、可批量、可审计"的平台：
> **单一共享 runtime + 单一事实源 manifest + 一条 CLI + 加密凭证 + 测试门禁 + 可观测性**。
> 路径解析统一使用 `packages/config`（`FACTORY_ROOT` / `FACTORY_DATA_ROOT` / `FACTORY_DSH_*`）；manifest 已迁移为仓库相对路径。

---

## 一、目录

```
D:\www\dsh-plugin-factory\platform\
├── runtime\                    ← 共享运行时（唯一一份）
│   ├── index.js                HTTP 契约 / 任务状态机 / 鉴权 / 写操作治理 / 指标
│   ├── store.js                持久化任务存储（node:sqlite，重启恢复/清理/幂等）
│   ├── runner-api.js           API 型共享执行层（插件只写 TASK 配置）
│   ├── secrets.js              DPAPI 加密凭证（platform/secrets/<id>.enc）
│   ├── dpapi.ps1               DPAPI 加解密（PowerShell 5.1）
│   ├── logger.js               JSON 日志 + 5MB 轮转
│   └── fsutil.js               目录/清理/文件信息
├── factory\
│   ├── cli.cjs                 ★ 统一 CLI（doctor/render/up/down/status/watch/smoke/test/secret/port/clean）
│   ├── bootstrap.js            插件统一启动入口（env + DPAPI → createService）
│   └── migrate.mjs             历史插件迁移脚本（已跑完）
├── manifests\<id>.json         ★ 单一事实源（端口/taskType/serverName/路径/凭证键/写操作）
├── tests\                      node --test（契约 + runtime 集成）
├── secrets\                    DPAPI 加密凭证（仅当前 Windows 用户可解）
└── run\                        服务 PID 文件
```

插件侧只剩：`service/server.js`（9 行，调用 bootstrap）+ `runner`（fetcher/crawler）+ `SKILL.md`。

---

## 二、常用命令

```powershell
cd D:\www\dsh-plugin-factory\platform\factory

node cli.cjs list                 # 列出插件
node cli.cjs doctor --health      # 自检：manifest/路径/语法/配置/patch/端口/健康/报告
node cli.cjs render               # 由 manifest 重新生成 patch 与 dshskills/registry.md（自动备份 patch）
node cli.cjs up                   # 启动全部服务（后台，写 PID）
node cli.cjs up shop-list         # 启动单个
node cli.cjs down                 # 停止全部
node cli.cjs status               # 查看状态
node cli.cjs watch 15             # 守护：掉线自动拉起
node cli.cjs smoke shop-list      # MCP 五连冒烟（自动注入服务 token）
node cli.cjs test                 # 平台测试（12 用例：契约 + runtime）
node cli.cjs secret shop-list set LISTING_API_KEY=xxx   # 加密保存凭证
node cli.cjs secret shop-list list                      # 列出凭证键（不显示值）
node cli.cjs clean                # 清理过期任务目录
node cli.cjs port                 # 下一个空闲端口
```

---

## 三、manifest 字段（platform/manifests/<id>.json）

```jsonc
{
  "id": "shop-list",              // kebab-case，= 目录/SKILL name/patch 前缀
  "name": "店铺盘点",
  "type": "api",                  // api | browser | crawler
  "version": "3.0.0",
  "port": 8792,
  "taskType": "shop_list",        // 全局唯一
  "serverName": "shop-list",      // 全局唯一
  "service": {
    "dir": "D:/www/dsh-plugin-factory/plugins/shop-list/service",
    "entry": "server.js",
    "runner": "fetcher.js",
    "dataDir": ".../data",
    "startCmd": ["node", ["server.js"]]
  },
  "runtime": {
    "write": false,               // true = 写操作插件（confirm_write + 额度 + 审计）
    "token": true,                // 服务鉴权（MCP 通过 MCP_SERVICE_TOKEN 携带）
    "serviceToken": "<32hex>",
    "retentionDays": 7,
    "toolTimeoutMs": 600000
  },
  "mcp":   { "dir": "D:/www/dshskills/tools/<id>-mcp" },
  "skill": { "dir": "D:/www/dshskills/skills/<id>" },
  "report": { "generator": "...", "output": "..." },
  "secrets": ["LISTING_API_KEY"], // DPAPI 存储键，启动时注入 env
  "legacy": false                 // true = 未迁移共享 runtime（仅 concise-analysis）
}
```

---

## 四、HTTP 契约（v3 新增能力）

| 接口 | 说明 |
|---|---|
| `POST /jobs` | `{params}` → 202 `{jobId,status}`；**鉴权** `Authorization: Bearer <serviceToken>`；写插件需 `confirm_write=true`（dry_run 放行）+ 每日额度 + `idempotency_key` 去重 |
| `GET /jobs/:id` | 状态/进度/错误 |
| `GET /jobs/:id/result` | 仅 done；`{main,details,missingItems}` |
| `POST /jobs/:id/cancel` | 取消运行中任务（runner 需检查 `ctx.isAborted()`） |
| `GET /jobs` | 任务列表（status/limit） |
| `GET /metrics` | 任务统计：byStatus/p50/p95/topErrors/queue/uptime |
| `GET /health` | `{ok,id,version,taskType,write}` |

持久化：`data/jobs.db`（SQLite）；重启时 `running → failed(服务重启)`；按 `retentionDays` 每小时清理任务目录与记录；`data/logs/*.log` JSON 行 + 5MB 轮转。

---

## 五、凭证与安全

- 凭证 **不再明文**：`factory secret <id> set KEY=VALUE` → DPAPI 加密到 `platform/secrets/<id>.enc`；服务启动时解密注入 `process.env`。
- 服务鉴权：每个插件独立 `serviceToken`；MCP 的 patch 条目里带 `MCP_SERVICE_TOKEN`，runtime 校验 `Authorization`。
- 写操作治理：`write:true` 的插件要求 `confirm_write=true`；`dry_run=true` 可预演；每日额度（`WRITE_DAILY_QUOTA`，默认 20）；`idempotency_key` 防重复；日志记录 caller。
- 报告/日志不出现明文凭证（脚本级脱敏 + 报告只显示账号掩码）。

---

## 六、测试与门禁

```powershell
node cli.cjs test     # 12 用例：契约（manifest/路径/端口/任务唯一/patch/SKILL/runtime 引用）
                      #            runtime（提交→结果、鉴权 401、写闸门 403、取消、指标）
```

发布/新增插件流程：`render` → `doctor --health` → `test` → `smoke <id>`，全绿才算完成。

---

## 七、迁移现状（2026-11-14）

| 插件 | 端口 | 类型 | 迁移 |
|---|---|---|---|
| concise-analysis | 8790 | crawler | legacy（保持原实现，独立 .env） |
| listing-list / shop-list / ads-list / draft-cleanup / stock-alert | 8791–8795 | api | ✅ 共享 runtime + manifest + token + DPAPI |
| haina-comment（写操作） | 8796 | browser | ✅ 共享 runtime + 写闸门/额度/审计 |
| gsmp-academy | 8797 | browser | ✅ 共享 runtime |

旧实现备份为 `service/server.legacy.js`、`fetcher.legacy.js`（确认稳定后可删除）。

---

## 八、保留项与后续

| 项 | 状态 | 说明 |
|---|---|---|
| MCP 聚合（单进程多工具） | 暂缓 | 会改变工具命名（`mcp__<server>__*`），影响所有 SKILL 文档；8 个 node 进程成本可接受，先不引入风险 |
| 跨平台 | 部分 | CLI 已 Node 化；DPAPI/junction/patch 仍 Windows 绑定 |
| 崩溃自动重启 | 部分 | `watch` 提供轮询拉起；生产建议 NSSM/pm2 托管 |
| 多人并发写 patch | 未做 | 当前单人工位假设；如需多人，先加文件锁/审批流 |
