# 44 — Wave 2（Google Trends / 选品工具）执行报告

## 1. 关键结论

- Google Trends 在本机 IP 直接访问返回 **429**；官方无稳定公开 API，**实时抓取不可靠**。
- 采用可复现的 **CSV 导出路径**：Google Trends 导出 + 卖家精灵/Sorftime 导出 → 合并 → 工厂插件。
- 不需要 Google 登录；卖家精灵/Sorftime 需要付费账号导出 CSV（或 API key）。

## 2. 已实现

| 文件 | 作用 |
|---|---|
| `scenarios/selection-input.mjs` | Google Trends CSV + 选品工具 CSV → 场景 fixture |
| `scenarios/samples/google-trends.csv` | 3 关键词 × 12 月样例 |
| `scenarios/samples/selection-tool.csv` | 5 个 ASIN 样例 |
| `scenarios/trend-selection-audit/runner.js` | 趋势（向上/平稳/下行/季节）+ 毛利 + 竞争评分 |
| `platform/tests/selection-input.test.mjs` | CSV 元数据/趋势数组/合并测试 |
| `platform/tests/trend-selection.test.mjs` | 3 推荐 / 2 排除业务断言 |

## 3. 工厂链路结果

`trend-selection-audit`：

- pipeline：**staging 通过**
- accept → install：通过
- 任务：5 个候选 ASIN，**推荐 3、排除 2**
- 报告：HTML 生成
- 需求单：`req_20261115062350_ea9449`

## 4. 量化口径

- 关键词：3 个（shopee / pet water / foldable box）
- 趋势：12 个月，前后 3 个月均值比较；最大/最小 >2.2 判季节
- 候选：5 个 ASIN；毛利率 <20% 观察，下行/季节排除
- 报告字段：ASIN、月销、价格、毛利、趋势、12 月变化、均值/峰值、竞争、机会分、结论、链接

## 5. 限制与下一步

- **实时 Google Trends**：当前 429；需要 SerpAPI/代理/浏览器登录态才可能稳定，不建议硬抓。
- **选品工具**：当前用样例 CSV；真实使用需要卖家精灵/Sorftime 导出文件。
- 下一步：你给一份真实导出 CSV（脱敏 ASIN/销量可），我接字段映射并做一次真实数据验收。
- 若坚持实时：提供 SerpAPI key（或可用代理），我再加 live 模式与失败降级。
