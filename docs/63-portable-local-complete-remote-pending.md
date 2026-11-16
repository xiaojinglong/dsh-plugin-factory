# 63 — Portable 自动生成：本地完成 / 远端已修复

## 本地状态

- 默认 target：`portable-host`
- 旧 MCP：显式 `target: "mcp"`
- generator：`apps/generator/portable.cjs`
- pipeline：自动生成 → 校验 → 导出 zip
- 安装：`scripts/dsh-factory.cjs`
- skill：`ctx.skills.register`
- 端到端请求：`req_20261116045146_15ce19`
- 测试：**118/118**
- doctor：全绿（legacy warn 1）

## 远端已修复

- `main`：`2f88fc5`
- tag：`v3.8.0-portable-auto`、`v3.8.1-portable-auto`
- 远端 `apps/generator/pipeline.cjs` 已验证中文正常、包含 `DEFAULT_TARGET`

## 坑：Windows credential helper

`git push` 卡住不是登录问题，是本地 `manager-core` / `wincred` helper 卡死。

绕过方式：

```powershell
git -c credential.helper= push `
  https://x-access-token:<token>@github.com/xiaojinglong/dsh-plugin-factory.git main
```

## 仍待处理

1. **公开仓库 token 暴露**
   - 主仓库公开后，manifests/deployment 中 serviceToken 可见
   - Git 历史也有旧 token
   - 这些是本地服务 token；服务绑定 127.0.0.1，但仍建议轮换或改私有
2. **真实第二台只装 DSH 的机器**
3. **CI 最终结果**（push 已触发，但网络读取不稳定）
