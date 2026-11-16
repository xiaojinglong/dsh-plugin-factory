# 60 — Portable Skill 自动注册验收

## 实现

Portable Host 插件使用 DSH 的 skill registry：

```js
export const inject = ['tools', 'skills']

ctx.skills.register({
  name: 'excel-status-mark',
  description: '...',
  whenToUse: '...',
  source: 'runtime',
  content: fs.readFileSync(SKILL_FILE, 'utf8'),
  resourceBase: { kind: 'directory', path: path.dirname(SKILL_FILE) },
  invocation: { modelInvocable: true, userInvocable: false },
})
```

## 结果

| 项 | 结果 |
|---|---|
| 安装 bundle | `application: applied` |
| 技能目录出现 | ✅ `excel-status-mark` |
| `skill` 工具加载 | ✅ 返回 `<skill_content>` |
| 资源目录 | `portable-plugins/excel-status-mark/skills/excel-status-mark` |
| 卸载 bundle | 技能从目录消失 |
| 清理 | 测试 bundle 已卸载 |

## 第一次失败

```text
loaded skill "excel-status-mark" source must be a string
```

原因：`SkillRegistration` 需要 `source` 字段；补 `source: 'runtime'` 后加载成功。

## 结论

- portable Host 插件可以自动注册 skill，无需 installer 复制文件。
- `ctx.skills.register` 是 DSH 标准 API；不依赖绝对路径，不需要额外 skill 目录。
- 发布 zip 已重新导出，包含该实现。

## 当前 zip

- `dist/excel-status-mark-0.1.0.zip`
- 10,441,905 bytes
- sha256 `a527a368c1cf7b8cb1ef903552bed6d6fd4234fb038e3a2805b4d38828a63adb`
