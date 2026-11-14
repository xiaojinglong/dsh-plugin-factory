'use strict';
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/draft-cleanup.json');
boot(manifest, require('./fetcher').runJob);
