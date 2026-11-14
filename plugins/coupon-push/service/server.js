'use strict';
const { boot } = require('../../../platform/factory/bootstrap');
const manifest = require('../../../platform/manifests/coupon-push.json');
boot(manifest, require('./runner').runJob);
