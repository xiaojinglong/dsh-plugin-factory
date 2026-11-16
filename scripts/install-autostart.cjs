#!/usr/bin/env node
'use strict';
/** 安装登录自启：Startup 目录写一个 .cmd，避免 VBS 引号/执行策略问题 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const startup = path.join(process.env.APPDATA || path.join(require('node:os').homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const target = path.join(startup, 'DSHPluginFactory.cmd');
const oldVbs = path.join(startup, 'DSHPluginFactory.vbs');
const logDir = path.join(ROOT, 'data', 'logs');
const log = path.join(logDir, 'autostart.log');
fs.mkdirSync(startup, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
const q = (s) => `"${s}"`;
const cmd = `@echo off\r
chcp 65001 >nul\r
cd /d ${q(ROOT)}\r
${q(process.execPath)} ${q(path.join(ROOT, 'scripts', 'start-factory.cjs'))} >> ${q(log)} 2>&1\r
exit /b 0\r
`;
fs.writeFileSync(target, cmd, 'utf8');
if (fs.existsSync(oldVbs)) fs.rmSync(oldVbs, { force: true });
console.log(`[autostart] 已安装：${target}`);
console.log(`[autostart] 旧 VBS：${fs.existsSync(oldVbs) ? '仍存在' : '已移除'}`);
console.log('[autostart] 登录 Windows 后自动启动；日志：data/logs/autostart.log');
