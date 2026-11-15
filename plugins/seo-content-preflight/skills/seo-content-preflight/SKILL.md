---
name: seo-content-preflight
description: 内容发布前检查（M3 生成样板）：基于 fixture 数据源的可运行插件骨架，输出单文件 HTML 报告；业务实现需后续填充。触发词：seo-content-preflight、内容发布前检查、生成插件。
---

# 内容发布前检查（seo-content-preflight）

> 本插件由 `apps/generator` 按 M3 模板生成；当前执行层为 **fixture 数据源**，用于验证工厂生成/校验链路。

## 1. 适用场景

- 做：读取 `fixtures/data.json`，按 `limit` 参数返回样本行，生成 8 节 HTML 报告。
- 不做：不访问真实业务系统；不代表最终业务逻辑（需在 `service/runner.js` 填充）。

## 2. 前置与输入

| 项 | 值 |
|---|---|
| taskType | `seo_content_preflight` |
| serverName / 业务标识 | `seo-content-preflight` |
| 端口 | `49930` |
| 参数 | `limit`（1..fixture 行数） |
| 主产物 | `seo_content_preflight_dataset.json` |
| 报告 | `report/seo-content-preflight-report.html` |

## 3. 工具清单

submit_task / wait_task / get_task_status / get_task_result / read_result_file。

## 4. 编排流程

1. `submit_task(taskType='seo_content_preflight', params={limit})`
2. `wait_task` → `get_task_result` → `read_result_file`
3. `node gen-report.mjs <dataset.json>` 生成报告
4. 交付报告 + 样本数/限制

## 5. 分析规则

```
样本行 = pages[].rows.length
覆盖率 = 样本行 / total
```

## 6. 数据校验

- `pages[].rows` 非空；`task` 与 taskType 一致；`params.limit` 生效。
- 空数据：任务 done、报告脚本 exit 2、不覆盖旧报告。

## 7. 输出模板（8 节）

结论摘要 / 数据口径 / 结构分布 / 风险与异常 / 优化建议 / 限制与未决 / 附录 / 生成信息。

## 8. 异常与重试

| 现象 | 处理 |
|---|---|
| fixture 缺失 | 任务 failed，错误写明路径 |
| 401 | 检查服务 token |
| 空数据 | 报告 exit 2，保留旧报告 |

## 9. 维护与扩展

- 用真实数据源替换 `service/runner.js` 的 fixture 读取；保持 dataset 契约与报告 8 节。
- 改端口/命名走 manifest 与 `factory render`。

## 10. 待确认清单

1. 真实数据源/凭证/登录态。
2. 业务规则与报告口径。
3. 是否需要写操作四道闸。
