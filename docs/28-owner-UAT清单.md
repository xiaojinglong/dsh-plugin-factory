# 28 — Owner UAT 清单（A 单机版，M2/M3/M4 一次走完）

> 目的：让 owner 在真实 DSH 环境完成一次可回滚的验收，覆盖控制面/MCP、生成流水线、accept/install。
> 前置：备份/回滚能力已具备；**不要跳过备份**。所有命令在 `D:\www\dsh-plugin-factory` 执行。

## 0. 准备

- [ ] 关闭正在使用 DSH 的会话（避免 patch 热加载冲突）。
- [ ] 记录当前 profile 与 patch 路径（安装器会打印/备份）。
- [ ] `git status` 干净；分支 `feat/prod-a-m4`（或合并后的 main）。
- [ ] 控制面可用：`npm run control-plane`（另开窗口），token 在 `<data-root>/control-plane/token`。
- [ ] `node scripts/health-check.cjs --token-file <token>` 返回 ok:true。

## 1. M1/M2：安装器 + MCP

- [ ] `apps\installer\setup.ps1 check` 通过（依赖/patch/端口提示）。
- [ ] `apps\installer\setup.ps1 install`（自动备份 patch/registry）。
- [ ] 新开 DSH 会话，确认 `factory-control` 工具出现（create_request/get_request/write_runner/accept_request 等）。
- [ ] 调 `create_request` 建一个测试需求单，`get_request` 能读到。
- [ ] 记录证据：patch 路径、工具列表截图、requestId。

## 2. M3：生成流水线

- [ ] 需求单 `params` 含 `pluginId/name/type/fixture`（先用 fixture 夹具）。
- [ ] `write_runner` 提交一个最小 runner（或先用 fixture runner）。
- [ ] `node apps/generator/pipeline.cjs --request <id>`。
- [ ] 期望：probe/generate/validate/staging 全部 succeeded；`staging` 报告 HTML 存在；请求状态 `staging`。
- [ ] 失败时读 `data/generator/runs/<id>/failure.json` 的 suggestion，按建议修复后重跑（当前无自动修复）。
- [ ] 记录证据：pipeline 输出、报告路径、validation.json。

## 3. M4：验收 + 安装

- [ ] 业务确认报告/口径后，`accept_request({acceptedBy, note})`；请求状态 `accept`。
- [ ] `plugin-install check --source <stagingDir> --root D:\www\dsh-plugin-factory` 无冲突/兼容。
- [ ] `plugin-install install --source <stagingDir> --root D:\www\dsh-plugin-factory --render`。
- [ ] 期望：smoke 通过、render 成功、manifest/plugin/MCP/SKILL 就位。
- [ ] `plugin-install verify --id <id>` ok:true；`list` 可见。
- [ ] DSH 新会话确认 MCP 工具/技能可见，调一次真实任务；报告可打开。
- [ ] 记录证据：安装输出、verify、DSH 工具截图。

## 4. 回滚/卸载（必须做一次）

- [ ] `plugin-install uninstall --id <id>`（恢复旧目录/manifest）。
- [ ] `apps\installer\setup.ps1 uninstall`（恢复 patch/registry）。
- [ ] 确认 DSH 工具消失、原 profile 恢复；`git status` 干净。
- [ ] 控制面 `backup_state` + `control-plane/restore.cjs` 演练（离线）。

## 5. 验收判据

- [ ] 全链路无手工改文件/无跳步。
- [ ] 每步有证据（requestId/step/evidence/报告路径）。
- [ ] 失败可读、可回滚。
- [ ] 未发现 token/凭证泄漏。

## 6. 已知限制（验收时不要误判为通过）

- 真实浏览器登录态/复杂 iframe 未完成。
- AI 自动写业务代码仅接口就绪，runner 由 DSH 会话/人工提供。
- 自动修复/重试未实现。
- 沙箱仅 Node 权限模型，无容器级网络隔离。
- 发布包未签名（仅 SHA-256）。
