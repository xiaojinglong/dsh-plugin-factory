// api-adapter.test.mjs —— 分页/重试/字段归一化（本地 mock API）
import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { fetchPaged, normalizeItems } from '../../scenarios/api-adapter.mjs';

function startMock() {
  let page1Hits = 0;
  let auth = '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const page = Number(url.searchParams.get('page') || 1);
    if (page === 1) {
      page1Hits += 1;
      auth = req.headers.authorization || '';
      if (page1Hits === 1) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"transient"}'); return; }
    }
    const list = page === 1
      ? [{ channel: 'Google Ads', spend: '100', impressions: '1000', clicks: '50', leads: '5', orders: '2', revenue: '300' }, { channel: 'SEO', spend: '50', impressions: '800', clicks: '40', leads: '4', orders: '3', revenue: '400' }]
      : page === 2 ? [{ channel: 'EDM', spend: '20', impressions: '100', clicks: '10', leads: '2', orders: '1', revenue: '90' }] : [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: { list } }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, hits: () => page1Hits, auth: () => auth }));
  });
}

test('API：分页拉取 + 500 自动重试 + Bearer token', async () => {
  const mock = await startMock();
  try {
    const items = await fetchPaged({
      baseUrl: `http://127.0.0.1:${mock.port}`, path: '/rows', token: 'test-token',
      pageSize: 2, maxPages: 5, itemsPath: 'data.list', retries: 2,
    });
    assert.equal(items.length, 3);
    assert.equal(mock.hits(), 2, '第一页应重试一次');
    assert.match(mock.auth(), /^Bearer test-token$/);
  } finally { mock.server.close(); }
});

test('API→渠道 ROI：字符串数字归一化', () => {
  const data = normalizeItems('promo-channel-roi', [
    { channel: 'Google Ads', spend: '100', impressions: '1000', clicks: '50', leads: '5', orders: '2', revenue: '300' },
  ]);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].spend, 100);
  assert.equal(typeof data.rows[0].revenue, 'number');
});
