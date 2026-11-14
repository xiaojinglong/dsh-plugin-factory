---
name: gsmp-academy
description: AI学苑课程播放与课时汇总：复用 gsmp 登录态进入 AI学堂，逐节以指定倍速播放 N 秒并采集课时标题，输出 HTML 报告（浏览器自动化）。触发词：AI学苑、课程播放、课时汇总、AI学堂、gsmp-academy。
---

# AI学苑课程播放 Skill（gsmp-academy）

## 1. 适用场景

- **做**：进入 `gsmp.giikin.com` → AI学苑（新标签页 AI学堂）→ 指定课程 → 逐节以 `speed` 倍速播放 `seconds_per_lesson` 秒 → 采集课时标题与播放结果 → 输出 HTML 报告。
- **不做**：不刷课、不伪造学习时长、不修改平台数据；仅按参数执行"播放 N 秒"并如实记录。
- **登录**：复用 `data/sessions/default.json`（storageState）；过期时人工扫码后更新该文件（唯一人工介入点）。

## 2. 前置与输入

| 项 | 值 |
|---|---|
| 入口 | `https://gsmp.giikin.com/home` → 导航「AI学苑」→ 新标签页 `https://manage.giikin.com/fe/shop/wbw/video-learning` |
| 课程 | 默认 `FDE企业AI项目实战：从需求挖掘到项目交付`（7 节） |
| 参数 | `course`、`speed`（1–4，默认 2）、`seconds_per_lesson`（2–60，默认 5）、`max_lessons`（默认全部） |
| 端口 / taskType | 8797 / `gsmp_academy` |
| 产物 | `gsmp_academy_dataset.json`（逐节：标题/状态/倍速/进度增量/时长） |

## 3. 工具清单（gsmp-academy-mcp）

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `submit_task` | 提交任务 | `taskType:"gsmp_academy"`、`params:{course,speed,seconds_per_lesson,max_lessons}` |
| `wait_task` / `get_task_status` | 等待/查询 | `taskId` |
| `get_task_result` | 产物清单 | `taskId` → `main` |
| `read_result_file` | 解析 JSON | `filePath` |

## 4. 编排流程

4.1 确认课程/倍速/时长 → 4.2 `submit_task` → 4.3 `wait_task`（约 2 分钟/7 节）
4.4 `get_task_result` → 4.5 生成报告：`cd D:\www\dshspirder\gsmp-academy; node gen-report.mjs`
4.6 输出报告路径 + 播放成功数 + 限制说明

## 4.5 字段校准（2026-11-14 实测）

- 登录态：`context.storageState` 复用即可免扫码；过期会跳 `login.dingtalk.com`，任务 failed 并提示扫码；钉钉登录前需先选组织「吉客印（郑州）数字科技」。
- AI学苑在 gsmp 首页导航中，点击是 **`window.open` 新标签页**；直接打开 `manage.giikin.com/fe/shop/wbw/video-learning` 更稳定。
- 课程页课时选择器：`.lesson-item`（7 个），文本形如 `01 Lesson 1. 工业FDE落地模糊需求拆解方法 0:00 · 可获得 5 吉豆 …`。
- 播放器：页面内 `video` 元素（mp4，`readyState≥2` 即绪）；`playbackRate=2` 生效，5 秒后 `currentTime` 前进约 9.9 秒。
- **状态污染**：播放器会覆盖课程列表，第二次点击 `.lesson-item` 会超时；必须**每节重新进入课程页**再点。
- 登录态文件：`D:\www\dshspirder\data\sessions\default.json`（由 gsmp 爬虫任务或 login-keeper 生成）。

## 5. 分析/校验规则

| 指标 | 规则 |
|---|---|
| 播放成功 | `video` 就绪且 5 秒后 `currentTime` 前进 ≈ `speed × seconds` |
| 失败 | 记录异常原因，继续下一节 |
| 报告 | 课时标题、状态、倍速、进度增量、上报时长 |
| 限制 | 每节只播 N 秒 ≠ 学完；平台学习进度/积分规则以站点为准 |

## 6. 输出模板（HTML 8 节）

一、结论摘要｜二、数据口径｜三、课时清单与播放结果｜四、状态分布｜五、失败与异常｜六、优化建议｜七、限制与未决｜八、附录

## 7. 异常与重试

| 场景 | 处理 |
|---|---|
| 登录态过期（跳钉钉） | 任务 failed，提示"扫码后更新 session 再跑"（不自动重试） |
| 课程/课时找不到 | 报错并提示检查课程名与页面结构 |
| 单节点击超时 | 已改为每节重新进入；仍失败则记录并继续 |
| 视频未就绪 | 等 30 秒；仍不就绪记失败 |
| 播放被浏览器拦截 | `muted=true` + `play()`，仍失败则记录原因 |

## 8. 维护与扩展

- 换课程：改 `params.course`。
- 换倍速/时长：改 `params.speed` / `seconds_per_lesson`。
- 完课扩展：可加 `full_play=true`（播放到 `duration` 结束）。
- 登录态刷新：人工扫码一次，或跑 `gsmp-test/login-keeper.mjs`。
- 版本：v1.0（2026-11-14，7/7 节 2x 播放 5s）。

## 9. 待确认清单

| 事项 | 当前 | 影响 |
|---|---|---|
| 播放语义 | 每节 5 秒 | 不代表完课；进度/积分可能不计 |
| 登录态时效 | storageState 复用 | 过期需人工扫码 |
| 课程范围 | FDE 课程 7 节 | 其它课程需改参数 |
| 上报时长 | 播放器 duration 可能异常 | 不作为真实时长依据 |
