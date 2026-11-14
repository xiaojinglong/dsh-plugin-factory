---
name: haina-comment
description: 海纳技术博客文章评论自动化：登录站点→取文章列表→按计划发表评论→逐条审计并输出汇总 HTML 报告（写操作，需 confirm_write 确认）。触发词：海纳评论、文章评论、批量评论、评论汇总、haina-comment。
---

# 海纳博客文章评论 Skill（haina-comment）

## 1. 适用场景

- **做**：登录 `http://www.hainaerp.com` → 拉取文章列表 → 按计划给文章发表评论 → 逐条记录审计 → 输出评论汇总 HTML 报告。
- **不做**：不审核评论、不删评论、不改文章；不绕过站点风控。
- **边界**：**写操作**。默认 `dry_run` 预演；真正提交必须显式 `confirm_write=true`。
- 账号：服务端 `.env` 的 `HAINA_EMAIL` / `HAINA_PASSWORD`，报告只显示脱敏账号。

## 2. 前置与输入

| 项 | 值 |
|---|---|
| 站点 | `http://www.hainaerp.com`（海纳技术博客） |
| 登录 | 页面登录弹窗（邮箱+密码）；成功后 `localStorage.user_token` 有值 |
| 文章列表 | `GET http://api.hainaerp.com/api/article/list?page=1&per_page=20` |
| 评论提交 | `POST http://api.hainaerp.com/api/comment/create`（body: `article_id/content/nickname`） |
| 端口 / taskType | 8796 / `haina_comment` |
| 参数 | `max_comments`（默认 10，≤20）、`dry_run`（默认 false）、`confirm_write`（必须 true 才提交） |
| 审计产物 | `haina_comment_audit.json`（逐条：文章/内容/状态/HTTP/回执/时间） |

## 3. 工具清单（haina-comment-mcp）

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `submit_task` | 提交任务 | `taskType:"haina_comment"`、`params:{max_comments,dry_run,confirm_write}` |
| `wait_task` / `get_task_status` | 等待/查询 | `taskId` |
| `get_task_result` | 产物清单 | `taskId` → `main` |
| `read_result_file` | 解析审计 JSON | `filePath` |

## 4. 编排流程

4.1 确认计划（条数/是否预演）→ 4.2 先 `dry_run=true` 预演 → 4.3 业务确认后 `confirm_write=true` 正式跑
4.4 `get_task_result` 取审计 JSON → 4.5 生成报告：`cd D:\www\dshspirder\haina-comment; node gen-report.mjs`
4.6 输出报告路径 + 提交成功数 + 待审核说明

## 4.5 字段校准（2026-11-14 实测）

- 登录：点击页头【登录】→ 弹窗 `input[placeholder*=邮箱]` + `input[type=password]` → `.el-dialog button.el-button--primary`；成功判据 `localStorage.user_token` 非空。
- 文章卡片：首页 `.article-card` / 热门 `.hot-article` 为 SPA 点击（无 href）；详情 URL = `/article/<encodeURIComponent(slug)>`（slug 来自文章列表接口）。
- 评论框：`textarea[placeholder*="评论"]`；提交按钮文案 `发表评论`。
- 提交结果：`POST /api/comment/create` 返回 `{"code":200,"message":"评论成功，等待审核"}`；站点有审核，**提交成功 ≠ 立即展示**。
- 限制：评论默认 20 条/页；文章列表接口前 20 篇；每条评论间隔 2.5–4 秒。

## 5. 分析/汇总规则

| 指标 | 规则 |
|---|---|
| 计划数 | `max_comments` |
| 成功数 | `status=submitted`（HTTP 200 且回执含"评论成功/等待审核"） |
| 失败数 | `status=failed`（记录错误与 HTTP 状态） |
| 覆盖文章数 | 按 `article_id` 去重 |
| 连续失败停止 | 连续 3 条失败即停止剩余 |

## 6. 数据校验

- 审计条目数 = 计划数（或提前停止时的实际数）。
- 每条含 `article_id/content/status/http_status/message/at`；缺字段即报错。
- 报告中账号必须脱敏（`791***@qq.com`）。

## 7. 输出模板（HTML 8 节）

一、结论摘要｜二、数据口径｜三、执行明细（逐条审计）｜四、按文章汇总｜五、失败与异常｜六、优化建议｜七、限制与未决｜八、附录

## 8. 异常与重试

| 场景 | 处理 |
|---|---|
| 未传 `confirm_write` | 任务 failed，提示先 `dry_run` 再确认（保护生效） |
| 登录失败（无 user_token） | 检查账号/页面结构；不重试写操作 |
| 单条提交失败 | 记录并继续；连续 3 条失败即停止 |
| 评论待审核 | 报告中说明"提交成功、待审核"，不承诺展示 |
| 站点改版 | 更新 §4.5 选择器后再跑 |

## 9. 维护与扩展

- 换账号：改服务端 `.env`（勿写进仓库）。
- 换站点/文章源：改 `crawler.js` 中 `HOME` / `ARTICLE_API` / 选择器。
- 频率：保持每条 2.5–4 秒；`max_comments ≤ 20`。
- 版本：v1.0（2026-11-14，实测 10/10 提交成功）。

## 10. 待确认清单

| 事项 | 当前取值 | 影响 |
|---|---|---|
| 评论审核 | 站点审核后展示 | 报告只证明提交成功 |
| 内容治理 | 测试评论带"（自动化测试评论）" | 正式业务需换文案 |
| 文章范围 | 接口前 20 篇 | 可扩展 article_ids |
| 账号权限 | 用户账号（非管理员） | 不能审核/删除 |
