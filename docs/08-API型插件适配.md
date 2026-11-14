# 08 · API 型插件适配（第二种形态）

> 结论：**契约层与提示词层完全复用**，只换执行层。本文说明换什么、不换什么、注意什么。

## 一、相同（零改动）

| 层 | 组件 | 说明 |
|---|---|---|
| 契约层 | MCP 薄壳 5 工具 | `submit_task / get_task_status / wait_task / get_task_result / read_result_file` |
| 契约层 | `config.json` | 字段结构一致，只改 `baseUrl`/`token` |
| 契约层 | HTTP 接口契约 | `POST /jobs`、`GET /jobs/:id`、`GET /jobs/:id/result`、`GET /health` |
| 提示词层 | SKILL.md / 节点流程.md | 业务口径、分析规则、输出模板、异常表一致 |
| 接入层 | patch 条目 | 只改 `serverName/args/cwd/env` |
| 验收层 | 20 项清单、五连冒烟 | 一致（`waiting_verify` 用例可省） |

## 二、不同（执行层）

| 项 | 爬虫型 | API 型 |
|---|---|---|
| 取数实现 | `src/crawler.js`（Playwright） | `src/fetcher.js`（fetch/axios） |
| 登录 | 扫码/SSO → `waiting_verify` | Token / API Key（header 或签名） |
| 分页 | 页面分页/虚拟滚动 | 接口 page/pageSize/游标 |
| 导出 | 页面"原样导出"下载 | 接口直接返回 JSON/CSV/直接生成 xlsx |
| 失败 | 页面超时/选择器失效 | HTTP 4xx/5xx、限流 429、签名过期 |
| 状态机 | queued→running→(waiting_verify)→done/failed | queued→running→done/failed |

## 三、实现方式（保持可替换）

1. 直接复用 `server.js / job.js / util.js`（FROZEN）。
2. 把 `crawler.js` 的 `runJob(job, ctx)` 换成 `fetcher.js` 的同名实现：
   ```js
   async function runJob(job, ctx) {
     ctx.setProgress('拉取接口数据');
     const rows = await fetchAllPages(ctx.params);          // 分页拉全
     ctx.setProgress(`整理产物（${rows.length} 行）`);
     await ctx.saveFile({ kind: 'main', fileName: '<报表名>.xlsx', content: toXlsx(rows) });
     // 明细同理：逐项 saveFile({kind:'detail', itemName, content})
   }
   ```
3. `server.js` 里 `manager.setRunner(require('./fetcher').runJob)` —— 只改这一行注入。
4. 状态机与产物登记逻辑不动。

## 四、API 型专属注意

| 项 | 要求 |
|---|---|
| Token 管理 | 只放环境变量/`config.json` 的 `token`，禁止写进仓库；支持刷新与过期提示 |
| 分页 | 明确 pageSize 上限、总条数口径；跨页按主键去重 |
| 限流 | 429 退避重试（指数 backoff），重试上限 3 次；仍失败 → failed 带可读原因 |
| 时间/时区 | 接口是 UTC 还是本地时间，必须写入口径并在报告注明 |
| 字段对齐 | 与页面/报表口径不一致时，以业务确认的为准，并在 SKILL.md「字段校准」记录差异 |
| 幂等 | 同参数重复提交：返回已有 jobId 或按业务约定去重 |
| 产物 | 非文件类（JSON/文本）也要登记为 `main`，保证 `/result.main` 可读 |

## 五、验收差异

- 不需要测：扫码、页面改版、视口尺寸。
- 必须补测：token 过期、429 限流、分页边界（最后一页/空页）、字段缺列、时间时区偏移。
- 冒烟五连不变；`waiting_verify` 用例可跳过。

## 六、判断该用哪种形态

| 条件 | 选型 |
|---|---|
| 有官方/内部 API 且鉴权可行 | **API 型**（更快更稳） |
| 只有页面、导出靠点击下载 | 爬虫型 |
| 接口有签名/风控，逆向成本高 | 爬虫型（UI 触发 + waitForResponse 拦截） |
| 两者都有 | API 优先，爬虫作兜底（同一 Skill 可挂两个 Tool） |
