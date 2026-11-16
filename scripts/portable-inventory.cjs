#!/usr/bin/env node
'use strict';
// 清点 30 个旧插件的可迁移性；只读，不修改插件。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const dir = path.join(ROOT, 'platform', 'manifests');
const rows = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const hasBrowser = m.type === 'browser' || !!m.permissions?.browser;
    const hasService = !!m.service;
    const tier = hasBrowser ? 'T2-candidate' : 'T1-candidate';
    return {
      id: m.id,
      type: m.type,
      effect: m.effect || 'read',
      hasBrowser,
      hasService,
      tier,
      notes: m.legacy ? ['legacy'] : [],
    };
  });
console.log(JSON.stringify({ total: rows.length, rows }, null, 2));
