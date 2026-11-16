# 63 — Portable 自动生成本地完成 / 远端同步待处理

## 本地状态

- 默认 target：`portable-host`
- 旧 MCP：显式 `target: "mcp"`
- generator：`apps/generator/portable.cjs`
- pipeline：自动生成 → 校验 → 导出 zip
- 安装：`scripts/dsh-factory.cjs`
- skill：`ctx.skills.register`
- 端到端请求：`req_20261116045146_15ce19`
- 测试：**118/118**
- doctor：全绿（legacy warn 1）

## 本地 commit

```text
08e5a0b feat(portable): default portable-host generation in pipeline
cd4adbf test(portable): assert default portable-host target
a4fe2b5 docs: 118 tests after default portable target
```

## 远端问题

GitHub push/API 写入持续阻塞；此前 API 提交 `6c5c876` 把中文写成 `??`，不能作为最终版本。

网络恢复后，用本地正确内容覆盖远端：

```powershell
git push --force-with-lease origin main
git push --force origin v3.8.0-portable-auto
```

如果 tag 已重指本地：

```powershell
git tag -f v3.8.0-portable-auto a4fe2b5
git push --force origin v3.8.0-portable-auto
```

## 不能算“全部完成”的部分

1. 远端 main 仍是损坏提交
2. 公开仓库 serviceToken 暴露未处理
3. 真实第二台只装 DSH 的机器未验收

代码侧的工厂改造已完成；发布/安全/实机验收是外部收尾。
