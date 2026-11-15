# 48 — 动作型插件：API 状态标记（写操作门禁）

> 目的：验证插件可以调 API 改数据，并且有 dry_run / confirm_write / 回执 / 审计；不是只生成报告。

## 1. 插件

`api-status-mark`：

- 读取待处理订单
- `dry_run=true`：只生成计划，不调用 API
- `confirm_write=true`：调用 `PATCH /orders/:id/status`
- 输出：`api_status_receipt.json` + `api_status_mark_audit.json`
- 无 HTML 报告

## 2. 结果

| 项 | 结果 |
|---|---|
| 待处理订单 | 4 |
| 预演 | 4 条 planned，0 次 API |
| 正式 | **4/4 成功，4 次 API 调用** |
| 产物 | 回执 + 审计 |
| 报告 | 无（可选） |
| pipeline | staging 用 dry_run 通过 |
| 请求 | `req_20261115140027_086a03` |

## 3. 工厂改造

1. 生成器对 `effect=write/message/mixed` 的 staging 自动传 `dry_run=true`，避免验收阶段真实写。
2. 运行时 `artifacts` 返回 `receipt`/`main`，动作产物可直接取。
3. 动作插件可在 `outputs` 声明 `dataset/receipt/audit`，不需要 `report`。
4. 写操作仍需 `confirm_write`；没有确认直接拒绝。

## 4. 边界

- 当前用本地 mock API 验收；接真实 API 时只需换 `target_url` + 凭证（环境变量）。
- 真实外部写必须加：额度、幂等、失败重试、审计、回滚策略。
- 本次没有触碰真实业务 API。

## 5. 下一步

- `message-outbox`：生成待发送消息 + 人工确认发送，不自动群发。
- 真实 API 试点：需要账号/API key + 业务验收。
