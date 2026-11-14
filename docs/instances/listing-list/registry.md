# listing-list 插件登记（2026-11-13）

| 字段 | 值 |
|---|---|
| 业务标识 | listing-list |
| 中文名 | Shopee 商品 listing 分析 |
| 类型 | API 型（执行层直接调开放接口） |
| Skill 目录 | `D:\www\dshspirder\plugin-factory\instances\listing-list\skills\listing-list` |
| MCP 目录 | `D:\www\dshspirder\listing-list\mcp` |
| 服务目录 | `D:\www\dshspirder\listing-list\service` |
| serverName | listing-list |
| taskType | listing_list |
| 端口 | 8791（8790 已被 concise-analysis 占用） |
| 数据目录 | `D:\www\dshspirder\listing-list\service\data` |
| 接口 | `POST https://api.giikin.com/agent/shopee/user/openapi/listing/listing` |
| 凭证 | `LISTING_API_KEY`（dk-ai-p…，存于 service/.env） |
| 状态 | 已跑通（服务 / MCP 五连 / HTML 报告） |
| 采样 | 2 页 / 34 条在售（全量 34） |
| 维护人 | — |
