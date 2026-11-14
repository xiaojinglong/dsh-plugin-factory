'use strict';

/**
 * apps/generator/probe.cjs —— 勘探适配器（M3）
 * 支持：fixture 文件、本机 HTTP JSON（127.0.0.1/localhost）。真实外部 API/浏览器勘探后续接入。
 */

const fs = require('node:fs');
const path = require('node:path');

function summarizeList(list) {
  const rows = Array.isArray(list) ? list : [];
  const fields = rows.length && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];
  return { count: rows.length, fields, sample: rows.slice(0, 3) };
}

async function probeFixture(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`fixture 不存在：${abs}`);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const list = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []);
  return { kind: 'fixture', source: abs, ...summarizeList(list) };
}

function assertLocalUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error(`非法 apiUrl：${raw}`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('apiUrl 只支持 http/https');
  if (!['127.0.0.1', 'localhost', '::1'].includes(u.hostname)) {
    throw new Error(`M3 仅允许本机 HTTP 勘探（当前 ${u.hostname}）；公网/内网目标需后续 allowlist + 审批`);
  }
  return u;
}
async function probeHttp(apiUrl) {
  const u = assertLocalUrl(apiUrl);
  const res = await fetch(u, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  const list = Array.isArray(json) ? json : (json && (json.list || (json.data && json.data.list)) || []);
  return {
    kind: 'http', source: u.toString(), status: res.status, contentType: res.headers.get('content-type') || '',
    bytes: Buffer.byteLength(text), ...summarizeList(list),
  };
}

async function probe(params = {}) {
  if (params.fixture) return probeFixture(params.fixture);
  if (params.apiUrl) return probeHttp(params.apiUrl);
  throw new Error('缺少勘探参数：需要 params.fixture 或 params.apiUrl');
}

module.exports = { probe, probeFixture, probeHttp, summarizeList };
