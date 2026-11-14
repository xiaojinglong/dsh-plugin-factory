---
name: ads-list
description: Shopee 广告活动盘点：调用广告列表接口取指定店铺与周期的前 2 页活动，统计花费/曝光/点击/ROI 并输出单文件 HTML 报告与止损建议。触发词：广告盘点、广告活动分析、ROI 诊断、ads-list。
---

# Shopee 广告活动盘点 Skill（ads-list）

## 1. 适用场景
- 盘点某店铺某周期内的广告活动效果：花费、曝光、点击、CTR/CPC、订单与 ROI。
- 产出：单文件 HTML 报告（结论、口径、结构、花费 Top10、风险清单、建议、附录）。
- 边界：**只读**；调价/关停等写操作不在本 Skill（需单独审批）。

## 2. 前置与输入
- 接口：`POST https://api.giikin.com/agent/shopee/user/openapi/ads/list`
- 必填：`shop_id`（平台店铺号）、`date_time:[from,to]`（`YYYY-MM-DD`）
- 默认：`shop_id=1097451512`、`2026-11-01 ~ 2026-11-13`、2 页、`pageSize=20`
- 凭证：服务端 `LISTING_API_KEY`
- 可覆盖：`pages`、`shop_id`、`date_from/date_to`

## 3. 工具清单（ads-list-mcp）
| 工具 | 用途 | 参数 |
|---|---|---|
| `submit_task` | 提交 | `taskType:"ads_list"`、`params:{pages,shop_id,date_from,date_to}` |
| `wait_task` / `get_task_status` | 等待/查询 | `taskId` |
| `get_task_result` | 产物清单 | `taskId` → `main` |
| `read_result_file` | 解析 JSON | `filePath` |

## 4. 编排
4.1 确认店铺+周期 → 4.2 `submit_task` → 4.3 `wait_task` → 4.4 `get_task_result` → 4.5 `read_result_file`
4.6 统计（花费/曝光/点击/CTR/CPC/ROI、类型/状态/出价/位置分布、Top10）→ 4.7 HTML（`D:\www\dshspirder\ads-list\gen-report-ads.mjs`）→ 4.8 结论 + 建议

## 4.5 字段校准（2026-11-13 实测）
- 主机 **api.giikin.com**，路径 `/agent/shopee/user/openapi/ads/list`，Bearer dk 凭证。
- `date_time` 必须是 **2 元素数组** `["YYYY-MM-DD","YYYY-MM-DD"]`；传 `date_from/date_to` 会报 `统计时间区间 字段是必须的`。
- `shop_id` 是**平台店铺号**（如 1097451512），不是本地 id；`account_id` 会报错提示。
- 返回 `list`（活动）+ `pagination` + `date_from/date_to`；活动含 `metrics`：
  `impression, clicks, expense, direct_order, direct_gmv, broad_order, broad_gmv, ctr, cpc, cr, broad_roi, direct_roi, cpdc, date_time`。
- 16 个活动字段 + `metrics` + `items`；金额为站点原币种。
- 部分店铺/周期返回 `total=0`（无投放），需换店铺或周期。

## 5. 分析规则
| 指标 | 规则 |
|---|---|
| CTR | `clicks/impression*100`（样本加权） |
| CPC | `expense/clicks` |
| ROI | `Σbroad_gmv / Σexpense`（宽口径） |
| 有花费无点击 | `expense>0 且 clicks=0` → 高 |
| ROI 偏低 | `expense>0 且 broad_roi<5` → 高 |
| CTR 偏低 | `impression>10000 且 ctr<1%` → 中 |
| 未设预算 | `campaign_budget=0` → 低 |
| 高 ROI 可加投 | `broad_roi ≥ 20` |

## 6. 校验
- `list[]` 非空；`metrics` 字段完整；`pagination.total` 与样本说明一致。
- 金额单位一致（同站点原币种），跨站点不汇总。

## 7. 输出模板（HTML 7 节）
一、结论摘要｜二、数据口径｜三、结构分布｜四、花费 Top10｜五、风险清单｜六、优化建议｜七、附录

## 8. 异常
| 场景 | 处理 |
|---|---|
| `code=100400` 时间区间 | 传 `date_time` 数组 |
| `code=100400` shop_id | 用平台店铺号，不用 account_id |
| total=0 | 换店铺/周期，输出"该店铺该周期无投放" |
| 401/403 | 检查凭证，不重试 |

## 9. 维护
- 改周期/店铺：改 `params`；换页数：`params.pages`。
- 版本：v1.0（2026-11-13，2 页 32 个活动 / 花费 1126.37 / ROI 13.43）。

## 10. 待确认
| 事项 | 当前 |
|---|---|
| 统计周期 | 2026-11-01 ~ 2026-11-13（单店铺） |
| 采样 | 2 页 32 个活动（全量 32） |
| 币种 | 站点原币种（MYR） |
| 写操作 | 未包含调价/关停 |
