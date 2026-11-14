// probe-draft.mjs —— draft-cleanup 接口勘探：确认 status 取值、总量、字段与样例
const KEY = process.env.LISTING_API_KEY || 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const URL = 'https://api.giikin.com/agent/shopee/user/openapi/listing/listing';
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const base = { page: 1, pageSize: 20, shop_user_id: 632016, shop_user_name: '陈雄德' };

async function call(body) {
  const res = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  const j = JSON.parse(await res.text());
  return { http: res.status, j };
}

console.log('=== 1) status 取值勘探（shop_user_name=陈雄德）===');
const cases = [
  ['NORMAL', { status: 'NORMAL' }],
  ['DRAFT', { status: 'DRAFT' }],
  ['ALL(不传 status)', {}],
  ['draft(小写)', { status: 'draft' }],
  ['DRAFT+page2', { status: 'DRAFT', page: 2 }],
];
for (const [label, add] of cases) {
  try {
    const { http, j } = await call({ ...base, ...add });
    const d = j.data || {};
    const list = d.list || [];
    console.log(
      `${label.padEnd(18)} http=${http} code=${j.code} total=${d.pagination?.total} totalPages=${d.pagination?.totalPages} rows=${list.length}` +
        (j.code !== 200 ? ` msg=${String(j.message || '').slice(0, 70)}` : '')
    );
    if (list.length) {
      console.log('   status 样本:', [...new Set(list.map((x) => x.status))].join(','), '| 前3条:', list.slice(0, 3).map((x) => `${x.id}:${x.item_name?.slice(0, 12)}`).join(' | '));
    }
  } catch (e) {
    console.log(`${label.padEnd(18)} ERROR ${e.message}`);
  }
}

console.log('\n=== 2) DRAFT 字段勘探 ===');
const { j } = await call({ ...base, status: 'DRAFT' });
const d = j.data || {};
const list = d.list || [];
console.log('pagination =', JSON.stringify(d.pagination));
console.log('data keys =', Object.keys(d).join(','));
const row = list[0] || {};
console.log('字段数 =', Object.keys(row).length);
console.log('字段名 =', Object.keys(row).join(','));
console.log('\n完整样例(第1条，截断长文本) =');
const trunc = {};
for (const [k, v] of Object.entries(row)) trunc[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v;
console.log(JSON.stringify(trunc, null, 2));

console.log('\n=== 3) 第2页样本 ===');
const { j: j2 } = await call({ ...base, status: 'DRAFT', page: 2 });
const l2 = j2.data?.list || [];
console.log('page2 rows =', l2.length, '| status =', [...new Set(l2.map((x) => x.status))].join(','), '| ids =', l2.slice(0, 3).map((x) => x.id).join(','));
