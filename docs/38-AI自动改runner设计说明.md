# 38 — “AI 自动改 runner”设计说明（A 单机版，暂未实现）

> 目的：讲清楚这个能力到底是什么、怎么做、需要什么；未经确认不实现。
> 现状：只有 **失败建议 + probe 瞬态重试**；没有自动改代码。

## 1. 它是什么

流水线生成的是可运行骨架 + fixture runner。真实业务逻辑在 `service/runner.js`。
“AI 自动改 runner”= validate/staging 失败后，由模型读取失败证据，**自动修改 runner 源码**，再走 `write_runner` → 重新 validate/staging，最多 N 次，最后仍由人 accept。

## 2. 闭环步骤（设计）

```
pipeline 失败
  → 读 failure.json / validation checks / probe 结果 / 当前 runner
  → 失败分类（schema/语法/数据/业务规则/权限/超时）
  → 模型生成“最小 diff”或完整 runner.js
  → 静态检查（business.cjs：禁 child_process/eval/vm/process.exit）
  → write_runner 落盘
  → 新 request 或 repair 步骤重跑 probe→generate→validate→staging
  → 成功：evidence + 人工 accept；失败：最多重试 2 次，保留每次 diff/证据
```

## 3. 需要补的东西

| 项 | 说明 |
|---|---|
| 状态机 | 当前 failed 是终态；需要允许 repair 生成新 request，或增加 repair 步骤（不破坏审计） |
| 模型接入 | 需要模型 API/网关、key、限流/成本上限；不能把 token/业务数据泄露给未授权模型 |
| Prompt/模板 | 输入失败证据 + 插件 spec + 数据样例；输出只允许 runner.js/diff |
| 沙箱 | 现状 Node `--permission`，无容器网络隔离；AI 代码风险更高，必须先补网络/资源隔离 |
| 静态门禁 | 现有禁止项 + 新增“只改 runner.js”路径白名单、大小限制 |
| 人工门禁 | 自动修改后必须人工 review + accept；不得自动 install |
| 测试 | mock 模型输出做单元测试；真实模型做 1–2 个灰度用例 |

## 4. 为什么现在不做

- 没有模型 API/凭证；无法真实闭环，做假接口会变成“假装完成”。
- 自动改代码需要更强沙箱/审计；当前 Node 权限模型不拦截网络与原生模块 I/O。
- 失败重试状态机需要重新设计，避免把 failed 请求偷偷改回运行中。

## 5. 建议的下一步（若要做）

1. 你提供模型网关（OpenAI/DeepSeek/内部）+ 预算上限。
2. 先做“**建议模式**”：模型只输出 diff + 解释，不自动写。
3. 灰度“自动写 runner”只对失败分类为 schema/语法/小改动的场景，最多 2 次。
4. 全量保留 diff/证据；人工 accept 后才 install。
