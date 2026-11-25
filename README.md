# DSH Plugin Factory

> 把业务人员的自然语言工作流程，变成可安装、可调用的 DSH 插件。
>
> 当前版本：**v3.27.0**  
> 状态：**内部可推广候选版**  
> 测试：**143/143 通过**

---

## 一、这个项目是什么

DSH Plugin Factory 是一个**单机插件工厂**：

```text
业务人员描述工作流程
→ AI 澄清目标
→ 生成插件规格与实现
→ 静态校验 / 自动测试 / 目标一致性测试
→ 打包 zip
→ 安装到 DSH
→ 用户用自然语言调用
```

它不是“代码生成器演示”，而是一条完整交付链：

```text
需求 → 契约 → 生成 → 验证 → 打包 → 安装 → 试点 → 验收 → 回滚
```

### 两类插件

| 类型 | 适用场景 | 交付方式 |
|---|---|---|
| 普通 portable 插件 | Excel、CSV、文件、内部 API | 单插件 zip |
| 爬虫型插件 | 登录、浏览器、页面抓取 | 独立爬虫服务 + 薄 DSH 插件 |

爬虫型必须双交付：

```text
独立服务负责浏览器/登录/抓取
薄插件只通过 HTTP 调用服务
```

插件内不出现 Playwright、浏览器、CDP、页面选择器。

---

## 二、当前能力

### 工厂侧

- 自然语言需求 → portable 插件生成
- 多文件 `lib/` + `tests/` + `fixtures/`
- 静态校验、语法检查、沙箱执行
- 目标一致性测试门禁
- 异步 `create_plugin(wait:false)` / `finalize_plugin`
- 默认不自动验收（`autoAccept:false`）
- 安装、升级、回滚
- 目录安装缓存，避免坏 `link:` 依赖
- 明文密钥/凭证/网络权限审计
- 控制面健康检查与失败任务统计
- CI 自动生成 Linux/Windows 工厂包

### 爬虫侧

- 独立 HTTP 服务：`start/status/verify/result`
- 登录态持久化，后续复用
- 每页单次加载，不反复刷页面
- 滑块/验证只暂停等人工，不绕过
- 默认 CDP 连接用户自己的 Chrome，不启动新的 Playwright 浏览器
- 复用标签页，不创建 `about:blank`，不关闭用户网页
- 缺页、失败、验证状态如实返回

---

## 三、环境要求

- Node.js **>= 24**
- Windows（当前主要验证平台）
- 已安装 DSH
- Chrome（爬虫型插件使用 CDP 连接）
- 可访问目标业务系统/网络

---

## 四、快速开始

### 1. 克隆与安装

```powershell
git clone https://github.com/xiaojinglong/dsh-plugin-factory.git
cd dsh-plugin-factory
npm install
```

### 2. 启动控制面

```powershell
npm run control-plane
```

默认地址：

```text
http://127.0.0.1:8780
```

### 3. 健康检查

```powershell
npm run factory:health
```

正常输出应类似：

```text
工厂健康
  控制面：up 0.1.0
  最近 24h 失败：0
  已安装插件：N
  告警：无
```

### 4. 运行测试

```powershell
npm test
```

当前基线：

```text
143/143 通过
```

### 5. 接入 DSH

将 `factory-control` MCP 注册到 DSH，并启用 `factory-agent` skill。

MCP 入口：

```text
node apps/factory-control-mcp/index.cjs
```

环境变量：

```text
CONTROL_PLANE_URL=http://127.0.0.1:8780
CONTROL_PLANE_TOKEN=<data/control-plane/token>
```

> 修改 MCP 或插件后，通常需要重启 DSH，工具才会刷新。

---

## 五、用户使用流程

### 1. 在 DSH 中描述流程

```text
帮我把销售明细 Excel 按区域汇总，输出订单数、金额合计和占比。
```

或：

```text
帮我做一个淘宝商品抓取插件：
打开淘宝，人工扫码登录，搜索“圣诞节”，抓取前 2 页并汇总成 Excel。
```

### 2. AI 澄清与确认

工厂会确认：

- 输入是什么
- 输出字段是什么
- 是否涉及登录/浏览器
- 成功标志
- 明确不做什么
- 风险等级

### 3. 生成与验证

```text
生成代码
→ 语法/静态校验
→ 单元测试
→ 目标一致性测试
→ 沙箱验证
→ 打包 zip
```

### 4. 验收与安装

默认 `autoAccept:false`：

