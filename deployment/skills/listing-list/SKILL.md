---
name: listing-list
description: Shopee 商品 listing 盘点与经营分析：调用 listing 开放接口取前 2 页在售商品，做库存/动销/质量/合规诊断并输出单文件 HTML 报告。触发词：listing 分析、商品盘点、商品动销、库存诊断、listing-list。
---

# Shopee Listing 分析 Skill（listing-list）

## 1. 适用场景

- 对某店铺负责人名下的 Shopee 商品（listing）做盘点：看结构、库存、动销、内容质量与合规风险。
- 产出：**单文件 HTML 报告**（结论、口径、结构分布、库存动销、质量合规、异常清单、优化建议、附录）。
- 边界：**只读**；不修改任何商品/价格/库存；页面与接口调用由 listing-list 服务完成。

## 2. 前置条件与输入

数据来源（一次任务产出 1 个 JSON 数据集）：
- `listing_dataset.json`：`pages[]`（每页 `rows[]`）+ `total` + `params`。

默认口径：
- 接口：`POST https://api.giikin.com/agent/shopee/user/openapi/listing/listing`
- 负责人：`shop_user_id=632016`、`shop_user_name=陈雄德`
- 状态：`status="NORMAL"`（真实在售）
- 页数：**2 页**（业务要求，不拉全量）；单页固定 20 条
- 凭证：服务端 `LISTING_API_KEY`（`dk-ai-p-…`），不写进日志/报告

用户可覆盖：`pages`（≤10）、`shop_user_name`、`status`、`shop_user_id`（仅记录用，接口不生效）。

## 3. 工具清单（listing-list-mcp）

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `submit_task` | 提交取数任务 | `taskType:"listing_list"`、`params:{pages,shop_user_name,status}` |
| `get_task_status` | 查询状态 | `taskId` |
| `wait_task` | 轮询到终态 | `taskId` |
| `get_task_result` | 取产物清单 | `taskId` → `main`（listing_dataset.json） |
| `read_result_file` | 读取/解析 JSON | `filePath` |

## 4. 业务编排流程

4.1 参数确认（默认 2 页、在售、陈雄德 632016）→ 4.2 `submit_task` → 4.3 `wait_task`
4.4 `get_task_result` 取 `main.path` → 4.5 `read_result_file` 读 JSON
4.6 本地统计 → 4.7 生成 HTML 报告 → 4.8 报告路径 + 关键结论

**报表生成脚本（已实现）**：`D:\www\dshspirder\listing-list\gen-report.mjs`
- 输入：`service\data\jobs\<jobId>\listing_dataset.json`
- 输出：`D:\www\dshspirder\listing-list\report\listing-list-report.html`
- 命令：`cd D:\www\dshspirder\listing-list && node gen-report.mjs`
- 脚本只读 `data/dataset.json`；批量跑时把 job 的 main 文件复制为该路径（或改脚本入参）。

- 失败：`wait_task` 返回 `failed` → 输出 error，最多重试 1 次（同参数）。
- 该接口一般无扫码环节（token 鉴权）；若 401/403 → 检查 `LISTING_API_KEY`。

## 4.5 字段校准（2026-11-13 实测）

- 主机必须是 **api.giikin.com**（不是 openapi.giikin.com）；`Authorization: Bearer <dk 凭证>`。
- **`shop_user_id` 不生效**：不传/传 632016 结果都是全组织 6,581,194 条；生效过滤是 `shop_user_name`（陈雄德 → 2,832 条含草稿；加 `status="NORMAL"` → 34 条在售）。
- 分页：`pageSize` 请求值被忽略，实际固定 20 条/页；`pagination.total/totalPages` 可信。
- **会 500 的参数（禁用）**：`sort_type`、`status`（int）、`accountIds`（数组）——`foreach()/trim()/explode()` 类型错误。
- `shop_status`、`is_check_org`、`no_stock` 可传但不改变结果；排序参数（`order_day30:"desc"` 等）实测无效。
- 字段 127 个，关键：`status/site/item_name/origin_name/current_price/oversea_current_price/sale/views/likes/rating_star/comment_count/order_count/order_day3|7|30|90/normal_stock/cnz_stock/oversea_stock/warehouse_stock_total/stock_onway_plat_count/no_stock/quality_level/content_score/is_contraband/marked_ban_words/similar_title_percent/similar_image_percent/has_video/is_create_ads/ai_image_gen_status_message/update_time/upload_time`。
- 价格是**站点原币种**，跨站点不可直接相加；价格缺失按 0 处理不参与价格带。

