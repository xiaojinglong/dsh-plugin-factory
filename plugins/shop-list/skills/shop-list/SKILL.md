---
name: shop-list
description: Shopee 店铺盘点：调用店铺列表接口取前 2 页，统计状态/站点/团队/店长/商品供给，输出单文件 HTML 报告。触发词：店铺盘点、店铺列表分析、店铺结构、shop-list。
---

# Shopee 店铺盘点 Skill（shop-list）

## 1. 适用场景
- 按负责人盘点名下 Shopee 店铺：规模、状态、站点/团队结构、商品供给与自动化配置。
- 产出：单文件 HTML 报告（结论、口径、结构分布、风险清单、建议、附录）。
- 边界：只读；不修改店铺与商品。

## 2. 前置与输入
- 接口：`POST https://api.giikin.com/agent/shopee/user/openapi/shop/list`
- 默认：`user_id=632016`、2 页、`pageSize=100`（接口最大 100）
- 凭证：服务端 `LISTING_API_KEY`（dk-ai-p…），不写进报告
- 可覆盖：`pages`（≤10）、`user_id`、`pageSize`

## 3. 工具清单（shop-list-mcp）
| 工具 | 用途 | 参数 |
|---|---|---|
| `submit_task` | 提交 | `taskType:"shop_list"`、`params:{pages,pageSize,user_id}` |
| `wait_task` / `get_task_status` | 等待/查询 | `taskId` |
| `get_task_result` | 产物清单 | `taskId` → `main` |
| `read_result_file` | 解析 JSON | `filePath` |

## 4. 编排
4.1 参数确认 → 4.2 `submit_task` → 4.3 `wait_task` → 4.4 `get_task_result` → 4.5 `read_result_file`
4.6 统计（状态/站点/团队/店长/店铺类型/币种/上架数）→ 4.7 HTML 报告（`D:\www\dshspirder\shop-list\gen-report-shop.mjs`）→ 4.8 结论 + 路径

## 4.5 字段校准（2026-11-13 实测）
- 主机 **api.giikin.com**，路径 `/agent/shopee/user/openapi/shop/list`，Bearer dk 凭证。
- `pageSize` 实测可用到 100；`pagination.total/totalPages` 可信（632016 → 3040 家 / 31 页）。
- 79 个字段；关键：`status`、`site`、`team`、`shop_user_id/name`、`account`、`shop_id`、`store_type`、`currency`、`upload_num`、`online_count`、`offline_num`、`total_count`、`is_auto_upload`、`pre_order_rate`。
- 本接口**不返回金额/营收**；商品数以上架数/在线数为准。
- 样本中 `online_count` 多为 0（同步滞后），报告用 `upload_num/total_count` 判断空店。

## 5. 分析规则
| 指标 | 规则 |
|---|---|
| 空店/无商品 | `upload_num=0 且 total_count=0` |
| 状态异常 | `status != NORMAL` |
| 下架风险 | `offline_num > 0` |
| 自动化 | `is_auto_upload=0` 且 `upload_num>0` |
| 预售异常 | `pre_order_rate > 30` |
| 结构 | 站点/团队/店长/店铺类型/币种 Top10 |

## 6. 校验
- `pages[].rows[]` 非空；`total` 与 `pagination.total` 一致；店铺主键 `id` 唯一。
- 每页条数 ≤ pageSize；缺页需说明。

## 7. 输出模板（HTML 6 节）
一、结论摘要｜二、数据口径｜三、结构分布｜四、风险清单｜五、优化建议｜六、附录

## 8. 异常
| 场景 | 处理 |
|---|---|
| 401/403 | 检查 `LISTING_API_KEY`，不重试 |
| `code=100400` | 参数缺失，按默认参数重试 1 次 |
| 空数据 | 输出"无数据" |
| 部分字段为 0 | 视为无数据，不参与统计 |

## 9. 维护
- 换负责人：改 `params.user_id`；换页数：`params.pages`。
- 版本：v1.0（2026-11-13，2 页 200 家 / 全量 3040）。

## 10. 待确认
| 事项 | 当前 |
|---|---|
| 店铺范围 | 负责人 632016 权限内全部（3040） |
| 采样 | 2 页 200 家 |
| 商品数口径 | upload_num / total_count，online_count 可能滞后 |
