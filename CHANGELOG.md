# CHANGELOG

## v3.2 — 2026-11-15（A 单机版生产化基线：12 插件 + 可靠性修复 + 路径可移植）

### 新增
- 4 个复杂场景插件：`bulk-sync`（API 分页/重试/取消/空数据）、`coupon-push`（写操作四闸/额度/幂等/审计）、`page-audit`（浏览器登录态/多页巡检/截图）、`fs-ledger`（文件系统只读扫描/缺失项）。
- `platform/tests/complex-scenarios.test.mjs`（9 例）+ manifest 可移植性测试；测试总数 12 → **22**。
- `A+B` 架构与生产化文档：`docs/23`、`docs/24`、`docs/25`、`PLAN-A.md`、`PROMPT-A.md`。

### 修复（可靠性）
- 鉴权 token 由 manifest 注入（此前实际未鉴权）；`doctor --health` 增加 401/200 实检。
- `dry_run` 幂等键不再触发唯一索引 500；预演不占写额度（新增 `dry_run` 列 + 旧库迁移）。
- 幂等优先于额度；`GET /jobs` 未鉴权返回 401（此前 200）。
- `factory render` 清理历史重复注释，幂等；`doctor` 增加 patch token 一致性、报告生成器存在性检查。

### 工程化
- 根 `package.json` + `package-lock.json` + `.nvmrc`（Node 24）+ GitHub Actions CI（Windows/Linux）。
- `packages/config` 统一路径解析；manifest 迁移为**仓库相对路径**（12 个）；report 生成器改为基于脚本位置解析。
- `scripts/check-syntax.mjs`（160 文件语法门禁）、`scripts/migrate-manifests.mjs`（可复跑迁移）。
- 安装器核心 `apps/installer`（check/install/uninstall/rollback/dry-run + setup.ps1 + 6 测试；M1 部分完成，未合并 main）；M2 收尾：安装器注入 `factory-control` MCP（managed block + token，自动备份/回滚），新增"安装器→patch→MCP→控制面"全链路测试。
- 本地控制面 `apps/control-plane`（8780；SQLite migration/WAL、token、需求单状态机、审计、指标、备份 + 14 集成测试；M2 代码完成）。
- `apps/factory-control-mcp`（9 个 MCP 工具 + SDK Client over stdio 端到端测试）+ `skills/factory-agent`（DSH 技能，已热加载可见）。
- M3 生成流水线：`packages/sdk`（zod 契约 + runner 静态校验）、`templates/plugin`、`apps/generator`（probe HTTP/浏览器+iframe、write_runner 桥、业务 runner 注入、generate/validate/staging、报告 staging、Node 权限沙箱、控制面 pipeline、金标、evidence）。
- `factory-control` 新增 `write_runner` 工具（DSH Agent 提交业务 runner → 控制面静态校验/落盘/更新 params）。
- probe 登录检测（登录跳转/密码框）与 pipeline 失败建议 `failure.json`（step/error/suggestion）。
- M4 验收/安装：`POST /requests/:id/accept`（staging + acceptedBy 门禁）、`apps/installer/plugin-install.cjs`（install/uninstall/rollback/smoke/备份/upgrade/list/verify/render/preflight/--dry-run）。
- M5 发布包：`scripts/package-release.cjs` + `scripts/verify-release.cjs`（npm tarball + SHA-256 + release.json，敏感路径拦截）；`release.yml` CI；`docs/26-M5分发与升级.md`；安装器 runtimeRange 兼容性检查。
- M6 硬化：控制面 POST 限流、`/health` 就绪、`restore.cjs` 备份恢复、`/admin/prune`/`prune-requests` 保留、`health-check` 巡检+webhook、`pilot-drill` 演练、`ops-backup`/`ops-schedule` 计划任务；`docs/27`、`docs/28`、`docs/29`。
- M5 分发：`install-from-release.cjs`（校验 SHA-256 + 安全解包）、`docs/30-交付说明与验收索引.md`。
- M1：安装器新增 `repair`（重放 render/注入/dshskills，幂等；无状态报错）。
- M3：probe HTTP 对 429/5xx 自动重试（默认 2 次，指数退避），提升真实数据源可靠性。
- M1：`deps-check`（Node/依赖/Playwright 浏览器/关键文件，`--fix` 仅打印命令）；`docs/31-依赖检查.md`。
- 验证：**79/79** 测试。

