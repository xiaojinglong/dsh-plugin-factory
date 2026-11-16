# 55 — Portable Excel 插件验收

## 结果

| 项 | 结果 |
|---|---|
| 包 | `portable-plugins/excel-status-mark` |
| 类型 | DSH Host bundle（`apply(ctx)` + `ctx.tools.register`） |
| 服务 | 无 |
| 端口 | 无 |
| 工厂路径 | 无 |
| 依赖 | `exceljs`（package.json 声明） |
| 安装 | `plugin_manager install_bundle` → `application: applied` |
| 工具 | `excel_status_mark` |
| 调用 | 6 行、6 行变更 |
| 输出 | `data/uat/orders-portable.xlsx` |
| 输入 | 未修改 |
| 卸载 | `remove_bundle` 成功 |

## 调用结果

```json
{
  "input_path": "D:\\www\\dsh-plugin-factory\\scenarios\\excel-status-mark\\orders.xlsx",
  "output_path": "D:\\www\\dsh-plugin-factory\\data\\uat\\orders-portable.xlsx",
  "total": 6,
  "changed": 6
}
```

状态：`SO-1001` 高额、`SO-1003` 异常、`SO-1004` 高额、其余正常。

## 证明

- 这是**原生 DSH Host 工具**，不是 MCP 外部服务。
- 没有 `FACTORY_ROOT`、没有 `plugins/<id>/service`、没有 HTTP 端口。
- package 内自带 `index.js` + `lib/mark.js`；`exceljs` 写在依赖里。
- 安装后直接调用，卸载后工具消失。

## 仍待完成

1. 干净 profile（无工厂仓库）安装验证
2. 导出 zip + 禁止项扫描
3. skill 自动安装（当前 `SKILL.md` 随包，但未自动注册）
4. `defineTool` 不可用，已改用 raw `ctx.tools.register`
5. 输入/输出路径校验、错误提示、审计待补
