'use strict';

const fs = require('node:fs');
const path = require('node:path');

// staging 与安装后的目录深度不同：向上找到含 platform/factory/bootstrap.js 的工厂根
function findRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'platform', 'factory', 'bootstrap.js'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, '..', '..', '..', '..');
}

const root = process.env.FACTORY_ROOT || findRoot(__dirname);
const { boot } = require(path.join(root, 'platform', 'factory', 'bootstrap'));
const manifest = require('../manifest.json');

boot(manifest, require('./runner').runJob);
