# 插件目录（本地）

当前是单机本地目录，不做远程市场。

```powershell
npm run catalog
node scripts/plugin-catalog.cjs search 微信
```

生成：

```text
catalog/plugins.json
```

内容来自 `data/registry/plugins.json`，包含：

- id / version
- tools
- installed
- zip / requestId

后续远程市场需要：

1. 签名/来源
2. 权限与兼容性
3. 审核/评分
4. 远程下载与校验
