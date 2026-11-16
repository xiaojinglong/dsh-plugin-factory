# 54 — Portable Host Bundle Spike

## 结果

- 目录：`spikes/portable-host`
- `plugin_manager install_bundle`：首次失败，第二次修复后 `application: applied`
- 工具：`portable_ping`
- 调用结果：`portable-ok`
- 安装后已 `remove_bundle` 清理，profile 恢复

## 第一次失败

```text
failed to import: Cannot find package '@deepseek-ai/dsh-tools'
```

原因：安装版 DSH 的 profile 包解析不到教程里的 `@deepseek-ai/dsh-tools`；该 import 不能作为 portable bundle 的默认依赖。

## 修复

改为零依赖的原始工具对象：

```js
export function apply(ctx) {
  ctx.tools.register({
    name: 'portable_ping',
    description: 'Return a fixed portable bundle result.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() { return 'portable-ok' },
  })
}
```

`ctx.tools.register` 接受该对象；无 `@deepseek-ai/dsh-tools` import。

## 结论

- T1 portable-host 路线可行：包相对注册、无绝对路径、无服务/端口。
- 简单工具应零依赖；复杂依赖写进 `package.json`，由安装器安装。
- 不能假设 `defineTool`/`@deepseek-ai/dsh-tools` 在安装版 DSH 可用。
- 下一步：Portable runtime + Excel 样板。
