'use strict';
// packages/recording.js —— 桌面录制格式与校验
const fs = require('node:fs');
const path = require('node:path');

const TYPES = new Set(['mouse_move', 'mouse_down', 'mouse_up', 'wheel', 'key_down', 'key_up', 'text']);
const BUTTONS = new Set(['left', 'right', 'middle']);

function validateRecording(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['recording 必须是对象'] };
  const name = String(input.name || '').trim();
  if (!name) errors.push('name 不能为空');
  const events = Array.isArray(input.events) ? input.events : null;
  if (!events) errors.push('events 必须是数组');
  if (events && events.length > 100000) errors.push('events 过多');
  let last = 0;
  for (const [i, e] of (events || []).entries()) {
    if (!e || typeof e !== 'object') { errors.push(`events[${i}] 非法`); continue; }
    if (!TYPES.has(e.type)) errors.push(`events[${i}].type 非法`);
    if (typeof e.t !== 'number' || e.t < last) errors.push(`events[${i}].t 非递增`);
    else last = e.t;
    if (['mouse_move', 'mouse_down', 'mouse_up', 'wheel'].includes(e.type)) {
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) errors.push(`events[${i}] 坐标非法`);
    }
    if (e.type === 'mouse_down' || e.type === 'mouse_up') {
      if (!BUTTONS.has(e.button)) errors.push(`events[${i}].button 非法`);
    }
    if (e.type === 'key_down' || e.type === 'key_up') {
      if (!Number.isInteger(e.key) || e.key < 1 || e.key > 255) errors.push(`events[${i}].key 非法`);
    }
    if (e.type === 'text' && typeof e.text !== 'string') errors.push(`events[${i}].text 非法`);
  }
  return { ok: errors.length === 0, errors };
}

function saveRecording(file, recording) {
  const v = validateRecording(recording);
  if (!v.ok) throw new Error(`recording 非法：${v.errors.join('; ')}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(recording, null, 2) + '\n', 'utf8');
  return file;
}

function loadRecording(file) {
  const recording = JSON.parse(fs.readFileSync(file, 'utf8'));
  const v = validateRecording(recording);
  if (!v.ok) throw new Error(`recording 非法：${v.errors.join('; ')}`);
  return recording;
}

module.exports = { validateRecording, saveRecording, loadRecording };
