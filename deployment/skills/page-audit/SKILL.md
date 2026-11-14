---
name: page-audit
description: 商品页巡检（模拟站点·浏览器型）：用 Playwright 复用 storageState 登录态，巡检多页商品的图片 alt/标题/价格/死链/重复标题，逐页截图并输出单文件 HTML 报告。站点为插件内置本地模拟站点，不访问真实业务系统。触发词：页面巡检、商品页巡检、死链检查、page-audit、浏览器巡检、截图留证。
---

# 商品页巡检（模拟站点·浏览器型）Skill（page-audit）

> ⚠️ 本插件是**工厂浏览器型链路验证插件**：站点是插件内置的本地静态模拟站点（`fixtures/` + 随机端口），
> **不登录真实系统、不访问外部网络**；真实站点需替换 `PAGES`/选择器并重跑勘探。

## 1. 适用场景

- **做**：Playwright 无头浏览器逐页巡检商品列表，检查图片 alt、标题长度、价格缺失、同源链接 404、跨页/页内标题重复；每页全页截图留证；输出 8 节报告。
- **不做**：不修改页面/商品；不绕过登录；不访问真实站点。
- **默认范围**：内置 3 页（`/index.html`、`/page2.html`、`/page3.html`）。

## 2. 前置与输入

| 项 | 值 |
|---|---|
| taskType | `page_audit` |
| serverName / 业务标识 | `page-audit` |
| 服务端口 | `8800`（MCP `D:/www/dshskills/tools/page-audit-mcp`） |
| 执行层 | Playwright Chromium（headless），`service/crawler.js` |
| 登录态 | `data/sessions/page-audit.json`（storageState）；不存在时执行模拟登录并保存 |
| 模拟站点 | 启动时监听 `127.0.0.1:0`，地址写入 `PAGE_AUDIT_BASE` |
| 可调参数 | `pages`（1–3，默认 3） |
| 主产物 | `page_audit_dataset.json` + 每页 `page-N.png` 截图 |
| 报告 | `plugins/page-audit/report/page-audit-report.html` |

## 3. 工具清单

| 工具 | 用途 |
|---|---|
| `submit_task` | 提交巡检任务 |
| `wait_task` / `get_task_status` | 轮询状态（浏览器任务较慢，MCP 超时 180s） |
| `get_task_result` | 取 dataset + 截图清单 |
| `read_result_file` | 解析 dataset（json） |

## 4. 业务编排流程

1. `submit_task(taskType='page_audit', params={pages:3})`。
2. `wait_task(taskId)`：状态 `running` 时 progress 会显示当前页。
3. `get_task_result` → `main.path`；`details` 含每页截图（`kind=detail`）。
4. `read_result_file(main.path)`：校验 `pages[].rows` 页数 = 参数、每页截图路径存在。
5. 生成报告：`node plugins/page-audit/gen-report-page.mjs <dataset.json>`。
6. 交付：报告 + 问题数（P1/P2/P3）+ 截图 + "模拟站点"限制。

### 4.5 字段校准（2026-11-14 实测·内置模拟站点）

| 项 | 结论 |
|---|---|
| 登录态缺失 | 访问 `/index.html` 被重定向 `/login.html`；点击 `#login` 后回到列表并保存 storageState |
| 登录态复用 | 第二次任务直接进入列表，`extra.sessionReused=true` |
| 数据抽取 | `table.audit tbody tr` 每行 4 列：商品/价格/素材/链接 |
| 链接检查 | 浏览器内 `fetch` 同源 GET；`/missing-page.html` 返回 404 → `BROKEN_LINK` |
| 截图 | `page.screenshot({fullPage:true})` 保存到任务目录（`kind=detail`） |
| 浏览器回收 | 空闲 `BROWSER_IDLE_MS`（默认 600000ms）后关闭；进程退出亦关闭 |

## 5. 分析规则（唯一口径）

```
巡检条目 = Σ pages[].items
问题数   = Σ pages[].issues.length（含跨页/页内 DUPLICATE_TITLE）
P1 = BROKEN_LINK
P2 = MISSING_ALT / MISSING_PRICE
P3 = SHORT_TITLE（<8 字符）/ DUPLICATE_TITLE
```

## 6. 数据校验

- `pages[].rows` 页数 = `params.pages`；每行 `items > 0`。
- 每页 `screenshot` 相对路径存在且可打开。
- 问题明细必须能回指到页面路径与商品标题。
- 登录态首次任务创建 `data/sessions/page-audit.json`；第二次任务复用。

## 7. 输出模板（HTML 8 节）

1. 结论摘要 2. 数据口径 3. 结构分布（级别/规则/页面汇总） 4. 风险与异常（逐条问题表） 5. 优化建议 6. 限制与未决 7. 附录（任务/截图/页面明细） 8. 生成信息

## 8. 异常与重试

| 现象 | 处理 |
|---|---|
| 未登录/登录态过期 | 模拟站点自动走登录；真实站点过期应 `failed` 并提示扫码更新 session（人工介入 1 次） |
| 页面无 `table.audit` | 任务 `failed`，error 说明选择器/页面结构变化 |
| 链接超时/网络错误 | 记 `linkStatus=0`，不计入 404 问题；报告注明 |
| 取消 | 页边界检查 `ctx.isAborted()`，任务 `cancelled` |
| 浏览器崩溃 | `disconnected` 后下次任务重新 launch；孤儿进程可手动结束 |

## 9. 维护与扩展

- 换真实站点：改 `service/crawler.js` 的 `PAGES`、选择器与登录流程；storageState 复用方式不变。
- 新增巡检规则：在 `scanPage` 内追加规则并同步报告 `RULE_LABEL` 与 §5 口径。
- 端口/命名：改 manifest 后 `factory render`。
- 截图保留：随任务 7 天清理（manifest `retentionDays`）。

## 10. 待确认清单

1. 真实站点是否需要 iframe/新标签页/SPA 渲染等待（本模拟为静态多页）。
2. 死链检查是否需要跟随跳转与登录墙判断。
3. 是否需要把 P1 问题接入告警（本插件只出报告）。
