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

`benchmarks/workflows/*.json` + `benchmarks/workflows-extra.json` + `npm run benchmark`：

- 20 个基础工作流 + 30 个数据/文本工作流
- 当前 **50/50 通过**

### 环境契约

`spec.requires` 声明目标环境：

```json
"requires": {
  "platform": "win32",
  "desktop": true,
  "apps": [
    { "name": "WeChat", "process": "Weixin", "paths": ["C:/Program Files/Tencent/Weixin/Weixin.exe"], "required": true }
  ]
}
```

- 生成到 package.json `dsh.requires`
- 校验阶段检查平台和必需应用路径
- UI 自动化插件必须声明 desktop/apps

### 连接器

`spec.connectors` 支持：

- `file`：JSON/文本/CSV 读写
- `http`：JSON 请求 + host allowlist + 凭证
- `browser`：Playwright 页面入口
- `desktop`：PowerShell 桌面自动化入口

生成器注入到 `lib/connectors/`；`desktop` 强制要求 `permissions.process`。

### 本地/远程目录

`npm run catalog` 生成带 SHA-256 的目录；`npm run catalog:install -- --id <id> [--catalog <file|url>]` 校验后安装。

远程目录格式相同：`zip` 可为相对 URL，安装器下载到临时目录、校验 SHA-256、再调用 dsh-factory。

### 桌面录制/回放

```powershell
npm run record -- --seconds 30 --name wechat-flow
npm run replay -- --file data/recordings/wechat-flow.json --dry-run
npm run replay -- --file data/recordings/wechat-flow.json
```

录制也可以随插件打包：

```json
{
  "spec": { "connectors": ["desktop"], "permissions": { "process": true, "filesystem": ["read"] } },
  "recording": "D:/recordings/wechat-flow.json"
}
```

生成器会写入 `recordings/flow.json`，desktop 连接器提供：

```js
loadRecording()
replayRecording({ speed: 1 })
```

- 录制鼠标移动/左右键/部分键盘事件/前台窗口标题
- JSON 事件带时间戳
- 回放前先校验格式；`--dry-run` 只校验
- 这是入口能力，不是高可靠 RPA：不含图像识别、控件定位、失败恢复

### 干净安装验证

`npm run verify:clean`：

- 创建临时 DSH 根目录
- 执行 installer install ×2
- 验证 patch 只含 factory-control、无 30 个测试插件
- 验证 state/registry/链接、`.cmd`/`.sh`
- 验证幂等

注意：这是干净 profile 模拟，不等同于一台全新物理机。

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
