# 52 — MCP Bundle P3：生命周期预检与回滚

## 1. 新增

`bundle-mode enable` 现在做完整预检：

1. 插件部署文件存在：`deployment/tools/<id>-mcp/index.js`、`deployment/skills/<id>/SKILL.md`
2. profile 中确实安装了 `@local/<id>-mcp-bundle`
3. 服务健康；不健康则 `factory up <id>`
4. 写 marker → `installer repair`
5. 校验 patch 中旧 `mcp-<id>` 已消失
6. 任一步失败：恢复 marker 原状并重新 repair

`bundle-mode disable`：

1. 删除 marker
2. repair 恢复旧 patch
3. 失败则恢复 marker 并重新 repair

## 2. 为什么 bunde 安装仍要手工

工厂 CLI 运行在 DSH 外部，不能调用 DSH 宿主内的 `plugin_manager`。因此：

- bundle 安装/卸载必须走 DSH **Plugins** 或 `plugin_manager`
- 工厂负责：预检 profile 里是否已安装、服务启动、skill 文件、patch 移除/恢复、回滚

这比“假装一条命令装完”更安全，不会出现 marker 写了但 bundle 不存在、工具全没了的状态。

## 3. 验证

- 未安装 bundle 时执行 `enable`：直接拒绝，marker 不写、旧 patch 不变。
- 已安装 bundle 时：P2 演练已验证 enable/disable、doctor、bundle 工具真实 job、回滚。
- 当前默认状态：marker 0、旧 patch 条目 1、无重复工具。

## 4. 当前仍缺

- DSH 侧自动安装/卸载 bundle 的受控入口（需要宿主工具，不是工厂 CLI）
- 服务/skill 与 bundle 的原子性（目前是预检 + 顺序执行）
- 迁移窗口期工具短暂切换（serverName 不同）
- 失败重试/回滚的审计记录

## 5. 状态

- 30 插件、109/109 测试。
- 默认 installer 流程不变。
- 文档：`docs/49`、`docs/50`、`docs/51`、`docs/52`。
