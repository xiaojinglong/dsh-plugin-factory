---
name: draft-cleanup
description: Shopee 草稿商品清理：盘点指定负责人名下 DRAFT 草稿商品前 2 页，按站点/类目/僵化时长分布，判定可清理与可上架优先级，输出单文件 HTML 报告。触发词：草稿清理、草稿盘点、DRAFT 商品、僵尸商品、草稿积压、draft-cleanup。
---

# Shopee 草稿商品清理 Skill（draft-cleanup）

## 1. 适用场景

- 盘点某负责人（默认陈雄德，`shop_user_id=632016`）名下的 **草稿（DRAFT）** 商品积压：规模、站点/类目分布、僵化程度。
- 回答三件事：① 草稿积压多大、分布在哪；② 哪些可清理（长期未更新 / 无图 / 无价 / 重复标题主图）；③ 上架与清理的优先级。
- 产出：**单文件 HTML 报告**（`report/draft-cleanup-report.html`）。
- 边界：**只读**。本 Skill 不执行任何删除/上架/改价动作，只出清单与建议。

## 2. 前置条件与输入

| 项 | 值 |
|---|---|
| 接口 | `POST https://api.giikin.com/agent/shopee/user/openapi/listing/listing` |
| 鉴权 | `Authorization: Bearer <LISTING_API_KEY>`（服务端 `.env`，`dk-ai-p-…`，不进日志/报告） |
| 默认过滤 | `shop_user_name=陈雄德`、`status="DRAFT"` |
| 采样 | **2 页**（业务要求，不拉全量）；单页固定 20 条 |
| 端口 | 8794（`draft-cleanup` 服务） |
| taskType | `draft_cleanup` |
| 产物 | `draft_cleanup_dataset.json`（契约见 `plugin-factory/10-标准产物契约.md`） |

用户可覆盖：`pages`（≤10）、`shop_user_name`、`status`（如临时看 `NORMAL`）、`pageSize`、`shop_user_id`（仅记录，接口不生效）。

## 3. 工具清单（draft-cleanup-mcp）

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `submit_task` | 提交取数任务 | `taskType:"draft_cleanup"`、`params:{pages:2}` |
| `get_task_status` | 轻量状态查询 | `taskId` |
| `wait_task` | 轮询到终态（succeeded/failed） | `taskId` |
| `get_task_result` | 取产物清单 | `taskId` → `main.fileName/main.path` |
| `read_result_file` | 解析 JSON 产物 | `filePath` |

## 4. 业务编排流程

1. 确认口径（默认：陈雄德 632016、DRAFT、2 页）→ 2. `submit_task` → 3. `wait_task`
4. `get_task_result` 取 `main.path` → 5. `read_result_file` 读数据集
6. 本地统计（分布 + 僵化 + 完备度）→ 7. `node D:\www\dshspirder\draft-cleanup\gen-report-draft.mjs`
8. 输出报告路径 + 三条结论（规模/可清理/优先级）

**报告脚本**：`D:\www\dshspirder\draft-cleanup\gen-report-draft.mjs`
- 数据源解析顺序：`argv[2]` 指定路径 → `draft-cleanup/data/dataset.json` → `service/data/jobs/<最新>/draft_cleanup_dataset.json`
- 输出：`D:\www\dshspirder\draft-cleanup\report\draft-cleanup-report.html`
- 命令：`cd D:\www\dshspirder\draft-cleanup && node gen-report-draft.mjs`
- 传 job 产物：`node gen-report-draft.mjs "D:\www\dshspirder\draft-cleanup\service\data\jobs\<jobId>\draft_cleanup_dataset.json"`

## 4.5 字段校准（2026-11-13 实测，probe/probe-draft.mjs）

- 主机必须是 **api.giikin.com**（不是 openapi.giikin.com）；`Authorization: Bearer <dk 凭证>`。
- **`status` 取值实测**：`"DRAFT"` → `total=1021 / totalPages=52`（草稿）；`"NORMAL"` → `total=34`（在售）；**不传** → `total=2832`（草稿+在售）。
- **`status` 大小写不敏感**：`DRAFT` 与 `draft` 返回完全一致（1021）；建议代码里统一 `toUpperCase()`。
- **`shop_user_id` 不生效**：传与不传结果一致（全组织量级）；生效过滤是 **`shop_user_name`**。
- 分页：`pageSize` 请求值被忽略，实际固定 **20 条/页**；`pagination.total/totalPages` 可信；第 2 页可取到不同 id。
- **无可用排序参数**：`sort_type` 等会触发 500（`foreach() argument must be of type array|object, int given`），"前 2 页"= 接口默认顺序。
- 返回结构：`data.list[]` + `data.pagination{page,total,totalPages}` + `data.userIdArr`；单条 **127 个字段**。
- 草稿关键字段：`id, status, site, item_name, category_cn_name, category_cn_tree, current_price, original_price, price_range, currency_id, main_image, has_video, item_sku, normal_stock, warehouse_stock_total, content_score, quality_level, views, order_count, order_day3|7|30|90, create_time, update_time, upload_time, offline_time, similar_title_percent, similar_image_percent, is_contraband, marked_ban_words, upload_mode_cn, account{account,site,currency,shop_user_name,shop_user_id,status}`。
- **`upload_time` 为空 = 从未上架**（草稿的强信号）；`offline_time=1970-01-01 08:00:00` = 从未下架。
- 本批实测偏差：`quality_level` 全为 0（未评级）、`similar_title_percent/similar_image_percent` 全为 0（接口未算相似度）、`update_time` 全为同一时刻（批量操作痕迹）→ 重复检测须用"标题/主图字符串完全相同"补位。
- `sale` 全 0、`views/order_count` 全 0：草稿不参与流量分发，动销类指标无意义，别误读成"卖不动"。

