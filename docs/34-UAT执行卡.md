# 34 — 本次 UAT 执行卡（owner 用，约 20 分钟）

> 目标：在真实 DSH 上跑通一次 **安装→生成→验收→安装插件→使用→回滚**，并把证据发回。
> 分支：`feat/prod-a-m4`（当前 `d9aae5c`）；工作目录 `D:\www\dsh-plugin-factory`。

## 0. 前置（5 分钟）

- [ ] 关闭正在使用 DSH 的会话（避免 patch 热加载冲突）。
- [ ] `git status` 应只看到未跟踪的 `dist/`（发布包，可忽略）。
- [ ] 另开窗口启动控制面：`npm run control-plane`（保持运行）。
- [ ] 依赖检查：`npm run deps:check`（ok:true）。
- [ ] 巡检：`npm run health-check -- --token-file .\data\control-plane\token`（ok:true）。

## 1. 安装 DSH 集成（M1/M2）

```powershell
.\apps\installer\setup.ps1 check
.\apps\installer\setup.ps1 install
```

- [ ] 安装器打印备份路径（记下来）。
- [ ] 新开 DSH 会话，确认出现 `factory-control` 工具（create_request/get_request/write_runner/accept_request 等）。
- [ ] 让 AI 调 `create_request` 建一个测试需求单，把 **requestId** 记下。

## 2. 生成流水线（M3）

需求单 `params` 至少包含：

```json
{ "pluginId": "uat-demo", "name": "UAT 演示", "type": "api", "fixture": "<仓库内一个 fixture 绝对路径>" }
```

```powershell
$env:CONTROL_PLANE_TOKEN = Get-Content .\data\control-plane\token
node apps\generator\pipeline.cjs --request <requestId>
```

- [ ] 期望：probe/generate/validate/staging 全 succeeded；请求状态 `staging`；报告 HTML 存在。
- [ ] 记录：pipeline 输出、`data/generator/runs/<requestId>/pipeline.json`。
- [ ] 如失败：读 `data/generator/runs/<requestId>/failure.json`，把 error/suggestion 发回。

## 3. 验收 + 安装插件（M4）

```powershell
# 在 DSH 里让 AI 调 accept_request（acceptedBy 用你的名字）
# 或手工 HTTP（可选）：
# POST /requests/<id>/accept {"acceptedBy":"<你>","note":"UAT"}

node apps\installer\plugin-install.cjs check --source <stagingPluginDir> --root D:\www\dsh-plugin-factory
node apps\installer\plugin-install.cjs install --source <stagingPluginDir> --root D:\www\dsh-plugin-factory --render
node apps\installer\plugin-install.cjs verify --id uat-demo --root D:\www\dsh-plugin-factory
```

- [ ] 期望：smoke 通过、render 成功、verify ok:true。
- [ ] 新开 DSH 会话，确认插件 MCP/SKILL 可见，调一次任务、打开报告。

## 4. 回滚（必须做）

```powershell
node apps\installer\plugin-install.cjs uninstall --id uat-demo --root D:\www\dsh-plugin-factory
.\apps\installer\setup.ps1 uninstall
```

- [ ] 确认插件文件/manifest、DSH 工具均消失，profile 恢复；`git status` 干净（除 dist/）。

## 5. 发回的证据

请把以下内容发我（不要发 token/凭证）：

1. `requestId`、pipeline 输出（或 pipeline.json）。
2. `install` 与 `verify` 输出。
3. DSH 工具出现/插件任务/报告截图（可打码）。
4. 回滚后的 `git status` 与 DSH 工具截图。
5. 任何失败：`failure.json` + 报错原文。

## 6. 已知限制（不要误判为失败）

- 真实浏览器登录态/复杂 iframe 未完成；fixture 模式用于本次 UAT。
- AI 自动写业务代码仅 `write_runner` 接口就绪；本次可先不写真实业务 runner。
- 自动修复/重试未实现（只有建议）。
- 沙箱仅 Node 权限模型；真实业务 API 凭证需单独流程。
