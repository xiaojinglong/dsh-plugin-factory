import { readFile } from 'node:fs/promises';
const ds = JSON.parse(await readFile(process.argv[2], 'utf8'));
const rows = ds.pages.flatMap(p => p.rows || []);
const dist = (fn) => { const m = new Map(); for (const r of rows) { const k = fn(r) ?? '(空)'; m.set(k, (m.get(k)||0)+1); } return JSON.stringify([...m.entries()].sort((a,b)=>b[1]-a[1])); };
for (const k of ['upload_mode_cn','data_source','source','adopt_source','ai_image_gen_status_message','pending_status','pending_message','fail_log','shop_status','type','distribute_mode','is_pre_order','days_to_ship','currency_id','team_id','account_id','used_ai_image']) {
  console.log(k, '=', dist(r=> (typeof r[k]==='object') ? JSON.stringify(r[k]) : r[k]));
}
console.log('original_price==current_price:', rows.filter(r=>String(r.original_price)===String(r.current_price)).length);
console.log('price_range>0:', rows.filter(r=>Number(r.price_range)>0).length);
console.log('item_sku 空:', rows.filter(r=>!String(r.item_sku||'').trim()).length);
console.log('url 空:', rows.filter(r=>!String(r.url||'').trim()).length);
console.log('account 样例:', JSON.stringify(rows[0].account));
console.log('account 有值:', rows.filter(r=>r.account && r.account.account).length);
const ages = rows.map(r=>{const t=new Date(String(r.update_time).replace(' ','T')); return Math.round((Date.now()-t.getTime())/86400000);});
console.log('age days set:', JSON.stringify([...new Set(ages)]));
console.log('cscores:', JSON.stringify([...new Set(rows.map(r=>r.content_score))]));
console.log('weights:', JSON.stringify([...new Set(rows.map(r=>r.weight))].slice(0,8)));
