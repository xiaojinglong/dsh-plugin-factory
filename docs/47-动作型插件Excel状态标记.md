# 47 — 动作型插件落地：Excel 状态标记

> 目的：验证“插件不是报告生成器”；一个插件可以只做动作、输出新文件 + 审计，不生成 HTML。

## 1. 插件

`excel-status-mark`：

- 读取订单 Excel（`Orders` 表：order_id/sku/amount/status）
- 规则：金额 ≥100 → `高额-已标记`；≤0 → `异常-待核对`；其余 `正常`
- **不覆盖原文件**，生成 `orders-marked.xlsx`
- 输出 `excel_status_mark_audit.json`（变更行 + 汇总）
- 无 `gen-report.mjs`、无 HTML 报告

## 2. 结果

| 项 | 结果 |
|---|---|
| 输入 | 6 行订单 |
| 变更 | **6 行** |
| 产物 | `orders-marked.xlsx`（新文件） |
| 审计 | `excel_status_mark_audit.json` |
| 原文件 | 未修改 |
| pipeline | staging 通过（无 report 校验） |
| install/job | 通过 |
| 请求 | `req_20261115134929_c9680d` |

## 3. 工厂改了什么

1. plugin spec 增加 `effect` / `outputs`。
2. 生成器支持 `outputs` 不含 `report`：不生成 `gen-report.mjs`，manifest `report=null`。
3. validate 只在声明 report 时校验 `staging:report`。
4. probe 支持 `.xlsx` 二进制 fixture（不再当 JSON 解析）。
5. 运行时 result 增加 `artifacts`，动作产物（file）可直接看到。
6. `plugin-install` 允许无 `gen-report.mjs` 的插件安装。
7. `effect=file` 不触发外部写操作闸门（只写本地新文件）。

## 4. 意义

- 插件可以只做“改文件/标状态/调 API/发消息”，报告可选。
- 对写外部系统的插件（API/消息），仍必须 `confirm_write`、额度、幂等、审计；`file` 只写本地新文件，不覆盖原文件。
- 这是从“报告工厂”转向“业务动作工厂”的第一条真实动作链路。

## 5. 下一步

- 第二个动作样板：`order-status-mark`（调 API/标记状态 + 回执）。
- 第三个：`message-outbox`（生成待发送消息 + 回执模拟，不真实发送）。
- 把 `effects/artifacts/audit` 统一展示到 MCP/DSH。