## 5. 分析规则

### 5.1 派生判定

| 概念 | 规则 |
|---|---|
| 有价 / 有图 / 有SKU | `current_price>0` / `main_image` 非空 / `item_sku` 非空 |
| 库存 | `normal_stock + warehouse_stock_total` |
| 未更新天数 | 今天 − `update_time`（字符串 `YYYY-MM-DD HH:MM:SS`） |
| 僵化（stale） | 未更新 > 90 天 |
| 完备（complete） | 有价 + 有图 + 有SKU + `content_score≥80` + 库存>0 |
| 上架完备分 | 价25 + 图25 + SKU15 + 内容分15 + 库存10 + 视频5 + price_range5（满分 100） |
| 清理优先级分 | >180天+4 / >90天+3 / >30天+2；缺价+3、缺图+3、缺SKU+2；相似≥50% +2；零库存+1；零动销+1 |

### 5.2 2×2 分档（互斥，报告第七节）

| 档 | 条件 | 动作 |
|---|---|---|
| P1 立即上架 | 完备 且 ≤90 天 | 直接发布测款 |
| P1b 上架验证 | 完备 但 >90 天 | 挑 Top10 发布，其余归档 |
| P2 补全后上架 | 不完备 且 ≤90 天 | 补视频/价格区间 |
| P3 归档/清理 | 不完备 且 >90 天 | 归档/合并/删除 |

### 5.3 清理规则三档口径

1. **硬清理候选**：缺价 / 缺图 / 缺SKU / 超 180 天 / 零库存且零动销。
2. **归档候选**：信息完整但 >90 天未动（本批全部落此档）——先上架验证，再决定归档。
3. **业务口径"长期未更新"**：>90 天即进入清理评审，>60 天进入双周评审。

> 关键经验：**不能只用"缺图/缺价"判定垃圾草稿**。本批 40 条字段齐备却 122 天未动、从未上架，真正信号是"僵化时长 + upload_time 为空"。

## 6. 数据校验

- 必含 `pages[].rows[]`、`total`、`totalPages`；`rows` 之和 = 报告样本数；`total` 与 `pagination.total` 一致。
- 每条 `status` 应全为 `DRAFT`（若不是，说明服务端 status 参数没生效，停止出结论）。
- `id` 跨页应唯一；重复则提示分页抖动。
- 报告每个数字必须能指到字段名；禁止编造。

## 7. 输出模板（HTML 9 节）

```
一、结论摘要   二、数据口径   三、积压规模与分布   四、草稿生命周期（僵化程度）
五、哪些草稿可清理（规则命中表）   六、清理候选 Top10
七、上架与清理优先级建议（2×2 分档 + P1 Top10 + 按周执行建议）
八、异常与限制   九、附录
```

要求：单文件、内联 CSS、无外链、可离线打开；含生成时间与数据源。

## 8. 异常与重试

| 场景 | 处理 |
|---|---|
| `wait_task` 返回 `failed` | 输出 `error`；同参数最多重试 1 次 |
| 401/403 | 检查服务端 `LISTING_API_KEY`；不重试 |
| 500（`foreach()/trim()` 类型错误） | 传了被禁参数（如 `sort_type`/int 型 status），改最小参数 |
| `total=0`（无草稿） | 输出"该负责人无草稿"，不生成报告（脚本 `exit 2`） |
| 样本全是 NORMAL | status 参数未生效，停下排查 |
| 端口 8794 未监听 | `Get-NetTCPConnection -LocalPort 8794`，重启服务 |
| 报告脚本 import 失败 | report-kit 路径是 `../factory-kit/report-kit.mjs`（相对插件根目录） |

## 9. 维护与扩展

- 换负责人：`params.shop_user_name`（`shop_user_id` 仅记录）。
- 看全量：`params.pages`（上限 10，即最多 200 条）。
- 换接口/主机：改 `service/fetcher.js` 的 `TASK` 配置（逻辑在 `api-runner.js`，不用动）。
- 换端口：三处同步 `.env.PORT` ↔ `mcp/config.json.service.baseUrl` ↔ patch `MCP_SERVICE_BASE_URL`。
- 版本：v1.0（2026-11-13，首次实测 2 页 40 条 / 全量 1021）。

## 10. 待确认清单

| 事项 | 当前取值 | 影响 |
|---|---|---|
| 采样页数 | 2 页 40 条（覆盖 1021 条的 3.9%） | 结论仅代表样本，清理总量需全量重跑 |
| 站点范围 | 样本仅 sg（账号 guinian2.sg） | 其他站点结论不可外推 |
| 清理口径 | "清理"= 归档/合并，不含删除 | 删除动作需业务二次确认 |
| 僵化阈值 | 60 天评审 / 90 天清理候选 / 180 天归档 | 阈值为经验值，待业务确认 |
| 排序口径 | 接口无排序参数，前 2 页为默认顺序 | 可能不是最旧/最贵的一批 |
| 相似度字段 | `similar_*_percent` 全为 0 | 重复判定改用标题/主图完全相同 |
| 上刊方式 | 样本全为「智刊」 | 其他上刊方式未采样 |