```text
生成到 staging
→ 用户确认目标/结果
→ finalize_plugin({autoAccept:true})
→ 安装
```

用户不需要看代码、jobId、接口参数。

### 5. 自然语言调用

```text
现在进度多少？
把结果给我。
```

---

## 六、核心命令

### 测试与检查

```powershell
npm test
npm run check
npm run factory:health
npm run factory:health -- --json
```

### 工厂分发包

```powershell
npm run factory:package
```

输出：

```text
release/dsh-plugin-factory-<version>.zip
release/dsh-plugin-factory-<version>.zip.sha256
```

### 安装插件

```powershell
node scripts/dsh-factory.cjs install "<zip>" --profile desktop
```

### 升级

```powershell
node scripts/dsh-factory.cjs install "<new-zip>" --profile desktop
```

安装器会先移除旧 link，再安装新版本。

### 回滚

```powershell
node scripts/dsh-factory.cjs rollback <plugin-id> --dry-run
node scripts/dsh-factory.cjs rollback <plugin-id> --profile desktop
```

### 指定历史版本

```powershell
node scripts/dsh-factory.cjs rollback <plugin-id> --version 1.0.0 --profile desktop
```

---

## 七、目录结构

```text
dsh-plugin-factory/
├── apps/
│   ├── control-plane/          需求单、步骤、审计、指标、备份
│   ├── factory-control-mcp/    MCP 工具层（create/finalize/repair/rollback）
│   └── generator/              portable 插件生成、校验、沙箱、pipeline
├── packages/
│   ├── config/                 路径/环境解析
│   ├── sdk/                    插件 Spec 契约
│   └── plugin-registry.js      安装注册表与回滚历史
├── platform/
│   ├── factory/                CLI、运行时、测试
│   └── tests/                  143 个回归测试
├── scripts/
│   ├── dsh-factory.cjs         安装/升级/回滚/目录缓存
│   ├── factory-health.cjs      健康检查
│   ├── package-factory.cjs     工厂源码打包
│   └── ...
├── docs/                       规范、工作流、试点、发布、运维
├── .dsh/skills/factory-agent/  factory-agent Skill
└── data/                       运行数据（不提交）
```

---

## 八、实现细节

### 8.1 portable 插件

生成包包含：

```text
package.json
cordis.patch.yml
index.js
lib/impl.js 或 lib/handlers.js
lib/sandbox.js
lib/sandbox-child.mjs
lib/sandbox-network.cjs
build.json
tests/
fixtures/
skills/
```

运行时：

- `index.js` 注册 DSH 工具/Skill
- `lib/sandbox.js` 用 Node 权限模型限制文件读写
- 生成实现实际在受限子进程执行
- 凭证只通过 `spec.credentials` 声明 env
- 网络只允许 `spec.permissions.network` 中的 host

### 8.2 沙箱边界

```text
只读：插件目录、运行时、声明的输入
只写：插件数据目录、声明的输出路径及其父目录
网络：声明的 host
进程：默认关闭
```

禁止：

- 越界读取
- 明文密钥
- 未声明的网络
- 未声明的子进程

### 8.3 异步生成

```text
create_plugin({ wait:false })
→ 立即返回 requestId
→ get_request 查看 generate/validate/staging
→ finalize_plugin({ requestId, autoAccept:true })
→ 验收/安装/注册表
```

默认不替用户验收。

### 8.4 目标一致性门禁

```text
spec.acceptance 非空
→ 必须存在 tests/target-conformance.test.mjs
→ 否则 validatePortable 失败
```

目标不一致时：

```text
定位根因 → 修服务/插件 → 重测
最多 3 轮
禁止改测试让失败变通过
```

### 8.5 爬虫双交付

```text
独立服务（Fastify + HTTP）
  /health
  POST /jobs
  GET /jobs/:id
  GET /jobs/:id/verify
  GET /jobs/:id/result
```

薄插件：

```text
start  提交任务，立即返回
status 查询进度
verify 获取登录/滑块截图
result 获取 Excel
```

服务状态：

```text
queued → waiting_verify → running → done / failed
```

### 8.6 浏览器接入

新爬虫默认 CDP 连接用户 Chrome：

```powershell
chrome.exe --remote-debugging-port=9222 --user-data-dir="D:\chrome-taobao-profile"
```

服务：

```text
CDP_URL=http://127.0.0.1:9222
```

规则：

- 不启动 Playwright/Puppeteer 自带浏览器
- 复用现有标签页
- 不创建 `about:blank`
- 任务结束不关闭用户网页
- 每页只加载一次
- 登录/滑块人工完成
- 不自动破解验证码
- 不用私有 API 绕过验证

