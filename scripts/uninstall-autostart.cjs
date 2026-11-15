#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const startup = path.join(process.env.APPDATA || path.join(require('node:os').homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const target = path.join(startup, 'DSHPluginFactory.vbs');
if (fs.existsSync(target)) { fs.rmSync(target, { force: true }); console.log(`[autostart] 已移除：${target}`); }
else console.log('[autostart] 未安装');
