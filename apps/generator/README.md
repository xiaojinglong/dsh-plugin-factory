# M3 生成流水线（apps/generator + packages/sdk + templates/plugin）

> 状态：**M3 流水线（fixture/本机 HTTP 范围）**。已实现 probe → 生成 → 结构/语法校验 → 起服务预演 → 报告 → 控制面编排 + 证据落盘；
> 真实业务 API/浏览器勘探、AI 业务实现、沙箱仍在后续。

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

## 边界与未完成

- `runner.js` 是 **fixture 数据源样板**，不是业务实现；业务逻辑需后续填充并重跑校验。
- probe 仅支持 fixture 与本机 HTTP（127.0.0.1/localhost）；公网/内网目标需 allowlist + 审批。
- AI 业务代码生成、沙箱隔离、golden tickets、失败自修复仍未完成。
- 生成器会拒绝写入仓库根/受保护目录；默认输出到 `FACTORY_DATA_ROOT/generator/staging`。
