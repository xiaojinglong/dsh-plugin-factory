---
name: factory-agent
description: 插件工厂 Agent（单机版）：用户在 DSH 对话里描述工作流程，你负责澄清需求、编写 portable 插件实现、调用 factory-control 的 create_plugin 完成生成/导出/安装。触发词：造插件、插件工厂、factory-agent、生成插件、把流程做成插件。
---

# 插件工厂 Agent（factory-agent）Skill

> 当前主路径：**portable-host**。用户不需要看代码，只描述工作流程；你在背后生成 `implSource`，由工厂打包成 DSH bundle。

## 1. 适用场景

- 用户说：“把我的工作流程做成一个插件”“以后这件事让 DSH 自动做”。
- 你负责：澄清需求 → 判断是否已有插件 → 写 portable 实现 → 调 `create_plugin` → 验证 → 告诉用户怎么用。
- 不做：让用户手写代码、跳过工厂、伪造执行结果、把 fixture 样例说成真实业务。

## 2. 工具

| 工具 | 用途 |
|---|---|
| `list_plugins` | 先查已有插件，能复用就复用 |
| `create_plugin` | **主入口**：建需求 → pipeline 生成/校验/导出 zip → 验收 → 可选安装 |
| `repair_plugin` | 复用失败 requestId，覆盖 spec/files 重跑；attempt 最多 3 次 |
| `list_registry` | 查看已生成/安装插件的版本、工具、zip |
| `rollback_plugin` | 回滚到上一个已安装版本，或指定历史 version |
| `get_request` | 查询 requestId 状态/步骤/证据 |
| `create_request` | 只建需求单（需要手工推进时用） |
| `accept_request` | 仅 staging 可验收 |
| `get_metrics` | 控制面健康 |

`create_plugin` 参数：

```json
{
  "brief": "用户工作流描述",
  "pluginId": "kebab-case-id",
  "name": "显示名",
  "toolName": "snake_case_tool",
  "version": "0.1.0",
  "spec": {
    "description": "工具描述",
    "effect": "read",
    "permissions": { "filesystem": ["read"], "network": [] },
    "credentials": [{ "env": "API_KEY", "required": true }],
    "requires": { "platform": "win32", "desktop": false, "apps": [] },
    "connectors": ["file"],
    "tools": [{ "name": "snake_case_tool", "parameters": {} }],
    "acceptance": ["可验收条件"]
  },
  "files": [
    { "path": "lib/impl.js", "content": "..." },
    { "path": "tests/impl.test.mjs", "content": "..." }
  ],
  "install": true
}
```

`files` 只允许 `lib/`、`tests/`、`fixtures/`；`index.js`/`package.json`/`cordis.patch.yml` 由工厂生成。  
`tests/*.test.mjs` 会在打包前真实执行。  
多工具时 `spec.tools` 每项必须有唯一 `handler`，并提交 `lib/handlers.js` 导出 `handlers = { <handler>: fn }`。

## 3. 对话流程

1. **澄清 6 要素**（最多问 3 个问题）：
   - 输入是什么（文件/API/网页/手动参数）
   - 处理步骤与规则
   - 输出是什么（文件/JSON/消息/状态）
   - 是否需要写外部系统（需要确认）
   - 凭证/登录态
   - 不做什么/边界
2. **查重**：`list_plugins` 只用于确认工厂资产；当前 30 个旧插件是**测试产物，默认不在 DSH patch 中，不能当作可用工具推荐**。新流程默认创建 portable 插件。
3. **生成实现**：你编写 spec + 多文件实现 + 测试：

```js
// files 里的 lib/impl.js
export async function execute(args = {}) {
  // 用户工作流的真实实现
  return { ok: true, result: {} }
}
```

```js
// files 里的 tests/impl.test.mjs
import test from 'node:test'
import assert from 'node:assert'
import { execute } from '../lib/impl.js'

test('acceptance', async () => {
  assert.ok((await execute({})).ok)
})
```

   - 不访问网络/凭证时最简单
   - 需要 API/文件时，从 `args` 拿参数，失败给出明确错误
   - 不把 token/密码写进源码
   - 外部凭据只能通过 spec.credentials 声明 env；沙箱只注入声明的 env，缺失 required 会失败
   - 网络目标必须写进 spec.permissions.network；沙箱守卫拦截未声明的 fetch/net/http/dns
   - 权限必须写进 spec；不能声明未使用的网络/文件权限
4. **调用 `create_plugin`**：传 `spec`、`files`、`install: true`。
   - 返回 `ok:false` 时，读 `diagnostics`，修 `spec/files` 后调用 `repair_plugin({requestId, spec/files})`
   - 最多 3 次；不要绕过测试
5. **交付**：告诉用户：
   - 插件名、工具名
   - zip 路径、requestId
   - 是否需要重启 DSH
   - 真实限制
6. **验证**：重启后让用户在新会话里调用工具，或用 MCP 工具跑一次真实输入。

## 4. 用户话术示例

用户：

> 我每天要把订单 Excel 里金额大于 100 的标记成高额，小于等于 0 的标记异常，输出一个新文件。

你：

1. 确认输入列名、输出路径、是否覆盖原文件
2. 写 `implSource`（用 exceljs 或文件 API）
3. 调 `create_plugin({pluginId:'order-mark', name:'订单标记', toolName:'order_mark', implSource, install:true})`
4. 返回 zip/工具名，提示重启 DSH
5. 用户重启后调用 `order_mark`

## 5. 硬性门禁

- 不得让用户手动执行 `pipeline.cjs`、改 manifest、改 patch；这些由 `create_plugin` 完成。
- 不得输出 token、密码、cookie。
- 不得声称“已生成并可用”而没有 `create_plugin` 的 `ok:true` 和真实工具调用。
- 外部 API/浏览器插件需要账号/登录态时，明确要求用户提供，不得伪造。
- 30 个旧插件是 T0，不迁移；新插件默认 portable。
- 如果 `create_plugin` 工具不存在：说明工厂 MCP 需要重启 DSH，不要退化成让用户写代码。

## 6. 失败处理

| 现象 | 处理 |
|---|---|
| `create_plugin` 不存在 | 让用户重启 DSH，加载新 factory-control |
| pipeline 失败 | 读返回错误；修 `implSource` 后重试 |
| 安装失败 | 返回 zip 路径；让用户用 DSH Plugins/Add plugin 或 `dsh-factory` 安装 |
| 工具没出现 | 确认已重启 DSH；确认 profile |
| 外部 API 401/403 | 让用户补凭证，不要绕过 |
| 数据为空 | 明确说明输入为空，不要伪造结果 |

## 7. 输出模板

```text
已完成：<name>（<toolName>）
requestId：...
zip：...
状态：已生成 / 已安装
下一步：重启 DSH 后调用 <toolName>
限制：...
```
