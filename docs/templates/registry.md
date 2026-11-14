# 插件登记表（Plugin Registry）

> 规则：**端口全局唯一、serverName 全局唯一、taskType 全局唯一**；新插件先登记再改 patch；端口冲突时从 8790 起顺延。

## 登记表

| 业务标识 | 中文名 | Skill 目录 | MCP 目录 | serverName | taskType | 端口 | 数据目录 | 状态 | 维护人 | 登记日期 |
|---|---|---|---|---|---|---|---|---|---|---|
| concise-analysis | 经营分析 | skills/concise-analysis | tools/concise-analysis-mcp | concise-analysis | jingying_analysis | 8790 | D:\www\dshspirder\data | 已验收 | 丁月 | 2026-11-13 |
|  |  |  |  |  |  |  |  |  |  |  |

## 端口分配表

| 端口 | 占用插件 | 状态 |
|---|---|---|
| 8790 | concise-analysis | 使用中 |
| 8791 | — | 空闲 |
| 8792 | — | 空闲 |
| 8793 | — | 空闲 |

## 状态枚举

`骨架中` → `开发中` → `真机通过` → `已验收` → `已废弃`

## 变更记录

| 日期 | 插件 | 变更 | 操作人 |
|---|---|---|---|
|  |  |  |  |
