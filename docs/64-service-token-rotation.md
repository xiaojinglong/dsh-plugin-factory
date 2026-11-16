# 64 — Service Token 轮换记录

## 结果

- 轮换插件：**29 个**
- 无 token：**401**
- 新 token：**200**
- `verify-service-tokens.cjs`：`ok: true, checked: 29, bad: []`
- doctor：全绿（legacy warn 1）
- 测试：**118/118**

## 重要：新 token 只在本地

- `platform/manifests/*.json`
- `plugins/*/manifest.json`
- DSH profile `cordis.patch.yml`

这三处现在含新 token，**不要提交到 public 仓库**。

公开仓库历史中的旧 token 已因轮换失效；新 token 未推送。

## 当前 DSH 需要重启

正在运行的 DSH MCP 客户端仍持有旧 token；重启 DSH 后会读取新 patch。

在重启前，当前会话里的 MCP 工具可能返回 401，这是预期状态。

## 备份

轮换备份在：

```text
data/security/token-rotation/2026-11-16T05-42-14-550Z
```

失败回滚使用同一脚本的 `restore` 逻辑。

## 脚本

```powershell
# 单插件（自动停/启/校验）
node scripts/rotate-service-tokens.cjs --apply --id <id>

# 全量：先停服务，再轮换，再启动，最后校验
node scripts/rotate-service-tokens.cjs --apply --no-restart
node platform/factory/cli.cjs up
node scripts/verify-service-tokens.cjs
```

## 以后避免泄露

- 不要把 `platform/manifests`、`plugins/*/manifest.json`、profile patch 提交到 public 仓库。
- 若要保持 git 干净，应把 token 移到 gitignored 的本地 overlay；当前未做这一层重构。
- 主仓库仍公开；历史旧 token 已失效，但不能当作完全无风险。
