# 65 — 登录自启修复

## 问题

原来的 `DSHPluginFactory.vbs` 存在嵌套引号问题，登录时没有真正执行：

- `data/logs/autostart.log` 从未生成
- 重启后控制面/服务全 DOWN
- 只能手动 `start-factory`

## 修复

改为 Startup 目录下的 `.cmd`，使用：

- 完整 `node.exe` 路径
- `chcp 65001`
- 固定工厂目录
- 日志重定向 `data/logs/autostart.log`
- 删除旧 VBS

安装：

```powershell
node scripts/install-autostart.cjs
```

测试：

```powershell
cmd /c "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\DSHPluginFactory.cmd"
```

结果：

- 命令退出码 0
- `autostart.log` 生成
- 控制面与服务恢复/保持运行
- 旧 VBS 已移除

## 边界

自启发生在 **Windows 登录**，不是 DSH 应用重启。  
如果只重启 DSH，后台栈通常应继续运行；若机器重启，登录后由 `.cmd` 拉起。

## 当前仍需注意

1. 轮换后的新 token 在 tracked manifests 中（git 显示 47 个 manifest 修改）；**不要提交**。
2. 真实第二台只装 DSH 的机器未验收。
3. 30 个旧插件冻结。
