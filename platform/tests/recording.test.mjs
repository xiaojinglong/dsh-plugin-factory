import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateRecording } = require('../../packages/recording');

test('recording：合法事件序列', () => {
  const r = validateRecording({
    name: 'demo',
    durationMs: 100,
    events: [
      { t: 0, type: 'mouse_move', x: 10, y: 20 },
      { t: 10, type: 'mouse_down', x: 10, y: 20, button: 'left' },
      { t: 20, type: 'mouse_up', x: 10, y: 20, button: 'left' },
      { t: 30, type: 'key_down', key: 65 },
      { t: 40, type: 'key_up', key: 65 },
    ],
  });
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('recording：拒绝非法坐标和倒序时间', () => {
  const r = validateRecording({
    name: 'bad',
    events: [
      { t: 20, type: 'mouse_move', x: 1, y: 2 },
      { t: 10, type: 'mouse_down', x: 'x', y: 2, button: 'left' },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /t 非递增|坐标非法/.test(e)));
});
