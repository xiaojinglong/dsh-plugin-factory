# DSH Plugin Factory

> 插件工厂：业务人员描述业务流程 → AI 生成可运行插件（服务 + MCP + Skill + 报告）。
> 版本 **v3.1** · 2026-11-14 · 项目根：`D:\www\dsh-plugin-factory`

---

## 一、这个项目是什么

一条把"业务描述"变成"可运行插件"的流水线：

```
业务描述（docs/21-业务描述模板.md）
   ↓  docs/20-一键造插件提示词.md（AI 执行 11 步）
插件代码（plugins/<id>/）
   ↓  platform/factory/cli.cjs（render → doctor → test → smoke）
上线（D:\www\dshskills = deployment 的 junction，DSH 加载后即可被 AI 调用）
   ↓
报告（plugins/<id>/report/*.html）
```

工厂同时管理 **8 个已上线插件**（端口 8790–8797），覆盖 API / 浏览器 / 写操作 / 视频四类场景。

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
│   ├── manifests\<id>.json    8 个插件的单一事实源
│   ├── secrets\<id>.enc       8 份 DPAPI 加密凭证
│   ├── tests\                12 个测试（契约 + runtime 集成）
│   └── README.md             平台架构与命令详解
│
├── plugins\                   ← 8 个插件项目（每个 = service / mcp / report / gen-report）
│   ├── concise-analysis\   8790（legacy 爬虫）
│   ├── listing-list\       8791   ├── shop-list\    8792
│   ├── ads-list\           8793   ├── draft-cleanup\ 8794
│   ├── stock-alert\        8795   ├── haina-comment\ 8796（写操作）
│   └── gsmp-academy\       8797（浏览器/视频）
│
├── deployment\                ← 部署区（DSH 实际加载；原 D:\www\dshskills 是它的 junction）
│   ├── skills\<id>\SKILL.md
│   ├── tools\<id>-mcp\
│   └── registry.md（由 manifest 自动生成）
│
├── factory-kit\               ← 报告工具库（report-kit / dataset）
├── data\sessions\             ← 登录态（storageState）
├── experiments\               ← 场景验证脚本（haina-test / gsmp-test）
└── archive\                   ← 历史产物（旧 reports/analysis/docs 等）
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
node cli.cjs test                 # 12 个测试用例
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

## 五、当前状态（2026-11-14）

| 项 | 状态 |
|---|---|
| 插件 | 8 个（8790–8797），全部健康 |
| MCP/Skill | 8 套，DSH 已加载（`registry.md` 自动生成） |
| 测试 | 12/12 通过 |
| 自检 | `doctor --health` 全部通过（仅 legacy 1 条 warn） |
| 迁移 | 旧 `D:\www\dshspirder` 中的工厂资产已全部迁入本目录；旧工作区仅保留无关文件 |
