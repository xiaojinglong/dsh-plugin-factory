---
name: stock-alert
description: 缺货预警盘点：取指定负责人名下在售商品前 2 页，按总库存=0/≤10 找出缺货与低库存商品，标记「30 天有单但缺货」高危品并按严重度排序，输出带补货建议的单文件 HTML 报告。触发词：缺货预警、库存预警、低库存、断货、补货建议、stock-alert。
---

# 缺货预警 Skill（stock-alert）

## 1. 适用场景

- **做**：按负责人 + 在售状态取商品样本，计算总库存，识别「缺货 / 低库存 / 30 天有单但缺货」三类风险，按严重度排序，输出单文件 HTML 报告与补货优先级建议。
- **不做**：不补货、不调价、不上下架、不发消息、不删除商品。全流程只读。
- **默认对象**：陈雄德（`shop_user_name=陈雄德`）、`status=NORMAL`、2 页。业务未指定时用这些默认值，并在交付里标注【默认】。
- **数据源**：`POST https://api.giikin.com/agent/shopee/user/openapi/listing/listing`。

## 2. 前置与输入

| 项 | 值 |
|---|---|
| 凭证 | 服务端 `.env` 的 `LISTING_API_KEY`（Bearer）；**不要向用户索取，也不要出现在报告/日志/对话** |
| taskType | `stock_alert` |
| serverName / 业务标识 | `stock-alert` |
| 服务端口 | `8795` |
| 可调参数 | `shop_user_name`（默认 陈雄德）、`status`（默认 NORMAL）、`pages`（默认 2，上限 10） |
| 固定行为 | `pageSize` 恒为接口上限 20（传 100 也返回 20） |
| 主产物 | `<task>_dataset.json`（契约见 `10-标准产物契约.md`） |
| 报告 | `D:\www\dshspirder\stock-alert\report\stock-alert-report.html`（单文件、内联 CSS、8 节） |

## 3. 工具清单

| 工具 | 用途 |
|---|---|
| `submit_task` | 提交任务，返回 `taskId`（即服务端 `jobId`）；参数放 `params` |
| `wait_task` | 轮询到 `succeeded / failed / waiting_verify` |
| `get_task_status` | 轻量状态（progress/error） |
| `get_task_result` | 取产物清单：`main.path` 即 dataset 绝对路径 |
| `read_result_file` | 读取并解析 dataset（json） |

## 4. 业务编排流程

1. **确认参数**：负责人、在售状态、页数（缺省用【默认】值）。
2. **提交**：`submit_task(taskType='stock_alert', params={shop_user_name, status, pages})`。
3. **等待**：`wait_task(taskId)`，直到 `succeeded`；`failed` 时读 `error` 原样转述。
4. **取结果**：`get_task_result(taskId)` → `main.path`。
5. **读数据**：`read_result_file(filePath)`，校验 `pages[].rows` 条数与 `total`。
6. **算指标**：按 §5 口径计算总库存与分级，禁止改口径。
7. **出报告**：`node D:\www\dshspirder\stock-alert\gen-report.mjs [dataset.json]`；不传参自动取最新 job。
8. **交付**：报告路径 + 风险数 + 样本覆盖率 + 限制；不得输出凭证。

### 4.5 字段校准（2026-11-14 实测）

实测脚本与原始输出：`D:\www\dshspirder\stock-alert\probe\probe.mjs` / `probe-output.txt`。

**参数三清单**

| 类别 | 参数 | 实测结论 |
|---|---|---|
| 生效 | `page` | 1、2 页分别返回 20/14 条，无重复 |
| 生效 | `shop_user_name` | `陈雄德` → total 2832；不传 → 6584254（全量） |
| 生效 | `status` | `NORMAL` → total 34；`normal` 等价（大小写不敏感） |
| 被忽略 | `pageSize` | 传 100 仍只返回 20 条（接口固定 20） |
| 被忽略 | `shop_user_id` | 传 632016 仍返回 1154139 条（不报错、不过滤） |
| 报错 | `status`（int） | `status=1` → HTTP 500 `trim(): Argument #1 ($string) must be of type string, int given` |
| 空结果 | `status=SOLD_OUT` | code=200、rows=0、total=0（合法空数据，不是错误） |

**分页**：单页固定 20；`pagination.total/totalPages` 可信（34/2，第 2 页 14 条，与第 1 页 0 重复）。2 页上限 40 条。

**字段**：每行 **127** 个字段（含嵌套 `account`）。本业务使用：

| 字段 | 含义 | 类型/样例 |
|---|---|---|
| `item_id` | 商品主键 | number `54003909362` |
| `item_name` | 商品名 | string（英文标题） |
| `status` | 商品状态 | string `NORMAL`（实测本页仅此值） |
| `site` | 站点 | string `sg` |
| `normal_stock` | 普通库存 | number `200` |
| `warehouse_stock_total` | 仓库总库存 | number `0` |
| `oversea_stock` | 海外仓库存 | number `0` |
| `order_day30/90` | 近 30/90 天单量 | number |
| `order_day3/7`、`order_count` | 近 3/7 天单量、累计单量 | number |
| `no_stock` | 缺货标记 | number 0/1（实测与"总库存=0"一致） |
| `last_order_create_time` | 最近出单时间 | string `''` 表示从未出单 |
| `category_cn_name` | 中文类目 | string |
| `stock_onway_plat_count` | 在途库存 | number |
| `user_name` / `account.shop_user_name` | 负责人（行级） | string |

