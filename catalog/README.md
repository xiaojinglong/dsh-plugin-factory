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
- sha256 / size

安装前校验：

```powershell
npm run catalog:install -- --id weixin-xiaopang --dry-run
npm run catalog:install -- --id weixin-xiaopang
```

远程目录同一格式：

```powershell
npm run catalog:publish
npm run catalog:serve
# 另开窗口
npm run catalog:install -- --id weixin-xiaopang --catalog http://127.0.0.1:8788/plugins.json --dry-run
```

发布目录：

```text
catalog/public/plugins.json
catalog/public/zips/*.zip
```

远程 entry 的 `zip` 是相对 URL；安装器下载到临时目录、校验 SHA-256、再安装。

后续远程市场需要：

1. 签名/来源
2. 权限与兼容性
3. 审核/评分
4. 远程下载与校验
