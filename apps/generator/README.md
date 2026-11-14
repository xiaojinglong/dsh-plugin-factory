# M3 生成流水线（apps/generator + packages/sdk + templates/plugin）

> 状态：**M3 垂直切片**。已实现"fixture 模板插件"的生成、结构/语法校验、起服务预演与证据落盘；
> 真实数据源（API/浏览器）勘探与 AI 业务实现仍在后续。

## 命令

```powershell
# 生成（输出到数据根 staging，或 --out 指定目录）
node apps/generator/generator.cjs generate --id demo-fixture --name "演示插件" --type api --port 0 --out D:\tmp\demo-fixture

# 校验 + 起服务预演（health → submit → done → result → dataset）
node apps/generator/generator.cjs validate --dir D:\tmp\demo-fixture

# 一步到位
node apps/generator/generator.cjs staging --id demo-fixture --name "演示插件" --out D:\tmp\demo-fixture
```

## 产物

```
<out>/
├── plugin.json           # SDK schema 校验
├── manifest.json         # 运行 manifest（staging 绝对路径）
├── service/              # server.js + runner.js(fixture) + .env
├── mcp/                  # index.js(复制薄壳) + config.json + package.json + smoke.cjs
├── skills/<id>/SKILL.md
├── gen-report.mjs        # 8 节报告模板（模板 import 指向最终安装位置）
├── fixtures/data.json
└── evidence/
    ├── generation.json   # spec/manifest/语法检查
    └── validation.json   # 预演结果/dataset 路径/检查项
```

## 边界与未完成

- `runner.js` 是 **fixture 数据源样板**，不是业务实现；业务逻辑需后续填充并重跑校验。
- 报告模板未在 staging 执行（其 import 指向最终 `plugins/<id>` 安装位置）；M4 安装后再跑报告。
- probe（真实 API/浏览器勘探）、生成器与需求单/控制面的自动编排、golden tickets、沙箱设计仍未完成。
- 生成器会拒绝写入仓库根/受保护目录；默认输出到 `FACTORY_DATA_ROOT/generator/staging`。
