# A 单机版安装器（apps/installer）

> 状态：M1 **部分完成**（核心实现 + 自动测试通过；真实 DSH/干净机/依赖自动准备尚未闭合）。

## 用法

```powershell
# 检查环境（不写任何文件）
.\apps\installer\setup.ps1 check

# 安装/修复（默认写 DSH profile 与 dshskills；先备份，可回滚）
.\apps\installer\setup.ps1 install

# 只预演，不写文件
.\apps\installer\setup.ps1 install --dry-run

# 卸载（恢复安装前 patch/registry；插件数据不删除）
.\apps\installer\setup.ps1 uninstall

# 回滚 patch（从首次安装备份）
.\apps\installer\setup.ps1 rollback
```

可选参数：`--dsh-root <dir>`、`--profile <name>`、`--patch <file>`、`--data-root <dir>`。测试/演练请显式指定临时目录，避免触碰真实 profile。

## 行为

- `check`：Node>=24、deployment、manifest、依赖、patch 目录可写、dshskills 状态、端口占用（占用仅提示"可能已运行"）。
- `install`：
  1. 备份 `cordis.patch.yml` 与 `registry.md` 到 `<data-root>/installer/backups/<ts>/`；
  2. 确保 `dshskills`（或其中 `tools`/`skills`）指向仓库 `deployment/`；
  3. 复用 `factory render` 生成 patch/registry（manifest 单一事实源）；
  4. 校验 11 个非 legacy 条目/端口/token 齐全；
  5. 写 `<data-root>/installer/state.json`；重复安装幂等，保留首次备份。
- `uninstall`：恢复安装前 patch/registry；删除本次创建的链接与 state；**不删除插件数据/任务产物**。
- `rollback`：只恢复 patch（保留 state）。

## 已验证

- `platform/tests/installer.test.mjs`：check、install、幂等、uninstall、dry-run、rollback、setup.ps1 BOM（临时目录，不触碰真实 profile）。
- 手工演练：临时 dshskills/profile 完成 install → uninstall，patch 恢复为原始内容。

## 未完成（M1 剩余）

1. 依赖自动准备：MCP `node_modules` / Playwright 浏览器 / npm 依赖的检测与安装引导。
2. 真实 DSH 验收：干净 Windows 机器 + 真实 `desktop` profile 的安装、热加载、重启兜底、卸载残留检查。
3. `--repair`（损坏安装修复）与升级迁移的自动化测试。
4. 安装包（zip/MSI）与代码签名。
