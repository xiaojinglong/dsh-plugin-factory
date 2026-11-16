'use strict';
// 沙箱网络守卫：在用户代码加载前 patch 常见网络入口。
// 说明：这是策略层拦截，不是内核级网络隔离；用于阻止误用/越权声明。
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const dgram = require('node:dgram');
const dns = require('node:dns');

const ALLOWED = new Set(String(process.env.DSH_SANDBOX_NETWORK || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
function deny(host) {
  const h = String(host || '').toLowerCase();
  if (!ALLOWED.size) throw new Error(`network blocked: no network permission (${h || 'unknown'})`);
  if (!ALLOWED.has(h)) throw new Error(`network blocked: ${h} not in network allowlist`);
}
function hostOf(args) {
  const a = args[0];
  if (typeof a === 'string') {
    try { return new URL(a).hostname; } catch { return a; }
  }
  if (a instanceof URL) return a.hostname;
  if (a && typeof a === 'object') return a.hostname || a.host || a.path || '';
  return '';
}
function patch(obj, name, getHost) {
  if (!obj || typeof obj[name] !== 'function') return;
  const orig = obj[name];
  obj[name] = function patched(...args) {
    const host = getHost(args);
    if (host) deny(host);
    return orig.apply(this, args);
  };
}
const connectHost = (args) => {
  const a = args[0];
  if (typeof a === 'object' && a) return a.host || a.hostname || a.path || '';
  if (typeof a === 'number') return typeof args[1] === 'string' ? args[1] : 'localhost';
  return typeof a === 'string' ? a : '';
};
patch(net, 'connect', connectHost);
patch(net, 'createConnection', connectHost);
patch(net.Socket.prototype, 'connect', connectHost);
patch(tls, 'connect', connectHost);
patch(dgram, 'createSocket', () => '');
patch(dns, 'lookup', (args) => String(args[0] || ''));
patch(http, 'request', (args) => hostOf(args));
patch(https, 'request', (args) => hostOf(args));
if (typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch;
  globalThis.fetch = function patchedFetch(input, init) {
    let host = '';
    try {
      const u = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url);
      host = u.hostname;
    } catch { host = ''; }
    if (host) deny(host);
    return origFetch.call(this, input, init);
  };
}
