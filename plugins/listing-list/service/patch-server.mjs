import fs from 'node:fs';
let s = fs.readFileSync('server.js', 'utf8');
s = s.replace("const crawler = require('./crawler');", "const fetcher = require('./fetcher');");
s = s.replace('manager.setRunner(crawler.runJob)', 'manager.setRunner(fetcher.runJob)');
s = s.replace(/\/\/ 预热浏览器[\s\S]*?crawler\.getBrowser\(\)[\s\S]*?\n/, '');
s = s.replace('await crawler.closeBrowser();', 'await Promise.resolve();');
fs.writeFileSync('server.js', s, 'utf8');
console.log('patched:', !s.includes("require('./crawler')"), s.includes('fetcher.runJob'));
