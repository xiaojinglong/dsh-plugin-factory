---
name: coupon-push
description: 优惠券批量发放（模拟·写操作）：验证 dry_run 预演 / confirm_write 显式确认 / 每日额度 / idempotency_key 去重 / 逐条审计 / 限速与连续失败停止，输出单文件 HTML 审计报告。目标为本地模拟外部系统，不触碰真实平台。触发词：优惠券发放、批量发券、写操作、coupon-push、写闸门、幂等。
---

# 优惠券批量发放（模拟·写操作）Skill（coupon-push）

> ⚠️ 本插件是**工厂写操作治理验证插件**：目标是本地模拟外部系统（`data/sim-external/coupons.json`），
> **不连接任何真实优惠券平台**，不会产生真实发券副作用。

## 1. 适用场景

- **做**：按计划批量"发放"优惠券到模拟外部系统，逐条审计（店铺/券码/面额/状态/HTTP/回执/时间），输出 8 节报告；验证写操作四道闸与幂等。
- **不做**：不连接真实平台；不删券、不改价；不可回滚（真实系统需人工）。
- **默认参数**：5 条、350ms/条、单任务上限 20 条。

## 2. 前置与输入

| 项 | 值 |
|---|---|
| taskType | `coupon_push` |
| serverName / 业务标识 | `coupon-push` |
| 服务端口 | `8799`（MCP `D:/www/dshskills/tools/coupon-push-mcp`） |
| 写操作 | `runtime.write=true`：必须 `confirm_write=true`；`dry_run=true` 可预演且不占额度 |
| 凭证 | `COUPON_API_KEY`（DPAPI `platform/secrets/coupon-push.enc`，报告/日志不出现明文） |
| 可调参数 | `count`（1–20，默认 5）、`dry_run`、`confirm_write`、`rate_ms`（100–3000，默认 350）、`fail_seq`（模拟失败序号数组）、`idempotency_key` |
| 主产物 | `coupon_push_audit.json`（逐条审计） |
| 报告 | `plugins/coupon-push/report/coupon-push-report.html` |

## 3. 工具清单

| 工具 | 用途 |
|---|---|
| `submit_task` | 提交任务；写操作必须带 `confirm_write=true` |
| `wait_task` / `get_task_status` | 轮询状态 |
| `get_task_result` | 取审计 JSON |
| `read_result_file` | 解析审计 JSON |

## 4. 业务编排流程

1. 先 `dry_run=true, count=N` 预演：核对店铺/券码/面额/条数；产物 `status=planned`。
2. 用户确认后，`confirm_write=true, count=N, idempotency_key=<批次号>` 正式提交。
3. `wait_task` → 成功/失败/连续失败提前停止。
4. 读审计 JSON：`submitted / planned / skipped_duplicate / failed` 计数与逐条明细。
5. 生成报告：`node plugins/coupon-push/gen-report-coupon.mjs <dataset.json>`。
6. 交付：报告 + 成功条数 + 失败清单 + "模拟外部系统/不可回滚"限制。

### 4.5 字段校准（2026-11-14 实测·模拟外部系统）

| 项 | 结论 |
|---|---|
| 无 `confirm_write` | 服务端直接 403：`写操作被拒绝：需要 confirm_write=true`（不会入队） |
| `dry_run=true` | 入队并执行，产出 `planned`，模拟外部系统无变化，**不占每日写额度** |
| 额度 | 默认 20/日（`WRITE_DAILY_QUOTA`）；超限 429，错误文案含已用/上限 |
| `idempotency_key` | 相同键重复提交 → 200 `{deduplicated:true}` 且复用原 jobId |
| 重复业务键 | 插件内按 `shop_id:coupon_code` 去重，状态 `skipped_duplicate`（不重复写） |
| `fail_seq` | 指定序号模拟失败，连续 3 条失败自动停止（`stoppedEarly=true`） |

## 5. 分析规则（唯一口径）

```
计划 = 审计 rows.length
成功 = status == 'submitted'
预演 = status == 'planned'
幂等跳过 = status == 'skipped_duplicate'
失败 = status == 'failed'
成功口径：写入模拟外部系统并返回回执，≠ 真实平台已生效
```

## 6. 数据校验

- 写闸门：未 `confirm_write` → 403，任务不入队。
- 预演：`dry_run=true` → 全部 `planned`，模拟外部系统文件不变。
- 正式：成功数 + 失败数 + 跳过数 + 预演数 = 计划数（提前停止时 < 计划数，`stoppedEarly=true`）。
- 幂等：同 `idempotency_key` 重跑不新增任务/不重复发券。
- 审计：每条含 `key/shop_id/coupon_code/status/http_status/receipt/at`。

## 7. 输出模板（HTML 8 节）

1. 结论摘要 2. 数据口径（四道闸/额度/幂等/凭证） 3. 结构分布 4. 风险与异常（失败/跳过） 5. 优化建议 6. 限制与未决（模拟/不可回滚/待审核） 7. 附录（任务/逐条审计） 8. 生成信息

## 8. 异常与重试

| 现象 | 处理 |
|---|---|
| 403 写操作被拒绝 | 先 `dry_run=true` 预演，再带 `confirm_write=true` 正式提交 |
| 429 额度用尽 | 当日真实写已达上限；等待次日或由管理员调整额度，禁止绕过 |
| `failed` + 400/500 | 原样转述；`fail_seq` 为模拟注入，真实插件应记录站点回执 |
| 连续失败 3 条 | 插件自动停止剩余；报告注明 `stoppedEarly` 与失败清单 |
| 401 | 检查服务 token；凭证缺失 → 用 `factory secret coupon-push set COUPON_API_KEY=...` |

## 9. 维护与扩展

- 接真实平台：只替换 `service/runner.js` 中"写入模拟外部系统"一段为真实 API/页面调用；四道闸、审计、限速、停止逻辑保持。
- 改额度：`service/.env` 的 `WRITE_DAILY_QUOTA`（非敏感配置）。
- 凭证轮换：`factory secret coupon-push set COUPON_API_KEY=...`（DPAPI）。
- 端口/命名：改 manifest 后 `factory render`。

## 10. 待确认清单

1. 真实平台的"已提交 vs 待审核 vs 已生效"语义（本模拟统一为 submitted）。
2. 真实业务单任务上限与限速（当前 20 条 / 350ms）。
3. 是否需要跨任务对账（按 coupon_code 与平台后台核对）。
