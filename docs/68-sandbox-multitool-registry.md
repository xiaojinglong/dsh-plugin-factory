# 68 — 沙箱、多工具、依赖与注册表进展

## 本轮完成

### 运行时沙箱（文件/进程）

生成的 portable 插件不再在 DSH 主进程直接 import 用户代码，而是：

```text
Host index.js
  → lib/sandbox.js
  → node --permission 子进程
  → lib/impl.js / lib/handlers.js
```

限制：

- `--allow-fs-read`：插件目录、request 文件、args 中声明的绝对路径
- `--allow-fs-write`：仅 `output_path` 且 spec 声明 `filesystem: ["write"]`
- 30s 超时，超时 kill
- 子进程只保留最小环境变量
- 无 `--allow-child-process`：用户代码不能随意 spawn
- 测试验证：读取 `C:/Windows/win.ini` 被拒绝

### 网络边界

`permissions.network` 必须声明目标 host。沙箱在用户代码加载前注入 `sandbox-network.cjs`：

- 未声明 network：`fetch`/`net.connect`/`http(s).request`/`dns.lookup` 被拒绝
- 已声明：只允许列出的 host
- 这是**策略层拦截**，不是内核级网络隔离；仍需要后续服务形态/OS sandbox

测试：

- 未声明 network → `network blocked`
- 声明 `127.0.0.1` → 本地 HTTP 请求成功

### 多工具

`spec.tools` 支持多项，必须提供 `lib/handlers.js`：

```js
export const handlers = { sum, count }
```

### 依赖

`spec.dependencies` 写入 package.json；校验前自动：

```text
npm install --omit=dev --ignore-scripts
```

### 注册表

`packages/plugin-registry.js` 记录版本/zip/tools/installed；MCP 工具 `list_registry`。

### 版本回滚

`rollback_plugin` 从注册表选择上一个已安装版本（或指定 version），重新调用 `dsh-factory` 安装；实测 profile 链接从 `roll-demo-0.1.1` 回滚到 `0.1.0`。

### 依赖白名单

`config/plugin-deps-allowlist.json`：未列出的依赖在生成阶段拒绝；当前允许 exceljs/xlsx/zod/csv-parse/fast-xml-parser/playwright。

### 凭证契约

`spec.credentials` 声明需要注入的环境变量：

```json
"credentials": [{ "env": "API_KEY", "required": true }]
```

沙箱只传声明过的 env；`required` 缺失直接失败；不再把整个环境变量传给用户代码。

### 修复循环

`create_plugin` 失败返回 `requestId + diagnostics + attempt`。  
`repair_plugin({requestId, spec/files})` 复用原请求参数重跑：

- attempt 1 → 失败
- repair → attempt 2 → 成功
- 最多 3 次；超过返回失败

实测 `repair-demo`：首次 validate 失败，repair 后 attempt=2，成功导出 zip。

### 工作流基准

`benchmarks/workflows/*.json` + `npm run benchmark`：

- 20 个工作流：JSON/CSV、文本、排序、去重、统计、正则、日期、错误契约、多文件、多工具、写入、渲染等

当前 **20/20 通过**。

## 验证

- 测试：**124/124**
- 越界读取：被拒绝
- 多工具：通过
- 多文件+测试：通过
- 失败测试：阻止打包
- 30 个测试插件仍默认不加载

## 仍未完成

1. 网络/系统调用 OS 级隔离（当前是策略守卫）
2. 真实外部 API/浏览器插件的凭证配置 UI
3. 工厂侧完全自主修复（当前 DSH Agent 调 repair_plugin）
4. 复杂服务形态插件（浏览器/队列/长任务）
