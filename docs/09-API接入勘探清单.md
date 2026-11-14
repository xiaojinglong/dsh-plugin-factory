# 09 · API 接入勘探清单（S4 前置，必做）

> 目的：把"接口调研"从隐性经验变成 10 分钟固定动作。**没探完不许写 fetcher**。
> 本次（listing/shop/ads）全部依赖这份清单，累计发现 6 个坑。

## 1. 基础信息（3 分钟）

| 项 | 怎么确认 | 必填 |
|---|---|---|
| 主机 | 用 `curl` 逐个试 `api.giikin.com` / `openapi.giikin.com`；不同主机鉴权不同 | ✅ |
| 路径 | 从网关路由或业务文档拿；注意 `/agent/{platform}/...` 前缀 | ✅ |
| 方法/编码 | POST JSON / form；`content-type` 必须对 | ✅ |
| 鉴权 | 依次试 `Authorization: Bearer <key>`、原样、Basic、`ug_` 静态凭证；记录哪种 200 | ✅ |
| 凭证来源 | dk 键（Acore）≠ 网关 OAuth client_token；`dksk auth` 只写本地 `.acore` | ✅ |

> 本次坑：`npx dksk auth` 的 `dk-ai-p-…` 在 **api.giikin.com** 可直接作 Bearer；在 **openapi.giikin.com** 被拒（`不是有效的应用静态认证凭证`）。

## 2. 参数勘探（3 分钟）

- 用**最小参数**先跑通（`{page,pageSize}`），再逐个加参数。
- **一次只加一个**，出现 500 就知道是谁的锅（本次：`sort_type` int、`status` int、`accountIds` 数组都会 500）。
- 参数类型陷阱：同名参数可能要 string / 数组 / 逗号分隔；不确定就都试一遍。
- 记录：**生效参数 / 被忽略参数 / 报错参数**三张清单（写进 SKILL 的"字段校准"）。

> 本次坑：`shop_user_id` 被静默忽略（不报错、结果全量），必须用 `shop_user_name` 或 `accountIds`；`date_time` 必须是 `["YYYY-MM-DD","YYYY-MM-DD"]` 数组。

## 3. 分页与总量（2 分钟）

- `pageSize` 上限：本次 shop/list=100、listing=固定 20、ads=20。
- `pagination.total/totalPages` 是否可信；翻第 2 页验证条数/去重。
- 取前 N 页时固定 `pages` 参数，避免误拉全量。

## 4. 字段与样例（2 分钟）

- 拉 1 页，打印：**字段总数、字段名、1 条完整样例、1 条 metrics 嵌套**。
- 标注：金额字段及币种、时间戳字段（秒/毫秒）、枚举字段取值（status/ad_kind）。
- 把字段清单直接贴进 SKILL 的「字段校准」。

## 5. 产出（提交前自检）

- [ ] `probe.mjs` 能一把跑通：鉴权 → 1 页数据 → 打印字段与样例
- [ ] 三张参数清单（生效/忽略/报错）
- [ ] 分页上限 + total 可信度
- [ ] 字段清单（含金额/时间/枚举）
- [ ] 结论写进 SKILL.md「字段校准（YYYY-MM-DD 实测）」

## 6. probe.mjs 模板（30 行，复制改 URL/参数/凭证即可）

```js
// probe.mjs —— 鉴权 → 1 页 → 打印字段/样例/枚举；输出写 probe-output.txt
// 凭证从服务端 .env 读取，禁止把明文写进探针
import { readFileSync } from 'node:fs';
const envPath = 'D:/www/dsh-plugin-factory/plugins/shop-list/service/.env';
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const KEY = process.env.LISTING_API_KEY || env.LISTING_API_KEY;
if (!KEY) { console.error('缺少凭证：.env 中未找到 LISTING_API_KEY'); process.exit(1); }
const URL = 'https://api.giikin.com/agent/shopee/user/openapi/<path>';
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };

async function call(label, body) {
  const res = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  const j = JSON.parse(await res.text());
  const d = j.data || {};
  console.log(label, '→ http=' + res.status, 'code=' + j.code, 'total=' + (d.pagination?.total ?? '-'), 'rows=' + (d.list || []).length);
  if (j.code !== 200) console.log('  msg=' + (j.message || j.msg || ''));
  return d;
}

const d = await call('base', { page: 1, pageSize: 20, /* 业务参数 */ });
const rows = d.list || [];
if (rows[0]) {
  console.log('字段数:', Object.keys(rows[0]).length);
  console.log('字段:', Object.keys(rows[0]).join(','));
  console.log('样例:', JSON.stringify(rows[0]).slice(0, 1200));
}
// 枚举/大小写各试一次
await call('enum-lower', { page: 1, pageSize: 20, status: 'draft' });
await call('enum-upper', { page: 1, pageSize: 20, status: 'DRAFT' });
```

## 7. 枚举与类型漂移检查（盲测补充）

- **枚举大小写**：`draft` 与 `DRAFT` 实测等价；探针至少试原值 + 大小写变体 + 常见值列表，别猜。
- **类型漂移**：同一字段可能时而不定类型（实测 `price_range` 既有 `24.38` 数字、又有 `"27.1-30.28"` 字符串）。报告取值必须 `Number()` 兜底并跳过非数字。
- **空值语义**：空字符串/0 可能是"从未发生"（如 `upload_time=''` = 从未上架），不是"数据缺失"，要在 SKILL 口径里写清。
- **静默忽略**：参数不报错但结果不变 = 被忽略（如 `shop_user_id`、`pageSize`），列为「被忽略参数」。
