---
name: fs-ledger
description: 本地台账核对（文件系统型）：只读扫描指定目录的 CSV/JSON 台账，校验主键/数量/价格/库存/表头，坏文件与不支持类型登记为缺失项，输出单文件 HTML 报告。不修改、不删除任何文件。触发词：台账核对、本地文件扫描、fs-ledger、文件巡检、数据质量。
---

# 本地台账核对（文件系统型）Skill（fs-ledger）

> 本插件补齐工厂的**文件系统型**执行层：只读扫描 `plugins/fs-ledger/inbox/`，
> 不修改/移动/删除任何文件；示例数据为故意构造的异常夹具。

## 1. 适用场景

- **做**：扫描本地目录下的 `.csv` / `.json` 台账，按规则找异常（缺 SKU、重复 SKU、负数量、缺价、负价、负库存、短标题、缺列、坏 JSON、不支持类型），逐条输出报告；缺失项通过 `missingItems` 上报。
- **不做**：不修复文件、不移动/删除、不写回；不做业务对账（订单↔支付）。
- **默认目录**：`D:/www/dsh-plugin-factory/plugins/fs-ledger/inbox`（`INBOX_DIR` 可覆盖）。

## 2. 前置与输入

| 项 | 值 |
|---|---|
| taskType | `fs_ledger` |
| serverName / 业务标识 | `fs-ledger` |
| 服务端口 | `8801`（MCP `D:/www/dshskills/tools/fs-ledger-mcp`） |
| 执行层 | Node `fs` 只读（`service/runner.js`） |
| 可调参数 | 无业务参数；扫描目录由服务端 `INBOX_DIR` 决定 |
| 主产物 | `fs_ledger_dataset.json`（异常行 + 文件摘要） |
| 报告 | `plugins/fs-ledger/report/fs-ledger-report.html` |

## 3. 工具清单

| 工具 | 用途 |
|---|---|
| `submit_task` | 提交扫描任务（`params={}`） |
| `wait_task` / `get_task_status` | 轮询状态 |
| `get_task_result` | 取 dataset + `missingItems` |
| `read_result_file` | 解析 dataset（json） |

## 4. 业务编排流程

1. `submit_task(taskType='fs_ledger', params={})`。
2. `wait_task(taskId)`；`failed` 时原样转述（如 inbox 不存在）。
3. `get_task_result` → `main.path` 与 `missingItems`。
4. `read_result_file(main.path)`：校验 `extra.fileCount`、`extra.files[]`、异常条数。
5. 生成报告：`node plugins/fs-ledger/gen-report-fs.mjs <dataset.json>`。
6. 交付：报告 + 异常数（P1/P2/P3）+ 缺失项清单 + "只读/夹具"限制。

### 4.5 字段校准（2026-11-14 实测·夹具）

| 文件 | 实测结果 |
|---|---|
| `orders-2026-11-14.csv` | 解析 7 行；命中 负数量 / 缺价 / 重复 SKU / 短标题 / 缺 SKU / 负价 |
| `inventory.json` | 解析 4 条；命中 负库存 / 缺 SKU |
| `broken-schema.csv` | 缺必需列 `sku` → `MISSING_COLUMN` + missingItems |
| `bad.json` | JSON 解析失败 → `INVALID_JSON` + missingItems |
| `notes.md` | 不支持类型 → `UNSUPPORTED_TYPE` + missingItems |

## 5. 分析规则（唯一口径）

```
P1 = MISSING_SKU / NEGATIVE_PRICE / NEGATIVE_STOCK / MISSING_COLUMN / INVALID_JSON
P2 = DUPLICATE_SKU / NEGATIVE_QTY / MISSING_QTY / MISSING_PRICE
P3 = SHORT_TITLE（<4 字符）/ UNSUPPORTED_TYPE
异常条数 = Σ 规则命中次数（一行可命中多条）
orders* 文件必需列 = sku/title/qty/price；其它 CSV 必需列 = sku
```

## 6. 数据校验

- `extra.fileCount` = 目录文件数；`extra.files[].status` ∈ `read / skipped / unreadable`。
- 每个坏文件/缺列/不支持类型都必须出现在 `missingItems`（禁止静默忽略）。
- 空目录：任务 `done`、`pages[].rows=[]`、报告脚本 exit 2 且不覆盖旧报告。
- 只读校验：任务前后文件 mtime/内容不变（人工抽查）。

## 7. 输出模板（HTML 8 节）

1. 结论摘要 2. 数据口径 3. 结构分布（文件/规则/级别 + 文件解析表） 4. 风险与异常 + 缺失项 5. 优化建议 6. 限制与未决 7. 附录（任务/全量异常明细） 8. 生成信息

## 8. 异常与重试

| 现象 | 处理 |
|---|---|
| inbox 不存在 | 任务 `failed`，error 写明路径 |
| 编码/CSV 引号问题 | 当前简单解析可能误判；报告 §六 注明，真实台账需升级解析器 |
| 单文件读取失败 | 记 `unreadable` + missingItems，继续扫描其它文件 |
| 取消 | 每文件开始前检查 `ctx.isAborted()` |
| 空目录 | 任务 done；报告 exit 2，保留旧报告 |

## 9. 维护与扩展

- 换目录：改 `service/.env` 的 `INBOX_DIR`（非敏感）。
- 新增文件类型：在 `runner.js` 增加 parser 分支并同步报告规则表。
- 升级 CSV 解析：替换 `parseCsv` 为带引号/编码处理的实现，规则层不变。
- 端口/命名：改 manifest 后 `factory render`。

## 10. 待确认清单

1. 真实台账的列名/编码/分隔符是否与夹具一致（当前为 UTF-8 逗号分隔）。
2. 是否需要业务对账规则（金额与支付流水、SKU 与商品主数据）。
3. 异常阈值与告警渠道（本插件只出报告）。
