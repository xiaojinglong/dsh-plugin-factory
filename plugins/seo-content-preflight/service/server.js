'use strict';

const path = require('node:path');
const fs = require('node:fs');
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
