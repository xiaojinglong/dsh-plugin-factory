# 57 — Portable 干净目录安装验收

## 目标

把导出的 zip 解压到**插件工厂目录之外**，再从该目录安装，验证包不依赖工厂路径。

## 过程与发现

1. 第一次从 `C:\...\Temp\dsh-portable-clean` 安装
   - 结果：`application: failed`
   - 错误：`Cannot find package 'exceljs'`
   - 原因：DSH 对本地目录是 **pnpm link**，不会安装包依赖。

2. 修复导出：`export-plugin.cjs` 在 staging 里执行生产依赖安装，把 `node_modules` vendoring 进 zip。

3. 重新导出并解压到 `C:\...\Temp\dsh-portable-clean2`

| 项 | 结果 |
|---|---|
| zip | `dist/excel-status-mark-0.1.0.zip` |
| 大小 | 10,441,638 bytes |
| sha256 | `428664eb6e44a7e5889a2e7e57f60253910365bd62a561b1f98759b083d9d591` |
| node_modules | 随包存在，含 `exceljs` |
| 安装 | `application: applied` |
| 工具调用 | `excel_status_mark` 6 行、6 行变更 |
| 输出 | `data/uat/orders-portable-clean.xlsx` |
| 卸载 | `remove_bundle` 成功 |

## 证明

- 安装源在工厂目录外，bundle 自带运行依赖。
- 无工厂服务、无端口、无 `FACTORY_ROOT`。
- 解压 → Add plugin/plugin_manager → 调用工具 → 产出文件。

## 当前限制

- 仍在同一台机器/同一 DSH profile 上验证；“另一台只有 DSH 的机器”还需实机验收。
- zip 约 10MB（vendored exceljs）；公开包可考虑 npm 依赖安装替代 vendoring。
- 包名仍 `@local/...`、`private:true`；发布前需 Task 8。
- skill 随包但未自动注册。
