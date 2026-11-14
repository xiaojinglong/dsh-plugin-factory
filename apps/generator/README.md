# M3 生成流水线（apps/generator + packages/sdk + templates/plugin）

> 状态：**M3 流水线（fixture/本机 HTTP/真实 allowlist 范围）**。已实现 probe（allowlist/SSRF）→ 生成 → 校验 → 沙箱起服务 → 报告 → 控制面编排 + 金标 + 证据落盘；
> 真实浏览器勘探、AI 业务实现仍在后续。

## 安全

- probe allowlist：`config/probe-allowlist.json` 或 `FACTORY_PROBE_ALLOWLIST`（支持 `*.example.com`）；非本机主机解析到私网/保留地址会拒绝。
- 生成服务/报告在 **Node `--permission` 沙箱**内执行：只读仓库/staging，只写 staging；单测验证外部写被拒绝。
- 注意：权限模型不拦截网络与原生模块 I/O；生产仍需容器级网络隔离。

## 命令

```powershell
# 生成（输出到数据根 staging，或 --out 指定目录）
node apps/generator/generator.cjs generate --id demo-fixture --name "演示插件" --type api --port 0 --out D:\tmp\demo-fixture

# 校验 + 起服务预演（health → submit → done → result → dataset → report）
node apps/generator/generator.cjs validate --dir D:\tmp\demo-fixture

# 一步到位
node apps/generator/generator.cjs staging --id demo-fixture --name "演示插件" --out D:\tmp\demo-fixture

# 需求单驱动（控制面需运行；request.params 含 pluginId/name/type/fixture|apiUrl）
$env:CONTROL_PLANE_TOKEN = Get-Content .\data\control-plane\token
node apps/generator/pipeline.cjs --request req_xxx --control-plane-url http://127.0.0.1:8780

# probe 单独调用（fixture / 本机 HTTP JSON）
node -e "require('./apps/generator/probe.cjs').probe({fixture:'D:/tmp/f.json'}).then(console.log)"
```

## 产物

```
<out>/
├── plugin.json           # SDK schema 校验
├── manifest.json         # 运行 manifest（staging 绝对路径）
├── service/              # server.js + runner.js(fixture) + .env
├── mcp/                  # index.js(复制薄壳) + config.json + package.json + smoke.cjs
├── skills/<id>/SKILL.md
├── gen-report.mjs        # 8 节报告（staging 可执行，动态解析 factory-kit）
├── fixtures/data.json
└── evidence/
    ├── generation.json   # spec/manifest/语法检查
    ├── validation-static.json  # 结构/语法校验
    └── validation.json   # 预演结果/dataset/report/检查项
```

## 业务 runner 注入

DSH Agent / 人工可提供 `service/runner.js` 实现，再让流水线校验：

- CLI：`generate ... --runner <runner.js>`（或 `--runner-source` 由代码调用）。
- Pipeline：`request.params.runnerFile = <path>`；generate 时注入并静态检查（禁止 child_process/eval/new Function/vm/process.exit），随后在 Node 沙箱内 staging 执行。
- 未提供 runner 时使用 fixture 样板（明确标记 `runnerKind: "fixture"`，不得当业务实现）。

## 边界与未完成

- `runner.js` 默认是 **fixture 数据源样板**，不是业务实现；业务逻辑需由 DSH Agent/人工提供 runner 并重跑校验。
- probe 支持 fixture / 本机 HTTP / 浏览器（含 iframe）；外部主机需加入 allowlist（私网解析默认拒绝）；登录页会报"需要登录态"，需提供 storageState。
- pipeline 失败会写 `failure.json`（step/error/suggestion）；自动修复/重试仍未实现。
- 生成器会拒绝写入仓库根/受保护目录；默认输出到 `FACTORY_DATA_ROOT/generator/staging`。
