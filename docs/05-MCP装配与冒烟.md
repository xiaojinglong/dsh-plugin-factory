# 05 · MCP 装配 + 冒烟 + 接入（S6/S7/S9）

> 目标：让薄壳连上服务、让 DSH 认识插件、并且在**重启 DSH 之前**就把问题排掉。

---

## 第 1 节：装配 config.json（S6）

```powershell
# 1) 把爬虫项目产出的 mcp-config.json 复制到 MCP 目录
Copy-Item D:\<爬虫项目>\mcp-config.json `
          D:\www\dshskills\tools\<业务标识>-mcp\config.json -Force

# 2) 只改一处：baseUrl 端口与 .env.PORT 一致
#    其它字段（endpoints/statusMap/submitBody）保持模板值
```

**三处一致性校验（必须做，错一处就会"工具调用失败"）**：

| 位置 | 字段 | 必须一致 |
|---|---|---|
| `tools/<id>-mcp/config.json` | `service.baseUrl` | `http://127.0.0.1:{端口}` |
| `<爬虫项目>/.env` | `PORT` | `{端口}` |
| `cordis.patch.yml` 的该条目 | `env.MCP_SERVICE_BASE_URL` | `http://127.0.0.1:{端口}` |

校验命令：

```powershell
$cfg = Get-Content .\config.json -Raw | ConvertFrom-Json
$port = (Select-String -Path D:\<爬虫项目>\.env -Pattern '^PORT=').Line -replace 'PORT=',''
"config.baseUrl = $($cfg.service.baseUrl) ; env.PORT = $port"
# 期望：两者都指向同一个 127.0.0.1:{端口}
```

## 第 2 节：依赖与自检（S6）

```powershell
cd D:\www\dshskills\tools\<业务标识>-mcp
node --check index.js
node -e "const m=require('./index.js');const c=m.loadConfig();console.log('[baseUrl]',c.service.baseUrl);console.log('[status]',m.mapTaskStatus(c,'done'));console.log('[submit]',m.buildUrl(c,m.fillPath(c.endpoints.submit.path,{})))"
```

期望输出：`http://127.0.0.1:<端口>`、`succeeded`、提交 URL。
依赖缺失：`npm i @modelcontextprotocol/sdk zod xlsx`；无网络时从已装好的 MCP 目录拷贝 `node_modules`。

## 第 3 节：服务常驻（S8 前置）

| 方式 | 命令/做法 | 适用 |
|---|---|---|
| 前台窗口（临时） | `npm start` | 自测 |
| pm2（需先 `npm i -g pm2`） | `pm2 start server.js --name <id>; pm2 save; pm2 startup` | 推荐 |
| Windows 计划任务 | 开机运行 `npm start`（隐藏窗口） | 无 pm2 时 |
| 启动脚本 | 一个 `start-<id>.bat` | 最简 |

常驻后必须自检：`curl http://127.0.0.1:<端口>/health` → `{"ok":true}`；并把日志路径写进运行手册。

## 第 4 节：改 DSH 配置（S7）

文件：`C:\Users\Giikin\.dsh\profiles\desktop\cordis.patch.yml`（**先备份**）

```powershell
Copy-Item $env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml `
          $env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak -Force
```

两段式插入（模板：`templates/patch-仓库级.yml`、`templates/patch-插件级.yml`）：

```yaml
# ── 仓库级：整个 dshskills 只加一次，后续插件不用重复 ──
- insert:
    - id: skill-filesystem-dshskills
      name: "@deepseek-ai/dsh-skill-filesystem"
      config:
        providerName: dshskills-repo
        includeDefaultRoots: false
        customSkillDirs: ["D:/www/dshskills/skills"]

# ── 插件级：每个插件一条，四处唯一（id/serverName/args/cwd） ──
- insert:
    - id: mcp-<业务标识>
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: <业务标识>
        transport: stdio
        command: node
        toolCallTimeoutMs: 900000      # 多店铺/长任务必配，单位毫秒
        args: ["D:/www/dshskills/tools/<业务标识>-mcp/index.js"]
        cwd: "D:/www/dshskills/tools/<业务标识>-mcp"
        env:
          MCP_SERVICE_BASE_URL: "http://127.0.0.1:<端口>"
```

**配置四条校验**：
- [ ] `id` 全局唯一（重复会导致加载冲突）
- [ ] `serverName` 全局唯一且 = 业务标识（kebab）
- [ ] 路径用正斜杠；YAML 缩进用空格（2 空格层级）
- [ ] `toolCallTimeoutMs` 已设（长任务默认 15 分钟）

## 第 5 节：重启前冒烟五连（S9）

```powershell
# 0) 服务健康
curl.exe -s http://127.0.0.1:<端口>/health                       # {"ok":true}

# 1) 提交（用服务接口直测，不经过 DSH）
curl.exe -s -X POST http://127.0.0.1:<端口>/jobs `
  -H "Content-Type: application/json" -d "{}"                    # {"jobId":...}

# 2) 轮询状态
curl.exe -s http://127.0.0.1:<端口>/jobs/<jobId>                  # done / failed / waiting_verify

# 3) 取结果（仅 done）
curl.exe -s http://127.0.0.1:<端口>/jobs/<jobId>/result           # main+details

# 4) 读文件（用 MCP 薄壳的解析逻辑）
node -e "require('./index.js').parseResultFile('<main.path>').then(r=>console.log(r.ok,r.type,r.rows&&r.rows.length))"
```

一键版：`templates/verify-mcp.ps1`。

**通过标准**：五连全绿，且解析出的行数与页面一致。

## 第 6 节：重启 DSH 与可见性检查（S10）

1. 完全退出 DSH（托盘退出，不是关窗口）→ 重新打开。
2. 新会话检查：技能列表出现 `<业务标识>`；工具列表出现 `mcp__<serverName>__submit_task` 等 5 个。
3. 若技能不出现 → 查目录层级/`name`/frontmatter；若工具不出现 → 查 patch/重启/`serverName` 冲突。

## 第 7 节：失败回滚

| 场景 | 回滚动作 |
|---|---|
| patch 改错 | 用 `.bak` 覆盖回去，重启 DSH |
| config 端口错 | 改回正确端口，重启 DSH（无需重启服务） |
| 测试任务残留 | 保留 `data/jobs/<taskId>` 作证据，或按目录清理 |
| 插件废弃 | 从 patch 删条目 + registry 标记废弃；不删目录（保留追溯） |
