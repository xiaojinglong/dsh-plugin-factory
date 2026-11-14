'use strict';
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/ads-list.json');
boot(manifest, require('./fetcher').runJob);
