// probe.mjs —— stock-alert 接口勘探：主机/鉴权/参数三清单/分页/字段/枚举/类型漂移
// 运行：node probe.mjs ; 结果同时写 probe-output.txt（UTF-8）
import { readFileSync, writeFileSync } from 'node:fs';

const ENV_FILE = 'D:/www/dsh-plugin-factory/plugins/ads-list/service/.env';
const KEY = (() => {
  const line = readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).find((l) => l.startsWith('LISTING_API_KEY='));
  return line ? line.slice('LISTING_API_KEY='.length).trim() : '';
})();
const URL = 'https://api.giikin.com/agent/shopee/user/openapi/listing/listing';
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const out = [];
const log = (s) => { out.push(s); console.log(s); };

async function call(label, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch { log(`${label} → http=${res.status} 非JSON：${text.slice(0, 200)}`); return null; }
    const d = j.data || {};
    const rows = Array.isArray(d.list) ? d.list : [];
    const pag = d.pagination || {};
    log(`${label} → http=${res.status} code=${j.code} msg=${j.message || j.msg || '-'} rows=${rows.length} total=${pag.total ?? d.total ?? '-'} totalPages=${pag.totalPages ?? '-'} ms=${Date.now() - t0}`);
    if (j.code !== 200) return null;
    return d;
  } catch (e) {
    log(`${label} → 异常 ${e.message} ms=${Date.now() - t0}`);
    return null;
  }
}

log('# stock-alert listing 接口勘探');
log(`# 时间：${new Date().toISOString()}  主机：api.giikin.com  path=/agent/shopee/user/openapi/listing/listing`);
log(`# 鉴权：Authorization: Bearer <LISTING_API_KEY 已配置，长度 ${KEY.length}>`);

// 1) 最小参数
const d1 = await call('P1 最小 {page,pageSize}', { page: 1, pageSize: 20 });

// 2) 负责人参数
const d2 = await call('P2 +shop_user_name=陈雄德', { page: 1, pageSize: 20, shop_user_name: '陈雄德' });
const d3 = await call('P3 +shop_user_name=陈雄德 +status=NORMAL', { page: 1, pageSize: 20, shop_user_name: '陈雄德', status: 'NORMAL' });
const d4 = await call('P4 status=normal 大小写', { page: 1, pageSize: 20, shop_user_name: '陈雄德', status: 'normal' });
const d5 = await call('P5 status=SOLD_OUT', { page: 1, pageSize: 20, shop_user_name: '陈雄德', status: 'SOLD_OUT' });
const d6 = await call('P6 status=1（int）', { page: 1, pageSize: 20, shop_user_name: '陈雄德', status: 1 });
const d7 = await call('P7 shop_user_id=632016', { page: 1, pageSize: 20, shop_user_id: 632016, status: 'NORMAL' });

// 3) 分页上限
const d8 = await call('P8 pageSize=100', { page: 1, pageSize: 100, shop_user_name: '陈雄德', status: 'NORMAL' });
const d9 = await call('P9 page=2 pageSize=20', { page: 2, pageSize: 20, shop_user_name: '陈雄德', status: 'NORMAL' });

// 4) 字段与样例
const rows = (d3 && Array.isArray(d3.list)) ? d3.list : [];
log(`\n## 字段清单（P3 第 1 条）字段数=${rows[0] ? Object.keys(rows[0]).length : 0}`);
if (rows[0]) {
  log('字段名：' + Object.keys(rows[0]).join(','));
  log('完整样例：' + JSON.stringify(rows[0], null, 1));
  const stacks = ['normal_stock', 'warehouse_stock_total', 'oversea_stock', 'status', 'site', 'shop_name', 'sales_30d', 'sold_30d', 'item_name', 'item_id'];
  log('\n## 关键字段类型/取值（前 8 条）');
  for (const r of rows.slice(0, 8)) {
    log(stacks.map((k) => `${k}=${JSON.stringify(r[k])}(${typeof r[k]})`).join(' | '));
  }
  log('\n## status 枚举取值（本页）：' + [...new Set(rows.map((r) => r.status))].join(','));
  log('## 字段类型漂移扫描（同页）：');
  const allKeys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  for (const k of allKeys) {
    const types = [...new Set(rows.map((r) => (r[k] === null ? 'null' : Array.isArray(r[k]) ? 'array' : typeof r[k])))];
    if (types.length > 1) log(`  ${k}: ${types.join('/')}`);
  }
}

// 5) total 可信度：第 2 页首条 vs 第 1 页，是否重复
if (d9 && Array.isArray(d9.list) && rows.length) {
  const ids1 = new Set(rows.map((r) => r.item_id ?? r.id));
  const dup = d9.list.filter((r) => ids1.has(r.item_id ?? r.id)).length;
  log(`\n## 分页校验：第 2 页 ${d9.list.length} 条，与第 1 页重复 ${dup} 条`);
}

writeFileSync('D:/www/dsh-plugin-factory/plugins/stock-alert/probe/probe-output.txt', out.join('\n') + '\n', 'utf8');
console.log('\n[written] probe-output.txt');
