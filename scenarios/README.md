# scenarios — 岗位业务场景包

每个目录 = 一个岗位流程：

```
<id>/fixture.json   本地业务数据（可替换为真实导出）
<id>/runner.js      业务规则（工厂 write_runner 同款接口）
```

## 批量跑

```powershell
# 1) 控制面
npm run control-plane

# 2) 生成/校验/staging（9 个需求单）
node scenarios/run-all.mjs

# 3) 验收 + 安装（首次 6 个，按 run-results 过滤）
node scenarios/accept-install.mjs
# 新增 3 个角色
node scenarios/accept-install-new.mjs

# 4) 启动 + 跑任务 + 生成报告
node scenarios/run-installed.mjs
```

结果：`scenarios/run-results.json`、`scenarios/scenario-results.json`；报告在 `plugins/<id>/report/<id>-report.html`。

## 注意

- fixture 为本地模拟数据，不访问真实业务系统。
- 安装/重装前先停掉对应服务，避免 Windows 目录占用导致 EPERM。
- 重新生成后要 `node apps/installer/installer.cjs repair` 把新 MCP 注入 DSH patch。
