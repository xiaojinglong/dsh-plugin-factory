'use strict';
// smoke.cjs —— concise-analysis（legacy）健康冒烟
const http = require('node:http');
const url = 'http://127.0.0.1:8790/health';
http.get(url, (res) => { let d=''; res.on('data',(c)=>d+=c); res.on('end',()=>{ const j=JSON.parse(d); if(!j.ok) { console.error('[FAIL]', d); process.exit(1);} console.log('[ok] concise-analysis health', d); }); }).on('error',(e)=>{ console.error('[FAIL]', e.message); process.exit(1); });