# DSH Plugin Factory

> 插件工厂：业务人员描述业务流程 → AI 生成可运行插件（服务 + MCP + Skill + 报告）。
> 版本 **v3.13.2** · 2026-11-17 · 只保留工厂，不内置插件产品

---

## 零、一条命令安装（新用户）

前置：Node.js >= 24、已安装 DSH。

```powershell
git clone https://github.com/xiaojinglong/dsh-plugin-factory.git
cd dsh-plugin-factory
install.cmd
```

`install.cmd` 会安装依赖、Chromium、DSH 集成，启动控制面并自检。完成后重开 DSH 即可使用。  
工厂不内置旧插件；需要时用 `factory-agent` 现场生成。

日常启动/停止：`start-factory.cmd` / `stop-factory.cmd`。Linux/macOS 用 `./install.sh`、`./start-factory.sh`、`./stop-factory.sh`。

---

## 一、这个项目是什么

一条把"业务描述"变成"可被 AI 调用的业务动作"的流水线：

```
业务描述（docs/21-业务描述模板.md）
   ↓  factory-agent / docs/20-一键造插件提示词.md
生成插件包（data/generator，运行时产物，不提交）
   ↓  create_plugin → validate → staging → zip
安装到 DSH（插件包安装，AI 可调用）
   ↓
输出（按插件类型）
   ├─ 查询/分析：dataset + HTML 报告（可选）
   ├─ 写 API：变更回执 + 审计
   ├─ 状态标记：状态流转记录
   ├─ Excel/文件：新文件 + diff
   └─ 发消息：发送回执 + 失败重试
```

> **报告不是目的，只是查询/分析类插件的一种可选产物。**
> 写操作/消息/文件类插件的核心输出是“变更结果 + 审计 + 可回滚”，不是 HTML。

工厂只负责生产，不内置插件产品。旧 30 个插件已移除；当前以 **portable 插件生成 + 对话式交付** 为主。

---

## 二、目录结构

```
D:\www\dsh-plugin-factory\
├── README.md                  ← 本文件（项目总览）
├── CHANGELOG.md               ← 版本与变更记录
│
├── docs\                      ← 工厂"怎么做"：提示词/规范/手册/测试记录
│   ├── 00-工厂总览.md          架构与全流程
│   ├── 20-一键造插件提示词.md   ★ 业务人员主入口（发这一份）
│   ├── 21-业务描述模板.md       ★ 业务描述填空模板
│   ├── 22-插件生成代码骨架.md   ★ 生成用代码骨架
│   ├── 09/10/15/16-*.md        勘探清单 / 产物契约 / 写操作 / 浏览器规范
│   ├── 13-业务人员使用手册.md   使用、验收、排障
│   ├── 14-盲测与边界测试记录.md 测试证据
│   └── 11/12-*.ps1             环境预检 / 旧版自检
│
├── platform\                  ← 工厂"怎么跑"：共享运行时 + CLI + 单一事实源
│   ├── runtime\               任务引擎(SQLite)/鉴权/写操作治理/指标/日志/API runner
│   ├── factory\cli.cjs        ★ 统一命令入口
│   ├── factory\bootstrap.js   插件启动入口（env + DPAPI 注入）
│   ├── manifests\             旧产品清单已移除；目录保留为空（portable 工厂不依赖）
│   ├── secrets\<id>.enc       DPAPI 加密凭证
│   └── tests\                 133 个测试（工厂核心 + 生成 + 安装 + 控制面 + MCP + portable + 场景）
│
├── packages\config\           ★ 统一路径/环境解析（FACTORY_ROOT / FACTORY_DSH_*）
├── packages\sdk\              ★ 生成插件契约（zod PluginSpecSchema）
├── apps\installer\            ★ 安装器（check/install/uninstall/rollback + factory-control 注入 + M4 plugin-install）
├── apps\control-plane\        ★ 本地控制面（8780；需求单/步骤/审计/指标/备份/accept；M2/M4 代码完成）
├── apps\factory-control-mcp\  ★ factory-control MCP（stdio 薄壳，9 工具）
├── apps\generator\            ★ M3 生成流水线（probe HTTP/浏览器、业务 runner 注入、staging/沙箱/编排）
├── .dsh\skills\factory-agent\ ★ DSH 工厂 Agent 技能（deployment 为发布副本）
├── templates\plugin\          ★ 插件脚手架模板（M3 fixture 垂直切片）
├── PLAN-A.md / PROMPT-A.md    A 单机版路线 / 生产级冲刺指令
│
├── deployment\                ← DSH 部署区（当前只保留 factory-agent 技能）
│   └── skills\factory-agent\
│
├── factory-kit\               ← 报告工具库（report-kit / dataset）
├── data\sessions\             ← 登录态（storageState）
├── data\generator\            ← 运行产物（不提交；zip 在 runs/<requestId>/dist）
```