### 验证
- 干净克隆（M0/M1/M2/M3/M4 分支）分别 22/28/44/58/**79** 测试全绿；`doctor --health` 全绿（warn 1 legacy）；12 服务 UP；`npm audit` 0。
- 已知未完成：M1 依赖/真实机器、M2 真实 DSH UAT、M3 真实 probe/业务实现/编排、M4–M6；许可证与开源脱敏待 owner 确认；legacy 迁移脚本仍含旧绝对路径（不在产品路径）。


## v3.1 — 2026-11-14（项目整合：迁移至 D:\www\dsh-plugin-factory）

### 结构
- 工厂根目录统一为 **D:\www\dsh-plugin-factory**：docs / platform / plugins / deployment / factory-kit / data / experiments / archive。
- 8 个插件迁入 `plugins/`；部署区（skills + tools + registry）迁入 `deployment/`。
- `D:\www\dshskills` 改为指向 `deployment` 的 **junction**：DSH 配置路径不变、无需重启，真实文件全部在工厂内。

### 路径修正
- manifest / boot / fetcher / gen-report / tests / CLI 全部指向新根；
- 文档与 SKILL 中的旧路径批量替换（35 个文件）；
- registry 与 patch 由 `factory render` 重新生成。

### 修复
- 迁移导致 MCP `node_modules` 丢失：统一 junction 到共享 node_modules，7 个 MCP 冒烟全通过；
- 增补 legacy 插件 concise-analysis 的健康冒烟脚本；
- 迁移后 8 服务全部健康、`doctor` 通过、12 测试通过、live MCP 调用成功。


## v3.0 — 2026-11-14（平台化：共享 runtime + manifest + CLI + 治理）

把"能生成插件"升级为"能长期运维"：删除 9 份 server.js 副本，统一运行时与配置事实源。

### 新增（platform/）
- **共享 runtime**：`platform/runtime/`（HTTP 契约、SQLite 任务引擎、取消、清理、鉴权、写操作治理、指标、JSON 日志、API runner）。
- **单一事实源**：`platform/manifests/*.json`（8 个插件；端口/taskType/serverName/路径/凭证键/写操作）。
- **工厂 CLI**：`platform/factory/cli.cjs` — `list / doctor / render / up / down / status / watch / smoke / test / secret / port / clean`。
- **DPAPI 凭证**：`platform/secrets/*.enc`（8 份）；服务启动解密注入 env；.env 明文密钥清零（0 残留）。
- **测试门禁**：`platform/tests/`（契约 7 + runtime 集成 5 = 12 用例，全绿）。
- **自动生成**：`cordis.patch.yml` 与 `dshskills/registry.md` 由 manifest 生成（含 MCP_SERVICE_TOKEN）。

### 迁移结果
- 7 个插件迁移到共享 runtime（8791–8797），`service/server.js` 从 8KB 降至 9 行；旧实现备份 `*.legacy.js`。
- `concise-analysis`（8790）保留 legacy（爬虫代码强耦合，后续单独迁）。
- 指标：共享 runtime 1 份、boot 文件 7 个、加密凭证 8 份、明文密钥 0、测试 12 个。

### 治理能力（实测）
- 鉴权：无 token → 401；有 token → 202（smoke 三插件通过）。
- 写操作：dry_run 放行预演；无 confirm_write → 403；每日配额 + 幂等键。
- 取消：POST /jobs/:id/cancel → `cancelled`（runner 检查 isAborted）。
- 指标：`/metrics` 返回 jobsByStatus/p50/p95/queue/uptime。
- 守护：`factory watch` 轮询拉起掉线服务。

## v2.4 — 2026-11-14（浏览器复杂场景：gsmp AI学苑课程播放）

### 实测场景（用户业务描述：登录 gsmp → AI学苑 → 课程逐节 2x 播 5s → 课时汇总报告）
- 登录态：复用 storageState；过期时可见浏览器等待扫码，自动选组织后登录成功并保存新 session。
- 执行层：Playwright；AI学苑为 `window.open` 新标签页，直接 goto；课程 7 节 `.lesson-item`。
- 播放：`video.muted+playbackRate=2`，5s 后进度 +9.9s 作为成功判据；**7/7 节成功**，总进度 69.4s，耗时 123s。
- 状态污染：播放器覆盖课程列表 → 改为"每节重新进入课程页再点"，解决后续点击超时。
- 部署：8797；MCP 五连；报告 8 节；工厂自检 8 插件全绿。

### 工厂新增
- `16-浏览器复杂场景规范.md`：登录态复用/过期回退/组织选择、新标签页、iframe、视频播放与验证、SPA 状态污染、等待策略、失败语义、验收清单。
- `20` 自动决策补充"登录态"分支；`14`/`README` 同步更新。

## v2.3 — 2026-11-14（写操作 / 浏览器场景实测：haina-comment）

### 实测场景（用户业务描述：打开站点 → 登录 → 发 10 条评论 → 汇总报告）
- 站点：`http://www.hainaerp.com`（海纳技术博客，Vue SPA + Element UI）。
- 执行层：**浏览器自动化**（Playwright）+ 文章列表走公开 API（`/api/article/list`），评论走页面 UI（`POST /api/comment/create`）。
- 结果：**10/10 提交成功**（均"评论成功，等待审核"），总耗时 77 秒；审计 JSON 逐条记录；报告 8 节（含"待审核"语义）。
- 闸门验证：不传 `confirm_write` → 任务 failed（可读错误）；`dry_run=true` → 3 条 planned、站点无变化。

### 工厂新增
- `15-写操作插件规范.md`：三类执行层（API/浏览器/文件系统）、写操作四道闸（dry_run/confirm_write/审计/限速）、结果语义（submitted/pending/failed/planned）、幂等、回滚、安全红线、写操作验收清单。
- `20` 自动决策新增"读写判定"分支与硬规则；`22` 骨架覆盖浏览器型写操作。
- 插件登记：`haina-comment`（8796），工厂自检 7 插件全绿。

## v2.1 — 2026-11-14（v2 一键提示词盲测 + 6 处修复）

### 盲测结果（第 6 个插件 stock-alert，全新上下文）
- **4 分 33 秒**、0 人工介入、接口 57 秒探通、报告/部署/自检全部完成。
- 业务结论：缺货 3、低库存 1、高危 0；覆盖率双口径（34/34=100%、34/2832=1.2%）。

### 修复（提示词缺口 G1–G6）
| # | 修复 |
|---|---|
| G1 | MCP 薄壳改指向 `D:\www\dshskills\tools\listing-list-mcp\index.js`（薄壳可直接读），消除"复制实现"冲突 |
| G2 | `22` 的 `.env` 模板去掉凭证明文，改为从现有 `.env` 复制并只改 PORT |
| G3 | 明确服务依赖复用父级 `node_modules`（fastify），换目录需 `npm i fastify` |
| G4 | `patch-server.mjs` 增加替换断言（失败非 0 退出） |
| G5 | `09` probe 模板改为从 `.env` 读凭证并断言非空 |
| G6 | `12` 自检新增 §3.5：taskType 唯一性 + 各插件报告存在性 |
| 口径 | 覆盖率双口径写进 `20`；报告生成显式传本次 job 数据文件，防止并发/排队错位 |

### 现状
- 6 个插件（8790–8795）全部健康；工厂自检 `全部通过 ✅`。

## v2.0 — 2026-11-13（一键提示词：业务描述 → 插件）

目标：业务人员**只描述业务流程**，一套提示词完成插件生成。

### 新增入口（业务人员默认使用）
- `20-一键造插件提示词.md`：单份主提示词，内嵌自动决策（路径/形态/命名/端口/采样/报表）、11 步流水线、12 条硬规则、停手条件、输出格式与时间盒。
- `21-业务描述模板.md`：8 行填空模板 + 3 个示例 + "最常漏的 3 项默认值"。
- `22-插件生成代码骨架.md`：api-runner/fetcher/报告/SKILL/config/patch/registry/冒烟 全部内联骨架，**不再依赖抄现有插件**。

### 变更
- README 默认入口改为 `20/21/22`；`00` 降级为"多插件编排/进阶"。
- 主提示词内嵌两次盲测的全部坑：报告取数路径、jobId/取数时间、空数据守卫、库存口径唯一、`&&`→`;`、BOM、registry 端口、MCP 两处改名。
- 盲测验证：见 `14-盲测与边界测试记录.md`（v2 盲测结果）。

## v1.2 — 2026-11-13（盲测 + 边界测试 + 使用手册）

### 边界测试：8 项，修复 3 个缺陷
| # | 缺陷 | 修复 |
|---|---|---|
| D1 | 空数据会静默覆盖正常报告 | 3 个报告生成器加守卫（`rows=0 → exit 2`，保留旧报告）；契约 §5 |
| D2 | ps1 无 BOM 在 PS 5.1 下乱码崩 | 补 BOM；文档注明执行方式 |
| D3 | patch/config 无自动一致性校验 | 新增 `12-工厂自检.ps1` |

测试覆盖：空数据、非法日期（100400 透传）、参数类型归一化、`pages` 截断（99→10）、`pageSize` 生效、并发排队、4 服务共存、命名/patch/端口一致性。

### 新增资产
- `12-工厂自检.ps1`：技能/MCP/patch/端口/健康 一键自检（实跑全绿）。
- `13-业务人员使用手册.md`：业务人员主文档（准备/路径/5 步操作/话术/验收/FAQ/红线）。
- `14-盲测与边界测试记录.md`：测试证据与缺陷记录。
- `10-标准产物契约.md` §5/§6：空数据规则、错误透传规则。

### 盲测
- **通过**：全新上下文 agent 只读 3 份文档 + 参考实现，**4 分 18 秒**独立造出第 4 个插件 `draft-cleanup`（8794），0 人工介入，一次接口探通，报告与部署全部完成。
- 暴露 6 条文档缺口，已全部补齐：api-runner 位置/版本、报告取数路径（三级回退）、params 透传、热加载验证方法、probe 模板 + 枚举/类型漂移、报告 8 节骨架；另补清理类业务双层口径、开发副本 vs 运行副本。
- 详见 `14-盲测与边界测试记录.md`。

### 第二次盲测（业务人员只读使用手册）
- 结论：**只靠手册不能独立完成**，暴露 5 个问题，已全部修复：
  1. 手册缺"跑已有插件"的 5 步 → 新增路径 A + 插件/参数/产物/命令对照表；
  2. 报告命令读旧数据 → 报告脚本支持 `[dataset.json]` 入参 + 自动取最新 job（`factory-kit/dataset.mjs` 接入 4 个生成器），页眉加任务/取数时间；
  3. 库存口径矛盾（90 vs 112）→ 统一总库存公式并写入 §二，重出报告后 22→23 自洽；
  4. `&&` 在 PS 5.1 报错、pm2 未装且路径错 → 改 `;`、修正路径、给替代方案；
  5. `shop_user_id` 不生效的误导 → FAQ 更正为 `shop_user_name`。
- 手册升级为 v1.1。

## v1.1 — 2026-11-13（批量生产试点）

用同一套工厂流程在**同一数据源（api.giikin.com）**上连做 3 个插件，验证"批量"能力。

### 试点结果

| 插件 | 接口 | 样本 | 耗时（接口探通后） | 人工介入 | 返工 |
|---|---|---|---|---|---|
| listing-list | listing/listing | 2 页 34 条 | ~10 min | 0 | 1（产物形状） |
| shop-list | shop/list | 2 页 200 家 | ~7 min | 0 | 1（import 路径） |
| ads-list | ads/list | 2 页 32 活动 | ~8 min | 0 | 0 |

累计 ≈ 25 分钟（不含首次接口勘探约 40 分钟；勘探已固化为清单）。

### 新增资产（针对试点暴露的缺口）

- `09-API接入勘探清单.md`：把"试主机 / 鉴权 / 参数黑名单 / 分页 / 字段"固化为 10 分钟动作。
- `10-标准产物契约.md`：统一 dataset.json 形状，杜绝报告层返工。
- `11-环境预检.ps1`：解决 EPERM / 端口占用 / 依赖缺失三类开工阻塞。
- `factory-kit/report-kit.mjs`：共享报告套件（shell/table/distTable/bar），3 个报告风格统一。

### 架构沉淀（V2 规则）

- 同一数据源多业务共用执行层模板（`api-runner.js` + 每任务 `fetcher.js` 配置）。
- 每个业务 = 1 MCP + 1 Skill + 1 端口；MCP 代码完全相同，用 Junction 复用 node_modules。
- MCP/Skill 部署在 `D:\www\dshskills`；执行层随数据源部署；两者通过 registry 对齐。

### 本次踩坑与修复

| # | 坑 | 修复落点 |
|---|---|---|
| 1 | 数据源主机搞错（openapi ≠ api） | `09` 第 1 节 |
| 2 | `shop_user_id` 被静默忽略 | `09` 第 2 节（参数三清单） |
| 3 | 数据集形状与报告脚本不一致 | `10` 产物契约 |
| 4 | `api-runner.js` 复制遗漏 | `11` 预检 + V2 规则 1 |
| 5 | import 相对路径算错（多一层） | `10` 报告层写法示例 |
| 6 | Windows Junction 复用 node_modules | `09`/`CHANGELOG` |

## v1.0 — 2026-11-13

首次整理「插件工厂」：把原 9 步流程补齐为 13 步，修复 14 个缺口。

### 新增资产
- `00-总控提示词.md`：串起 13 步 + 4 个门禁，业务人员只发它。
- `04-字段校准回填提示词.md`：解决"先写死 SKILL.md 再跑爬虫必然返工"的顺序问题。
- `05-MCP装配与冒烟.md`：三处一致性校验（config/.env/patch）+ 冒烟五连 + 配置四条校验。
- `06-验收与排障手册.md`：20 项发布清单 + 业务验收三段 + 四层排障路由。
- `07-一页版SOP.md`：业务人员桌面版（3 个人工动作）。
- `08-API型插件适配.md`：第二种形态，契约与提示词层零改动。
- `templates/`：SKILL/节点流程空模板、config.json、两段式 patch、registry、verify-mcp.ps1、run-flow 修订版。

### 修订
- `01`（原 gen-skill-struct）：明确"只出空模板"，消除与 init.ps1 的矛盾；新增依赖安装降级、registry 登记、四者命名一致校验。
- `02`（原 gen-skill-docs）：新增阶段 E 实测回填；工具清单支持多数据源分组；补充 `missingItems` 对象结构约定。
- `03`（原 gen-spirder 实例）：改为"模版填写台 + 两档验收（MVP/完整）+ 交付物清单"，新增周期参数、端口一致性、服务常驻、日志落盘要求。
- `templates/run-flow-修订版.md`：替换已过期的 run-flow（原版写 `~/.dsh/skills` 复制 + PascalCase serverName）。

### 已知待办
- [ ] 把 `03` 真正拆成"模版 v10 + 实例"两份文件（当前引用现有模版）。
- [ ] 补一个 `init-skill.ps1` 一键骨架脚本（对齐 `01` 的目录与空模板要求）。
- [ ] `verify-mcp.ps1` 增加"五连完整版"（自动轮询 jobId 到 done）。
