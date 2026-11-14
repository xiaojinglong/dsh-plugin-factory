# START HERE · 新会话启动语（复制粘贴用）

## 第 1 步：新建会话，工作目录设为
```
D:\www\dsh-plugin-factory
```

## 第 2 步：把下面整段发出去（第一句话）

```text
接手 dsh-plugin-factory 项目。请先按顺序读这 3 份文件，然后给我一份 5 行以内的现状汇报：
1. HANDOFF.md
2. README.md
3. platform/README.md

读完先执行 `cd platform/factory; node cli.cjs status` 和 `node cli.cjs doctor --health`，把结果贴出来。
之后所有改动都在本目录内完成，遵守 HANDOFF.md 的架构决策与已知坑。
先不要改任何文件，等我下指令。
```

## 第 3 步：看到 AI 汇报后，按场景继续

| 你想做的事 | 直接说 |
|---|---|
| 造新插件 | "按 docs/21 模板，我要做 XXX 业务：…（业务描述）" |
| 跑已有插件 | "跑 shop-list，前 2 页，出报告" |
| 维护/排障 | "doctor 有 warn，帮我修" / "8795 挂了，检查并恢复" |
| 升级平台 | "按 HANDOFF.md 第 7 节，做 XXX" |

## 验收标准（AI 汇报里应出现）
- 8 个服务全部 UP（8790–8797）
- doctor：全部通过（仅 concise-analysis 1 条 legacy warn）
- 如果它说"找不到文件/路径不对"，让它先 `cd D:\www\dsh-plugin-factory` 再试
