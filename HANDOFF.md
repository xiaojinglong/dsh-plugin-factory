# HANDOFF · 新会话接手说明（AI 记忆锚点）

> 用途：新会话没有本次对话的记忆，但**读这一份 + README + platform/README + PLAN-A** 就能无缝接手。
> 更新时间：2026-11-15 · 对应版本 v3.2（A 单机版生产化基线）

---

## 1. 这是什么项目

`D:\www\dsh-plugin-factory` —— 插件工厂：业务人员描述业务流程 → AI 生成可运行插件（服务 + MCP + Skill + 报告）。
工厂同时管理 **12 个已上线插件**（端口 8790–8801）：API 6 个、浏览器 3 个、文件系统 1 个、写操作 2 个、legacy 爬虫 1 个。
A 单机版目标：下载即用，在 DSH 会话里完成"描述 → 生成 → 测试 → 安装 → 报告"；完整路线见 `PLAN-A.md`。

## 2. 接手第一件事：读这 4 份

1. `README.md` —— 项目总览与目录
2. `PLAN-A.md` / `PROMPT-A.md` —— A 单机版路线与当前生产级冲刺指令
3. `platform/README.md` —— 共享 runtime / CLI / manifest / 治理能力
4. `docs/23`、`docs/24`、`docs/25` —— 复杂场景改进 / 生产化路线 / A+B 架构

## 3. 当前状态（2026-11-15 验证）

```
12 服务全部 UP（8790–8801）
factory doctor --health → 全部通过（仅 concise-analysis legacy 1 条 warn）
factory test → 22/22 通过（原 21 + manifest 可移植性）
鉴权：v3 服务 no-token=401 / manifest token=200
```

运行命令：

```powershell
cd D:\www\dsh-plugin-factory\platform\factory
node cli.cjs status / doctor --health / up / down / watch 15 / test / smoke <id> / clean
```

## 4. 架构决策（为什么这么做，别推翻）

| 决策 | 原因 |
|---|---|
| 共享 runtime（`platform/runtime`） | 之前每插件复制 server/job/util，改一处要改 8 处；现在插件只剩 9 行 boot |
| manifest 单一事实源 | patch 与 registry 由 `cli render` 生成，禁止手改，避免漂移 |
| DPAPI 加密凭证 | `.env` 不再有明文密钥；`cli secret` 管理 |
| SQLite 任务引擎 | 重启恢复、取消、清理、指标；替代内存 Map |
| 写操作四道闸 | dry_run / confirm_write / 配额 / 审计；haina 插件为样本 |
| dshskills 用 junction | DSH 配置路径不变；真实文件在 `deployment/` |
| legacy 暂留 concise-analysis | 爬虫与页面强耦合，迁移收益低，先保稳定 |

## 5. 12 个插件速查

| id | 端口 | 类型 | 说明 |
|---|---|---|---|
| concise-analysis | 8790 | legacy 爬虫 | 经营分析（未迁 runtime） |
| listing-list | 8791 | API | 商品 listing 盘点 |
| shop-list | 8792 | API | 店铺盘点 |
| ads-list | 8793 | API | 广告活动盘点 |
| draft-cleanup | 8794 | API | 草稿清理 |
| stock-alert | 8795 | API | 缺货预警 |
| haina-comment | 8796 | 浏览器 + 写操作 | 博客评论（confirm_write） |
| gsmp-academy | 8797 | 浏览器 | AI学苑课程播放 |
| bulk-sync | 8798 | API（模拟上游） | 分页/重试/取消/空数据验证 |
| coupon-push | 8799 | API + 写操作（模拟外部） | 写四闸/额度/幂等/审计验证 |
| page-audit | 8800 | 浏览器（模拟站点） | 登录态复用/多页巡检/截图 |
| fs-ledger | 8801 | 文件系统 | 本地台账只读扫描/缺失项 |

## 6. 已知坑（踩过，别再踩）

1. **`.ps1` 必须 UTF-8 带 BOM**（PS 5.1），否则中文乱码/解析失败。
2. **PowerShell 5.1 不支持 `&&`**，用 `;`。
3. 改 patch 后要触发 MCP 重载：改结构（如 timeout）才会重启 MCP；只改注释不生效。
4. MCP 的 `node_modules` 用 junction 指向共享目录；别把 dshskills 当普通目录直接重命名（会断链）。
5. 浏览器插件会缓存浏览器实例：已加 `BROWSER_IDLE_MS`（默认 10 分钟）空闲关闭 + 退出关闭；孤儿进程可手动结束。
6. Playwright 内核：`ms-playwright\chromium*1254`；旧 1148 可删（约 500MB，确认其他工具不用后）。
7. 报告生成必须显式传本次 job 的 dataset 路径，避免"最新 job"错位。
8. 写操作插件：`dry_run` 可预演；必须 `confirm_write=true` 才提交。
9. `npm` 可能被执行策略拦截（npm.ps1），统一用 **`npm.cmd`**；**PS 5.1 不支持 `&&`**，用 `;`。
10. **路径统一走 `packages/config`**；manifest 已迁移为仓库相对路径，新增代码禁止再写 `D:/www/...`。
11. A 与 B（`D:\www\dsh-plugin-factory-bc`）的端口/profile/dshskills 已隔离：A=879x/`desktop`/`dshskills`，B=889x/`desktop-bc`/`dshskills-bc`，不要混用。

## 7. 下一步可以做什么（建议清单）

- [ ] 按 `PLAN-A.md` 完成 A 生产化 M0→M6（M0 基线已在本轮落地）。
- [ ] 把 concise-analysis 迁到共享 runtime（补齐 legacy）。
- [ ] 新增插件按 S12 流程：manifest → boot → render → doctor → test → smoke。
- [ ] 给 `factory doctor` 增加"孤儿浏览器进程"检查。
- [ ] 任务结果保留策略与磁盘清理阈值（当前 7 天）。
- [ ] 需要的话做 MCP 聚合（会改工具命名，暂缓）。
- [ ] 安装器 / 控制面 / factory-agent（见 `PLAN-A.md` M1–M3）。

## 8. 关键文件索引

| 文件 | 用途 |
|---|---|
| `README.md` / `CHANGELOG.md` | 总览 / 版本变更（v3.0 平台化、v3.1 迁移、v3.2 可靠性+12 插件） |
| `PLAN-A.md` / `PROMPT-A.md` | A 单机版完整路线 / 生产级冲刺指令 |
| `docs/23-*.md` / `docs/24-*.md` / `docs/25-*.md` | 复杂场景改进 / 生产化路线 / A+B 架构 |
| `packages/config/` | 统一路径/环境解析（FACTORY_ROOT/FACTORY_DSH_*） |
| `docs/00-工厂总览.md` | 工厂架构与完整流程 |
| `docs/20/21/22-*.md` | 一键提示词 / 业务模板 / 代码骨架 |
| `docs/14-盲测与边界测试记录.md` | 测试与迁移证据 |
| `platform/manifests/*.json` | 12 插件配置事实源（仓库相对路径） |
| `platform/secrets/*.enc` | 加密凭证（勿提交） |
| `deployment/registry.md` | 自动生成的插件登记表（由 render 生成） |

## 9. 历史会话检索说明

新会话的对话记忆是空的；本文件与仓库文档就是持久记忆。
如需查旧会话细节：`session_search` 只在"当前工作目录对应的 workspace"内检索；旧会话在 `D:\www\dshspirder` 工作区，切到新目录后可能搜不到——需要的话把关键结论补进本文件。
