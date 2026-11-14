'use strict';
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/haina-comment.json');
boot(manifest, require('./crawler').runJob, require('./crawler').closeBrowser);
