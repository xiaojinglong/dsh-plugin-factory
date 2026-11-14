# 接入与验证（run-flow 修订版）

> 替换已过期的 `D:\www\dshprompt\run-flow.md`。
> 当前运行的是 **desktop profile**，配置改 `~/.dsh/profiles/desktop/cordis.patch.yml`。
> 核心变化：**用 customSkillDirs 扫描仓库，不再复制到 `~/.dsh/skills`；serverName 用 kebab-case。**

## 步骤 0：先启动数据服务

```powershell
cd D:\<爬虫项目>
npm start
# 或常驻（pm2 需先 npm i -g pm2）：pm2 start server.js --name <业务标识>; pm2 save
curl.exe -s http://127.0.0.1:<端口>/health     # 期望 {"ok":true}
```

## 步骤 1：命名一致性（否则 DSH 不认）

- `skills/<业务标识>/SKILL.md` 的 frontmatter `name` 必须 = 业务标识 = kebab-case。
- 目录名不能嵌套成 `skills/xxx/<业务标识>/`。
- 禁止 PascalCase / 空格 / 下划线 / 中文。

```powershell
node -e "const fs=require('fs');const t=fs.readFileSync('D:/www/dshskills/skills/<业务标识>/SKILL.md','utf8');const m=t.match(/^---[\s\S]*?name:\s*(\S+)/m);console.log('skill name =',m&&m[1])"
```

## 步骤 2：让 DSH 扫描到仓库（仓库级，只做一次）

在 patch 文件里加入（模板：`templates/patch-仓库级.yml`）：

```yaml
- insert:
    - id: skill-filesystem-dshskills
      name: "@deepseek-ai/dsh-skill-filesystem"
      config:
        providerName: dshskills-repo
        includeDefaultRoots: false
        customSkillDirs: ["D:/www/dshskills/skills"]
```

## 步骤 3：挂载 MCP（每个插件一条）

先备份，再插入（模板：`templates/patch-插件级.yml`）：

```powershell
Copy-Item $env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml `
          $env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak -Force
```

```yaml
- insert:
    - id: mcp-<业务标识>
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: <业务标识>
        transport: stdio
        command: node
        toolCallTimeoutMs: 900000
        args: ["D:/www/dshskills/tools/<业务标识>-mcp/index.js"]
        cwd: "D:/www/dshskills/tools/<业务标识>-mcp"
        env:
          MCP_SERVICE_BASE_URL: "http://127.0.0.1:<端口>"
```

要点：`insert` 不带 `id` 表示新增插件实例；`serverName` 允许大小写但**建议统一 kebab**（避免工具名不一致）；路径用正斜杠。

## 步骤 4：重启前先冒烟（不要跳过）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify-mcp.ps1 -McpDir "D:\www\dshskills\tools\<业务标识>-mcp" -Full
```

五连全绿再往下走：`/health` → `POST /jobs` → 状态轮询 → `/result` → 读文件解析。

## 步骤 5：重启 DSH

**完全退出（托盘退出）再打开**，新建会话。检查两件事：

1. 技能列表出现 `<业务标识>`；
2. 工具列表出现 `mcp__<业务标识>__submit_task` / `_get_task_status` / `_wait_task` / `_get_task_result` / `_read_result_file`。

## 步骤 6：会话首跑（先单工具，再整流程）

```text
1) submit_task(taskType="<taskType>", params={})   → 记 taskId
2) wait_task(taskId)
   - waiting_verify → 打开 verifyUrl 扫码 → 再查状态
   - failed → 看 error
3) get_task_result(taskId)                         → main / details
4) read_result_file(main.path)                     → 能解析
5) 最后说："按 <业务标识> skill 做一次"              → 验证追问→报告
```

## 常见问题（按层定位）

| 现象 | 原因 | 修法 |
|---|---|---|
| skill 不出现 | name 非 kebab / 目录嵌套 / frontmatter 解析失败 | 改名改层级 → 重启 |
| MCP 工具不出现 | 没重启 / YAML 缩进 / `id/serverName` 冲突 | 修 patch → 重启 |
| MCP 启动失败 | 依赖没装 / `args` 路径错 | `node <index.js>` 看报错；补 `node_modules` |
| 工具调用失败 | 服务没起 / 端口不对 / 登录态失效 | `/health` → 改 `baseUrl` → 扫码 |
| 扫码后不继续 | MCP 不自动扫码 | 扫完重新 `get_task_status` |
| 任务超时 | `toolCallTimeoutMs` 太小 | 调到 900000 或分批 |