**类型漂移**：`price_range` 同页既有 number 又有 string（`"10.26-38.05"`）；本插件不使用金额字段，若扩展必须 `Number()` 兜底并跳过非数字。

**空值语义**：`last_order_create_time=''`、`deleted_time/offline_time='1970-01-01 08:00:00'` 表示"从未发生"，不是数据缺失。

## 5. 分析规则（唯一口径）

```
总库存 total_stock = normal_stock + warehouse_stock_total + oversea_stock   // 业务给定
P1 高危 = total_stock == 0 且 order_day30 > 0
P2 缺货 = total_stock == 0
P3 低库存 = 1 <= total_stock <= 10
P4 健康 = total_stock > 10
排序：P1→P2→P3→P4；同级按 order_day30 desc、order_day90 desc、total_stock asc、item_id asc
```

- 报告只使用以上公式，§一/§四/§五/§六 必须同源。
- 风险范围 = `total_stock <= 10`（缺货 0 + 低库存 1–10）∪ 高危。
- **口径风险**：`warehouse_stock_total` 与 `oversea_stock` 实测高度重合（2026-11-14：22/34 同时 >0，12/34 完全相等），疑似层级包含；按业务公式相加可能重复计数。报告 §六 必须写明，并注明对当前风险清单的影响（实测本次结论不变）。

## 6. 数据校验

- `pages[].rows` 之和 = 样本数（34）；`dataset.total` = `pagination.total`（34）。
- `item_id` 在样本内唯一；跨页无重复。
- 行级 `account.shop_user_name` 应等于请求的 `shop_user_name`（抽查）。
- `no_stock` 标记与"总库存=0"判定应一致（实测 34/34 一致）。
- 抽查 3 个商品：`item_id` 的 `normal_stock/warehouse_stock_total/oversea_stock` 与 dataset 原值一致（报告 §七 全样本明细可直接对照）。
- 空数据：服务任务仍为 `done`、dataset `pages=[]`；报告脚本 exit 2 且不覆盖旧报告。

## 7. 输出模板（HTML 8 节）

1. 结论摘要（样本、风险数、高危数、口径提醒）
2. 数据口径（接口、鉴权、生效/忽略参数、公式、分级规则、覆盖率）
3. 结构分布（站点、库存档位、类目 Top10）
4. 风险与异常（按严重度排序的风险清单、高危专项、一致性自检）
5. 优化建议（补货优先级 P1/P2/P3 + 口径核对 + 巡检机制）
6. 限制与未决（覆盖率、站点偏差、口径风险、接口限制、字段语义、只读边界）
7. 附录（来源、jobId、取数时间、字段映射、全样本明细）
8. 生成信息

页眉必须含「任务：<jobId>」与「取数时间：<fetchedAt>」。

## 8. 异常与重试

| 现象 | 处理 |
|---|---|
| 401 / 凭证无效 | 停手：检查服务端 `.env` 的 `LISTING_API_KEY`，不要向用户索取明文 |
| `code=500` 且 message 含 `trim()` | 参数类型错误：`status` 必须传字符串 `NORMAL`，不能传数字 |
| `code!=200` | 原样转述 `code + message`，不静默成空数据 |
| `rows=[]` / `total=0` | 合法空数据：说明"该负责人/状态无在售商品"，不出结论与建议；报告脚本 exit 2 |
| 超时 / 5xx | api-runner 自动重试 1 次；仍失败则任务 `failed`，把 error 转述给用户 |
| 第 2 页少于 20 条 | 正常（末页），不是错误 |

## 9. 维护与扩展

- **换负责人**：`params.shop_user_name`（不要用 `shop_user_id`，实测被忽略）。
- **换状态**：`params.status` 传字符串；先小样本确认枚举值，不要猜。
- **加页数**：`params.pages`（≤10）；超过筛选全量页数时末页自然变短。
- **换数据源/加指标**：只改 `service/fetcher.js` 的 `TASK` 配置与 `gen-report.mjs` 统计段；不要动 `api-runner.js`（多插件共用模板）。
- **端口/命名**：已在 `D:\www\dshskills\registry.md` 登记（端口 8795，taskType `stock_alert`），不得复用。

## 10. 待确认清单

1. `warehouse_stock_total` 是否包含 `oversea_stock`？（影响总库存是否重复计数）
2. `order_day30` 的统计窗口起点（自然日/滚动 30 天）？
3. `status` 的完整枚举（实测仅见 `NORMAL`，`SOLD_OUT` 返回 0 条）。
4. 业务是否需要把"低库存"阈值从 10 改为其它值或按日均销量动态计算。
5. 是否需要多站点/多负责人汇总（当前单负责人、样本仅 sg）。