## 5. 数据分析规则

| 指标 | 规则 | 边界 |
|---|---|---|
| 零库存 | `normal_stock+warehouse_stock_total+oversea_stock = 0` | 缺字段按 0 |
| 低库存 | `1 ≤ normal_stock ≤ 10` | |
| 库存滞销 | 总库存 > 100 且 `order_day30 = 0` | |
| 动销率 | `order_day30>0 条数 / 样本条数` | 样本=2 页 |
| 转化率 | `Σorder_count / Σviews` | views=0 → 不计算 |
| 均价 | `Σcurrent_price / 有效价格条数` | 原币种 |
| 平均内容分 / 评分 | 仅统计 >0 的值 | 0 视为无数据 |
| 风险分级 | 高：零库存/违禁/低评分/高库存零动销；中：低库存/敏感词/相似标题图/长期未更新/高浏览零成交 | |

## 6. 数据校验规则

- 必含：`pages[].rows[]`、`total`、`params`；缺则停止并说明。
- `rows` 条数 = 各页 rows 之和；`total` 与 `pagination.total` 一致。
- 商品主键 `id` 应唯一（跨页重复需提示）。
- 报告数字必须可追溯到 `dataset.json` 字段；禁止编造。

## 7. 输出模板（HTML 单文件，8 节）

```
一、结论摘要（5 条）
二、数据口径（接口/参数/过滤说明/币种/缺失）
三、结构分布（状态、站点、类目 Top10、价格带）
四、库存与动销（零库存/低库存/滞销、动销结构、库存 Top8）
五、质量、合规与内容（违禁/敏感词/相似标题图/视频/广告/AI 图）
六、异常清单（级别×类型×商品×关键数据×说明）
七、优化建议（按影响×可执行排序，每条带数据依据）
八、附录（数据文件、字段数、样本限制、生成方式）
```

要求：单文件（内联 CSS，无外链）、可离线打开、含生成时间与数据源。

## 8. 异常与重试

| 场景 | 处理 |
|---|---|
| `failed` | 原样输出 error；最多重试 1 次 |
| 401/403 | 提示检查 `LISTING_API_KEY`；不重试 |
| 500 | 说明是参数类型问题（传了禁用的 int/数组参数），改用最小参数 |
| 数据集为空 | 输出"无数据"，不出结论 |
| 价格/评分为 0 | 视为无数据，不参与统计 |
| 跨站点金额 | 不直接相加，按站点分组 |

## 9. 维护与扩展

- 换负责人/状态：改 `params` 即可，薄壳与报告无需改。
- 换接口主机/路径：只改 `service/.env` 与 `fetcher.js` 常量。
- 拉更多页：`params.pages`（默认 2，业务约定不超 10）。
- 版本记录：v1.0（2026-11-13，首次实测 2 页 34 条）。

## 10. 待确认清单

| 事项 | 当前取值 | 影响 |
|---|---|---|
| 数据范围口径 | 陈雄德名下在售（34 条），含草稿 2,832 条未纳入 | 报告只代表在售样本 |
| 采样页数 | 2 页（业务约定） | 非全量盘点 |
| 币种/汇率 | 站点原币种，不换算 | 跨站点金额不可加总 |
| 评分/评论 | 样本普遍为 0 | 评分维度结论有限 |
| 流量口径 | 累计 views（非时间窗） | 转化率仅供参考 |
