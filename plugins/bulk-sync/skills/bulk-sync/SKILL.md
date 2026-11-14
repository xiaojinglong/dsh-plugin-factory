---
name: bulk-sync
description: 订单批量同步（模拟）：分页拉取订单并验证「分页 / 瞬态失败自动重试 / 进度 / 取消 / 空数据」链路，输出单文件 HTML 报告。数据来自插件内置模拟上游，不访问真实系统。触发词：订单同步、批量同步、bulk-sync、分页重试、模拟上游。
---

# 订单批量同步（模拟）Skill（bulk-sync）

> ⚠️ 本插件是**工厂复杂场景验证插件**：数据来自内置模拟上游（随机端口），不是真实业务数据。
> 用途：验证 API 型执行层（`platform/runtime/runner-api.js`）在分页、重试、进度、取消、空数据下的行为。

## 1. 适用场景

- **做**：按页拉取模拟订单，统计站点/店铺/状态/金额分布，输出 8 节单文件 HTML 报告；验证执行层可靠性。
- **不做**：不连接任何真实业务系统；不写任何数据；不代表真实经营结论。
- **默认参数**：2 页、每页 50、模拟总量 240、响应延迟 80ms。

## 2. 前置与输入

| 项 | 值 |
|---|---|
| taskType | `bulk_sync` |
| serverName / 业务标识 | `bulk-sync` |
| 服务端口 | `8798`（MCP `D:/www/dshskills/tools/bulk-sync-mcp`） |
| 鉴权 | 服务端 Bearer token（由 runtime manifest 注入），MCP 侧通过 `MCP_SERVICE_TOKEN` 携带 |
| 模拟上游 | 插件启动时自动监听 `127.0.0.1:0`，地址写入 `MOCK_UPSTREAM_URL`；不依赖外部网络 |
| 可调参数 | `pages`（默认 2，上限 8）、`pageSize`（默认 50，上限 200）、`total_rows`（默认 240）、`delay_ms`（默认 80，上限 5000）、`fail_first_n`（默认 0，上限 10）、`empty`（默认 false） |
| 主产物 | `bulk_sync_dataset.json`（契约见 `docs/10-标准产物契约.md`） |
| 报告 | `plugins/bulk-sync/report/bulk-sync-report.html` |

## 3. 工具清单

| 工具 | 用途 |
|---|---|
| `submit_task` | 提交任务，返回 `taskId`（= jobId） |
| `wait_task` | 轮询到 `succeeded / failed` |
| `get_task_status` | 轻量状态（progress/error） |
| `get_task_result` | 取产物清单，`main.path` 为 dataset 绝对路径 |
| `read_result_file` | 解析 dataset（json） |

## 4. 业务编排流程

1. 确认参数（默认即可；测重试用 `fail_first_n=1`，测取消用大 `delay_ms` + 多页）。
2. `submit_task(taskType='bulk_sync', params={...})`。
3. `wait_task(taskId)`；`failed` 时原样转述 `error`。
4. `get_task_result(taskId)` → `main.path`。
5. `read_result_file(filePath)`：校验 `pages[].rows` 条数 = `pages × pageSize`（末页可能更短）、`total` 与 `pagination.total` 一致。
6. 生成报告：`node plugins/bulk-sync/gen-report-bulk.mjs <dataset.json>`（必须显式传本次 job 数据文件）。
7. 交付：报告路径 + 样本/总量 + 覆盖率 + 限制。

### 4.5 字段校准（2026-11-14 实测·模拟上游）

| 项 | 结论 |
|---|---|
| 分页协议 | `{code:200,data:{list,pagination:{total,totalPages,page,pageSize}}}`；`runner-api` 直接消费 |
| `total_rows` | 生效：决定 `pagination.total` 与末页长度 |
| `fail_first_n` | 生效：前 N 次 POST 返回 HTTP 500，`runner-api` 每页自动重试 1 次 |
| `delay_ms` | 生效：用于制造长任务，配合取消验证 |
| `empty=true` | 生效：`list=[]`、`total>0` 但空页 → 服务任务 done、dataset `pages=[]` |

## 5. 分析规则（唯一口径）

```
样本订单数 = Σ pages[].rows.length
金额合计   = Σ amount
客单均值   = 金额合计 / 样本订单数
退款单     = status == 'REFUNDED'
重复主键   = 样本订单数 - distinct(order_id)
覆盖率     = 样本订单数 / total
```

## 6. 数据校验

- `pages[].rows` 之和 = 报告样本数；`dataset.total` 与 `pagination.total` 一致。
- `order_id` 唯一；`amount` 为正数；关键字段 `order_id/site/status` 非空。
- 空数据：服务 `done`、dataset `pages=[]`、报告脚本 exit 2 且不覆盖旧报告。
- 取消：运行中 `POST /jobs/:id/cancel` → 任务 `cancelled`（执行层在页边界抛"任务已被终止"）。

## 7. 输出模板（HTML 8 节）

1. 结论摘要 2. 数据口径 3. 结构分布 4. 风险与异常 5. 优化建议 6. 限制与未决 7. 附录（任务/数据集/全样本） 8. 生成信息

页眉必须含「任务：<jobId>」与「取数时间：<fetchedAt>」。

## 8. 异常与重试

| 现象 | 处理 |
|---|---|
| 首轮 500 | `runner-api` 自动重试 1 次；成功则任务仍 done（报告 §四 有说明） |
| 连续 500 | 任务 `failed`，error 含 HTTP 状态与接口消息，原样转述 |
| 空数据 | 任务 done，报告 exit 2，不覆盖旧报告 |
| 取消 | `cancelled`；已写入的任务记录保留，可在 `/jobs?status=cancelled` 查看 |
| 401 | 检查服务 token 与 MCP `MCP_SERVICE_TOKEN` 是否一致（manifest 单一事实源） |

## 9. 维护与扩展

- 换真实 API：只改 `service/fetcher.js` 的 `TASK`（`baseUrl/path/authEnv/buildBody`），执行层复用 `platform/runtime/runner-api.js`。
- 换端口/命名：改 `platform/manifests/bulk-sync.json` 后 `factory render`，禁止手改 patch。
- 报告：改 `gen-report-bulk.mjs` 统计段，保持 8 节与空数据守卫。

## 10. 待确认清单

1. 真实业务中"重试次数"是否需要落盘并在报告展示（当前仅日志）。
2. 单任务最大页数 8 是否满足真实订单量（可改 `maxPages`）。
3. 是否需要把模拟上游切换为真实接口后再做一次字段校准。