> `D:\www\dshskills` 现为指向 `deployment` 的 junction，因此 DSH 配置里的
> `D:/www/dshskills/...` 路径无需修改、继续生效；**真实文件都在本工厂内**。

> **新会话接手先读 [`HANDOFF.md`](HANDOFF.md)**：项目现状、架构决策、已知坑、下一步清单。

---

## 三、快速开始

```powershell
cd D:\www\dsh-plugin-factory\platform\factory

node cli.cjs list                 # 插件清单
node cli.cjs status               # 8 个服务在线状态
node cli.cjs doctor --health      # 自检（配置/路径/端口/凭证/健康/报告）
node cli.cjs up / down            # 启停全部
node cli.cjs watch 15             # 守护：掉线自动拉起
node cli.cjs smoke <id>           # 单插件 MCP 五连冒烟
node cli.cjs test                 # 133 个测试用例
node cli.cjs clean                # 清理过期任务目录
node cli.cjs secret <id> set K=V  # 凭证加密保存（DPAPI）
```

**造新插件**：填 `docs/21-业务描述模板.md` → 发 `docs/20-一键造插件提示词.md` →
按提示词完成 S12（manifest → render → doctor → test → smoke）。

---

## 四、迭代约定（重要）

1. **只在本目录迭代**：以后改提示词、加插件、升级 runtime 都在 `D:\www\dsh-plugin-factory` 内完成。
2. **单一事实源**：端口/taskType/serverName/路径/凭证键都写在 `platform/manifests/<id>.json`；
   patch 与 registry 由 `cli.cjs render` 生成，禁止手改。
3. **凭证不落明文**：用 `cli.cjs secret` 写 DPAPI；`.env` 只放非敏感配置。
4. **验收门禁**：`render → doctor --health → test → smoke` 全绿才算完成。
5. **文档命名**：`docs/` 下按功能分：00/01–08 流程提示词、09/10/15/16 规范、13/14 手册与测试、20/21/22 主入口。

---

## 五、当前状态（2026-11-15）

| 项 | 状态 |
|---|---|
| 插件 | **0 个内置产品**；工厂按需生成，插件包不提交 |
| MCP/Skill | 只保留 `factory-agent` 技能；旧 30 套已移除 |
| 测试 | **133/133** 通过 |
| 自检 | `doctor --health` 通过（旧产品清单可为空） |
| 交付 | `main` + tag `v3.13.2-no-legacy-products` |
| 真实 UAT | DSH 安装/MCP/pipeline/accept/install/回滚已跑通（`docs/35`） |
| 岗位场景 | 9 岗位 + 流式日志 + Wave 1 5 个 + 趋势选品 + 2 动作型：见 `docs/39/43/44/47/48` |
| 动作型 | `excel-status-mark`（改 Excel）+ `api-status-mark`（调 API，dry_run/confirm/回执）；报告可选 |

## 六、License

本项目使用 **Apache License 2.0**，见 [`LICENSE`](LICENSE) 与 [`NOTICE`](NOTICE)。

