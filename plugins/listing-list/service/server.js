'use strict';
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/listing-list.json');
boot(manifest, require('./fetcher').runJob);
