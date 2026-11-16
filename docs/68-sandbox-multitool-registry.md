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

Node permission 不限制网络。当前策略：

- spec 必须声明 `permissions.network`
- 静态检查拒绝未声明的 `fetch/http`
- **网络不是内核级隔离**，需要后续服务形态/OS 沙箱

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

## 验证

- 测试：**124/124**
- 越界读取：被拒绝
- 多工具：通过
- 多文件+测试：通过
- 失败测试：阻止打包
- 30 个测试插件仍默认不加载

## 仍未完成

1. 网络/系统调用真正隔离（需服务形态或 OS sandbox）
2. 基准工作流集
3. 自动修复循环（目前 Agent 读 diagnostics 重试）
4. 真实外部 API/浏览器插件的凭证注入契约
