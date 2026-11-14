'use strict';
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/gsmp-academy.json');
boot(manifest, require('./crawler').runJob, require('./crawler').closeBrowser);
