# 43 — Wave 1 执行报告（5 个 A 类岗位插件）

> 日期：2026-11-15；目标：不依赖账号，先验证工厂能否把真实岗位流程稳定生产成插件。

## 1. 结果总览

| 插件 | 岗位 | 任务结果 | 报告 |
|---|---|---|---|
| `git-flow-audit` | 程序员 | 6 Issue，流程通过 2，CI 全绿 4 | ✅ |
| `boss-candidate-score` | 招聘 | 20 人，过滤后 18（90%），报告 Top15，平均分 55 | ✅ |
| `product-selection-score` | 选品 | 10 ASIN，推荐 5，排除 5，平均毛利 57.9% | ✅ |
| `ops-daily-audit` | 跨境运营 | 未回复 2、未发货 3、物流停滞 2、否定词 2 | ✅ |
| `supplier-quote-compare` | 采购 | 4 家，最低到岸价 ¥7.7，最快 8 天，推荐深圳B厂 | ✅ |

- 5/5 走完：`create_request → staging → accept → install → job done → HTML 报告`。
- 证据：`scenarios/wave1-results.json`、`scenarios/wave1-run-results.json`。
- 报告：`plugins/<id>/report/<id>-report.html`。

## 2. 业务验收点

- **Git**：1 功能=1 Issue+1 分支+1 PR+1 合并；缺验收/commit 关联/CI/合并/删分支都会被分级。
- **招聘**：年龄/薪资/求职状态硬过滤；关键词+经验评分；报告 ≥15 人且每人有链接。
- **选品**：趋势（向上/平稳/下行/季节性）+ 毛利率 + 竞争；下行/季节直接排除。
- **运营**：消息 24h、未发货、物流 >3 天、0 转化广告词、Listing 改动上限。
- **采购**：按目标量/MOQ 重算到岸总价与单价，含税/运费/交期/样品/评分。

## 3. 工厂状态

- 插件：**27 个**（12 原有 + 9 岗位 + 1 流式日志 + 5 Wave 1）。
- 测试：**102/102**（新增 5 个 Wave 1 业务回归）。
- `doctor --health`：全绿（仅 legacy 1 warn）。
- 安装/任务/报告均通过；DSH patch 已 repair。

## 4. Wave 2 / 3 阻塞项（需要你）

### Wave 2（只读登录）

- BOSS 招聘者：`storageState.json`（你手动登录后导出；不要密码）。
- 卖家中心 + 17TRACK：只读 API key 或 storageState。
- Google Trends/选品工具：CSV 导出优先；SerpAPI/工具 API key 次之。

### Wave 3（写操作）

- BOSS 打招呼：仅接受“≤10 人/次、≥30s、人工确认”，建议先只生成草稿。
- 1688 询价/样品：需单笔/单日预算审批，先做“草稿+人工发送”。
- 卖家中心回复/改价/退款：需明确可写范围、审批人、额度、回滚。

## 5. 下一步

- 你提供 Wave 2 任一账号/storageState 后，我接 `boss-candidate-collect` / `ops-tracking-audit` / `trend-fetch`。
- Wave 3 默认只做 dry-run/草稿，不自动发送/下单。
- 不提供账号时，Wave 1 这 5 个插件已可独立使用。
