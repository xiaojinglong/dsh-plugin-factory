'use strict';
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/fs-ledger.json');
boot(manifest, require('./runner').runJob);