---

## 九、已交付示例

### 运营：销售区域汇总

```text
输入：销售明细 Excel（区域、金额、订单号）
输出：区域汇总 Excel（区域、订单数、金额合计、占比）
```

内部样例 3/3 通过。

### 行政：文件归档

```text
输入：一个目录
输出：文档/表格/图片/其他分类目录
源文件保留
```

### 淘宝商品抓取

```text
关键词：圣诞节
2 页实测：68 条
模式：CDP 连接用户 Chrome
登录/滑块：人工
```

已知限制：

- 淘宝商品链接字段为空
- 部分店铺字段为空

### 1688 商品抓取

- 独立服务 + 薄插件
- GBK 关键词编码
- 缺页如实记录
- 不绕过滑块

---

## 十、发布与迁移

### 工厂发布包

```text
release/dsh-plugin-factory-3.27.0.zip
SHA-256：e190b66fa184fd2e865e7d8bb7f20a70a4434066fb6048e24ef19ef4b6d19fa8
```

### 插件迁移

```text
复制插件 zip
→ 目标机安装
→ 重启 DSH
```

不要复制：

```text
AppData 缓存
DSH profile
浏览器 profile
登录 cookie
```

迁移说明：

- [docs/71-插件包位置与迁移.md](docs/71-插件包位置与迁移.md)
- [docs/81-工厂分发包.md](docs/81-工厂分发包.md)

---

## 十一、已知限制

1. **真实岗位外部用户签字未取得**：当前是内部可推广候选版。
2. **爬虫受目标站 DOM/风控影响**：淘宝/1688 页面结构变化会导致字段缺失或缺页。
3. **淘宝商品链接/部分店铺字段为空**：结果卡没有稳定 href。
4. **登录/滑块需要人工**：不自动破解、不绕过。
5. **DSH 工具刷新**：修改 MCP/插件后通常需要重启 DSH。
6. **单机工厂**：当前没有多用户、远程调度、集中权限系统。
7. **Windows 为主**：部分路径/安装行为在 Linux 上仍需额外验证。

---

## 十二、相关文档

| 文档 | 内容 |
|---|---|
| [docs/70-插件交付工作流.md](docs/70-插件交付工作流.md) | 0–15 节点交付流程 |
| [docs/71-插件包位置与迁移.md](docs/71-插件包位置与迁移.md) | zip、安装位置、迁移 |
| [docs/73-爬虫型插件双交付强制标准.md](docs/73-爬虫型插件双交付强制标准.md) | 爬虫双交付、坑清单、CDP 规则 |
| [docs/74-工厂运维手册.md](docs/74-工厂运维手册.md) | 健康检查、回滚、故障处理 |
| [docs/75-岗位试点包.md](docs/75-岗位试点包.md) | 岗位试点流程 |
| [docs/76-试点验收记录.md](docs/76-试点验收记录.md) | 验收表 |
| [docs/77-发布说明模板.md](docs/77-发布说明模板.md) | 发布说明模板 |
| [docs/79-工厂发布说明.md](docs/79-工厂发布说明.md) | 当前版本说明 |
| [docs/84-最终内部交付说明.md](docs/84-最终内部交付说明.md) | 最终内部交付状态 |

---

## 十三、常见问题

### 控制面不可用

```powershell
npm run control-plane
npm run factory:health
```

### 插件工具没出现

```text
重启 DSH
确认 MCP 已加载
确认 profile 中已安装
```

### 安装失败，提示 profile 依赖损坏

先移除坏 link，再重装：

```powershell
node scripts/dsh-factory.cjs install "<zip>" --profile desktop
```

### 淘宝服务连不上 Chrome

确认 Chrome 带调试端口启动：

```powershell
chrome.exe --remote-debugging-port=9222 --user-data-dir="D:\chrome-taobao-profile"
```

### 任务停在 waiting_verify

```text
在 Chrome 中完成扫码/滑块
→ 服务自动继续
```

---

## 十四、GitHub Release

最新候选版：

```text
https://github.com/xiaojinglong/dsh-plugin-factory/releases/tag/v3.27.0
```

Release 附件：

```text
dsh-plugin-factory-3.27.0.zip
spirder-taobao-service-1.0.0.zip
spirder-taobao-1.0.0.zip
```

---

## 十五、License

当前仓库未声明独立开源许可证；使用前请与仓库所有者确认授权范围。
