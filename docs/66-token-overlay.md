# 66 — Service Token Overlay（工作区恢复干净）

## 目的

轮换后的 token 不再写进 tracked manifests，而是存到 gitignored overlay：

```text
platform/secrets/service-tokens.json
```

该目录已被 `.gitignore` 的 `platform/secrets/` 忽略。

## 实现

1. `packages/service-tokens.js`
   - `load/save/apply/get/set/setMany`
   - `apply(manifest)` 用 overlay token 覆盖内存中的 `runtime.serviceToken`

2. `platform/factory/cli.cjs`
   - `manifests()` 合并 overlay
   - `renderPatch` 用 overlay token 生成 patch
   - `up` 启动服务时注入 `SERVICE_TOKEN=<overlay token>`
   - `smoke` 同时注入 `MCP_SERVICE_TOKEN` / `SERVICE_TOKEN`

3. `apps/installer/installer.cjs`
   - `nonLegacy()` 合并 overlay，patch 校验使用新 token

4. `scripts/verify-service-tokens.cjs`
   - 读 overlay 校验 401/200

5. `scripts/rotate-service-tokens.cjs`
   - 只写 overlay，不再改 manifests
   - 备份 overlay + patch，失败可回滚

## 验证

- `git status`：**0 个 manifest 修改**
- `verify-service-tokens`：`ok: true, checked: 29, bad: []`
- 全栈 down/up 后仍全部 401/200 正确
- doctor 全绿
- 测试 **118/118**

## 结果

- public 仓库里只有失效的旧 token
- 新 token 只在本地 `platform/secrets/service-tokens.json`
- 工作区恢复干净，不会再因 `git add -A` 泄露新 token

## 注意

- 服务端读取的是 `plugins/<id>/manifest.json` 的旧 token，但 CLI 启动时 `SERVICE_TOKEN` 环境变量优先，实际用 overlay token。
- 直接手动 `node server.js` 不会注入 overlay，需要走 `factory up`。
- 新安装插件如果需要 token，仍需后续把 token 写入 overlay。
