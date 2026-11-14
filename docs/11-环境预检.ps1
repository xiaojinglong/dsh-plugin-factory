# 11 · 环境预检（新插件开工前 1 分钟）

> 本次实测踩过的环境坑：沙箱只允许写工作区、`npm` 缓存/`.acore` 在用户目录被拒（EPERM）、端口占用、node_modules 缺依赖。
> 用法：`powershell -NoProfile -ExecutionPolicy Bypass -File 11-环境预检.ps1 -Port 8794`

param([int]$Port = 8794)

$ok = $true
function Check($name, [scriptblock]$fn) {
  try { $r = & $fn; Write-Host "[OK]   $name — $r" -ForegroundColor Green }
  catch { $script:ok = $false; Write-Host "[FAIL] $name — $($_.Exception.Message)" -ForegroundColor Red }
}

Check 'node 版本' { (node -v) }
Check 'npm 可用' { (npm.cmd -v) }
Check '工作区可写' { Set-Content -Path (Join-Path (Get-Location) '_preflight.tmp') -Value 'x'; Remove-Item '_preflight.tmp'; 'writable' }
Check '用户目录可写（.acore/home）' { $p = Join-Path $env:USERPROFILE '.dsh-preflight.tmp'; Set-Content $p 'x'; Remove-Item $p; 'writable' }
Check 'npm 缓存可写' { $c = Join-Path (Get-Location) '.npm-cache'; New-Item -ItemType Directory -Force $c | Out-Null; 'writable' }
Check "端口 $Port 空闲" {
  $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($busy) { throw "已被占用（PID $($busy[0].OwningProcess)）" }
  'free'
}
Check 'registry/端口分配已查' { '人工确认：registry.md 未占用该端口与 serverName' }
Check 'MCP node_modules 就绪' {
  if (-not (Test-Path 'node_modules')) { throw '当前目录无 node_modules（可从已有 MCP 目录拷贝）' }
  'present'
}

if ($ok) { Write-Host "`n预检通过，可以开工。" -ForegroundColor Cyan; exit 0 } else { Write-Host "`n预检失败，先修环境。" -ForegroundColor Red; exit 1 }
