'use strict';

/**
 * mock-upstream.js —— bulk-sync 的自包含模拟上游（仅用于工厂复杂场景验证，不连接任何真实系统）
 *
 * 行为开关（由 fetcher 通过任务参数透传）：
 *   total_rows   总行数（默认 240）
 *   delay_ms     每次响应延迟毫秒（默认 80，用于验证取消/进度）
 *   fail_first_n 前 N 次请求返回 HTTP 500（用于验证 api-runner 自动重试 1 次）
 *   empty        true 时返回空列表（用于验证空数据契约）
 *
 * 监听 127.0.0.1:0（随机端口），由 server.js 启动后把地址写入 env.MOCK_UPSTREAM_URL。
 */

const http = require('node:http');

function pad(n, w = 6) { return String(n).padStart(w, '0'); }

function makeRows({ total, page, pageSize }) {
  const start = (page - 1) * pageSize;
  const end = Math.min(total, start + pageSize);
  const sites = ['sg', 'my', 'th', 'id', 'ph'];
  const statuses = ['PAID', 'SHIPPED', 'DELIVERED', 'REFUNDED'];
  const rows = [];
  for (let i = start; i < end; i += 1) {
    const n = i + 1;
    rows.push({
      order_id: `SO-${pad(n)}`,
      shop_id: `SHOP-${(n % 5) + 1}`,
      site: sites[n % sites.length],
      currency: 'USD',
      amount: Number((12.5 + (n % 37) * 3.4).toFixed(2)),
      status: statuses[n % statuses.length],
      buyer_country: sites[(n + 2) % sites.length].toUpperCase(),
      line_items: (n % 3) + 1,
      created_at: new Date(Date.UTC(2026, 10, 1, 8, 0, 0) + n * 3600000).toISOString(),
    });
  }
  return rows;
}

function startMockUpstream() {
  const state = { requests: 0, injectedFailures: 0, servedPages: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, service: 'mock-upstream' });
      if (req.method !== 'POST' || !String(req.url).startsWith('/mock/orders')) return send(404, { error: 'not found' });

      let p = {};
      try { p = JSON.parse(body || '{}'); } catch { /* ignore */ }
      state.requests += 1;

      const delay = Math.max(0, Math.min(5000, Number(p.delay_ms) || 0));
      if (delay) await new Promise((r) => setTimeout(r, delay));

      const failFirst = Math.max(0, Math.min(10, Number(p.fail_first_n) || 0));
      if (state.requests <= failFirst) {
        state.injectedFailures += 1;
        return send(500, { code: 500, message: '模拟上游瞬态 500（用于验证重试）' });
      }

      const total = Math.max(0, Math.min(100000, Number(p.total_rows) || 240));
      const pageSize = Math.max(1, Math.min(200, Number(p.pageSize) || 50));
      const page = Math.max(1, Number(p.page) || 1);
      const list = p.empty === true ? [] : makeRows({ total, page, pageSize });
      const totalPages = Math.ceil(total / pageSize);
      state.servedPages += 1;
      return send(200, {
        code: 200,
        data: {
          list,
          pagination: { total, totalPages, page, pageSize },
          servedAt: new Date().toISOString(),
        },
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      // 只服务本插件；不阻塞进程退出（Fastify 会维持事件循环）
      if (server.unref) server.unref();
      process.on('exit', () => { try { server.close(); } catch { /* ignore */ } });
      resolve({ url: `http://127.0.0.1:${port}`, port, server, stats: () => ({ ...state }), reset: () => { state.requests = 0; state.injectedFailures = 0; state.servedPages = 0; } });
    });
  });
}

module.exports = { startMockUpstream, makeRows };
