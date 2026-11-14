// probe10.mjs —— 用 dk key 试探 Acore 侧是否存在"应用/凭证"接口
const KEY = 'dk-ai-p-1995c7dd1ddb4a3db4baa110683480c7';
const auth = { authorization: KEY, 'content-type': 'application/json' };

const paths = [
  ['GET',  '/acore/user/v1/open/info'],
  ['GET',  '/acore/auth/v1/open/info'],
  ['POST', '/acore/app/v1/open/page'],
  ['POST', '/acore/application/v1/open/page'],
  ['POST', '/acore/open/v1/app/page'],
  ['POST', '/acore/ai/v1/app/page'],
  ['GET',  '/acore/skill/v1/open/page'],
  ['POST', '/acore/tool/v1/open/page'],
  ['POST', '/acore/mcp/v1/open/page'],
];

for (const [method, path] of paths) {
  try {
    const res = await fetch('https://api.giikin.com' + path, {
      method,
      headers: auth,
      body: method === 'POST' ? JSON.stringify({ page: 1, pageSize: 1 }) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    console.log(`${method} ${path} → ${res.status} ${text.slice(0, 180).replace(/\n/g, ' ')}`);
  } catch (e) {
    console.log(`${method} ${path} → ERROR ${e.message}`);
  }
}
