export async function requestJson(url, options = {}) {
  const u = new URL(url);
  const allowed = Array.isArray(options.allowedHosts) ? options.allowedHosts : [];
  if (allowed.length && !allowed.includes(u.hostname)) throw new Error(`host not allowed: ${u.hostname}`);
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

export function credential(name, required = false) {
  const value = process.env[name];
  if (!value && required) throw new Error(`missing credential: ${name}`);
  return value;
}
