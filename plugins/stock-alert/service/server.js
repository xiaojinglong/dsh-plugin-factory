'use strict';
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/stock-alert.json');
boot(manifest, require('./fetcher').runJob);
