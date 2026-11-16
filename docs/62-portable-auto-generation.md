# 62 — 工厂自动生成 Portable 插件验收

## 需求单

- requestId：`req_20261116045146_15ce19`
- target：`portable-host`
- pluginId：`portable-demo-auto`
- fixture：`scenarios/api-status-mark/fixture.json`
- tool：`portable_demo_auto`

> 默认策略已切换：pipeline 未显式给 `target` 时，新需求默认 `portable-host`；旧 MCP 流程必须显式 `target: "mcp"`。

## Pipeline

```text
probe → generate → validate → staging(export) → accept → install
```

全部 succeeded，最终状态 `installed`。

生成目录：

```text
data/generator/runs/req_20261116045146_15ce19/portable-demo-auto/
  package.json
  cordis.patch.yml
  index.js
  lib/impl.js
  fixtures/data.json
  skills/portable-demo-auto/SKILL.md
  docs/DETAIL.md
  locale/en.json
  icon.svg
  README.md
  LICENSE
```

导出：

```text
data/generator/runs/req_20261116045146_15ce19/dist/portable-demo-auto-0.1.0.zip
```

## 安装与调用

```text
dsh-factory install <zip>
→ composed: true
→ plugin_manager / DSH 显示 portable-demo-auto skill
→ portable_demo_auto 返回 total=5
```

结果：

```json
{"total":5,"input_path":".../fixtures/data.json"}
```

## 证明

- 工厂 pipeline 已能自动生成 **portable-host** 插件，不再依赖手写 `portable-plugins/`。
- 生成物无服务、无端口、无工厂路径、无 token。
- 自动注册工具 + skill。
- 生成后自动导出 zip。
- 安装后工具真实执行。

## 当前限制

- 默认模板是 fixture 行数统计；自定义逻辑可通过 `implFile/implSource` 注入。
- 30 个旧插件仍冻结在 T0，不迁移。
- 一条命令安装后需重开 DSH 才生效（profile 已写入，`composed: true`）。
- 真实第二台机器与公开仓库 token 问题另算。
