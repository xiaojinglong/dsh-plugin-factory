# A 单机版安装器入口（PowerShell 5.1；本文件必须 UTF-8 带 BOM）
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$installer = Join-Path $repo 'apps\installer\installer.cjs'
& node $installer @args
exit $LASTEXITCODE
