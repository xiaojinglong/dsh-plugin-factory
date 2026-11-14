// probe-ads2.mjs —— 找到有数据的 ads/list 参数
const KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const URL = 'https://api.giikin.com/agent/shopee/user/openapi/ads/list';
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const post = async (body) => {
  const res = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  return JSON.parse(await res.text());
};

const shops = ['1937161402', '1097451512', '250963379', '1013044949'];
const dates = [
  ['2026-11-01', '2026-11-13'],
  ['2026-10-01', '2026-11-13'],
  ['2026-09-17', '2026-09-23'],
  ['2026-11-01 00:00:00', '2026-11-13 23:59:59'],
];
for (const shop of shops) {
  for (const dt of dates) {
    const j = await post({ shop_id: shop, date_time: dt, page: 1, pageSize: 5 });
    const d = j.data || {};
    const rows = d.list || [];
    console.log(`shop=${shop} date=${dt.join('~')} → code=${j.code} total=${d.pagination?.total ?? d.total} rows=${rows.length}${rows.length ? ' | first keys=' + Object.keys(rows[0]).slice(0, 12).join(',') : ''}`);
    if (rows.length) { console.log('  sample:', JSON.stringify(rows[0]).slice(0, 400)); process.exit(0); }
  }
}
console.log('none found');
