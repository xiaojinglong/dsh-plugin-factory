#!/usr/bin/env node
'use strict';
/** 安装登录自启：在用户 Startup 目录写一个隐藏启动脚本 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const startup = path.join(process.env.APPDATA || path.join(require('node:os').homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const target = path.join(startup, 'DSHPluginFactory.vbs');
const logDir = path.join(ROOT, 'data', 'logs');
const log = path.join(logDir, 'autostart.log');
fs.mkdirSync(startup, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
const q = (s) => `"${s.replace(/"/g, '""')}"`;
const vbs = `Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c cd /d ${q(ROOT)} && node scripts\\start-factory.cjs >> ${q(log)} 2>&1", 0, False
`;
fs.writeFileSync(target, vbs, 'utf8');
console.log(`[autostart] 已安装：${target}`);
console.log('[autostart] 登录 Windows 后会自动启动控制面与插件服务；日志：data/logs/autostart.log');
