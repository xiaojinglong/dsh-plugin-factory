<#
  verify-mcp.ps1 — MCP 薄壳 + 数据服务冒烟（重启 DSH 之前必跑）

  用法：
    .\verify-mcp.ps1                                              # 用当前目录 config.json
    .\verify-mcp.ps1 -McpDir D:\www\dshskills\tools\concise-analysis-mcp
    .\verify-mcp.ps1 -McpDir ... -Full                            # 跑完整五连（提交真实任务）
    .\verify-mcp.ps1 -McpDir ... -Full -ParamsJson '{"onlySummary":true}'

  退出码：0 全绿；1 有失败项
#>
param(
  [string]$McpDir = '',
  [switch]$Full,
  [string]$ParamsJson = '{}',
  [int]$PollTimeoutSec = 900
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($McpDir)) { $McpDir = (Get-Location).Path }
$McpDir = (Resolve-Path $McpDir).Path
$ConfigPath = Join-Path $McpDir 'config.json'
$IndexPath = Join-Path $McpDir 'index.js'
$script:failed = 0

function Check([string]$name, [scriptblock]$action) {
  try {
    $detail = & $action
    Write-Host "[PASS] $name — $detail" -ForegroundColor Green
    return $detail
  } catch {
    $script:failed++
    Write-Host "[FAIL] $name — $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}

Write-Host "`n=== MCP 冒烟：$McpDir ===`n" -ForegroundColor Cyan

# 1) 配置可解析 + 取 baseUrl
$cfg = Check 'config.json 可解析' {
  if (-not (Test-Path $ConfigPath)) { throw "config.json 不存在：$ConfigPath" }
  $c = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace($c.service.baseUrl)) { throw 'service.baseUrl 为空（未装配）' }
  "baseUrl=$($c.service.baseUrl)"
}

# 2) index.js 语法
Check 'node --check index.js' {
  Push-Location $McpDir
  try { $out = & node --check index.js 2>&1; if ($LASTEXITCODE -ne 0) { throw ($out -join ' ') }; 'ok' }
  finally { Pop-Location }
} | Out-Null

# 3) 薄壳自检（loadConfig / statusMap / submit URL）
Check '薄壳自检 loadConfig/statusMap/buildUrl' {
  Push-Location $McpDir
  try {
    $js = "const m=require('./index.js');const c=m.loadConfig();console.log(m.mapTaskStatus(c,'done')+' | '+m.buildUrl(c,m.fillPath(c.endpoints.submit.path,{})))"
    $out = & node -e $js 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($out -join ' ') }
    ($out -join '').Trim()
  } finally { Pop-Location }
} | Out-Null

if (-not $cfg) { Write-Host "`n配置未就绪，跳过服务冒烟。`n" -ForegroundColor Yellow; exit 1 }

$baseUrl = ($cfg -replace '^baseUrl=', '').Trim().TrimEnd('/')

# 4) 服务健康
Check "/health 可达（$baseUrl）" {
  $r = Invoke-RestMethod -Uri "$baseUrl/health" -TimeoutSec 10
  if (-not $r.ok) { throw "health 返回异常：$($r | ConvertTo-Json -Compress)" }
  'ok'
} | Out-Null

if (-not $Full) {
  Write-Host "`n基础检查完成（未提交真实任务）。加 -Full 跑完整五连。`n" -ForegroundColor Cyan
  exit ([int]($script:failed -gt 0))
}

# 5) 提交任务
$jobId = Check 'POST /jobs 提交任务' {
  $body = $ParamsJson
  $r = Invoke-RestMethod -Uri "$baseUrl/jobs" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
  $id = if ($r.jobId) { $r.jobId } elseif ($r.taskId) { $r.taskId } else { throw '未返回 jobId' }
  $id
}
if (-not $jobId) { Write-Host "`n提交失败，终止。`n" -ForegroundColor Red; exit 1 }

# 6) 轮询到终态
$status = Check "轮询任务 $jobId" {
  $deadline = (Get-Date).AddSeconds($PollTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $s = Invoke-RestMethod -Uri "$baseUrl/jobs/$jobId" -TimeoutSec 20
    if ($s.status -in @('done', 'failed', 'waiting_verify')) { break }
    Start-Sleep -Seconds 3
  }
  if ($s.status -eq 'waiting_verify') { throw '任务进入 waiting_verify（需人工扫码），扫码后重跑本脚本' }
  if ($s.status -eq 'failed') { throw "任务失败：$($s.error)" }
  if ($s.status -ne 'done') { throw "轮询超时（当前 $($s.status)）" }
  "status=$($s.status)"
}
if (-not $status) { exit 1 }

# 7) 取结果
$resultPath = Check 'GET /result 取产物清单' {
  $r = Invoke-RestMethod -Uri "$baseUrl/jobs/$jobId/result" -TimeoutSec 20
  if (-not $r.main -or [string]::IsNullOrWhiteSpace($r.main.path)) { throw 'result.main 为空' }
  $r.main.path
}
if (-not $resultPath) { exit 1 }

# 8) 解析产物文件（用薄壳自身解析器）
Check '薄壳解析产物文件' {
  Push-Location $McpDir
  try {
    $js = "require('./index.js').parseResultFile(process.argv[1]).then(r=>{if(!r.ok)throw new Error(r.error);console.log(r.type+':'+((r.rows&&r.rows.length)||0)+' rows')}).catch(e=>{console.error(e.message);process.exit(1)})"
    $out = & node -e $js $resultPath 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($out -join ' ') }
    ($out -join '').Trim()
  } finally { Pop-Location }
} | Out-Null

if ($script:failed -eq 0) {
  Write-Host "`n=== 全部通过（taskId=$jobId）===" -ForegroundColor Green
  exit 0
} else {
  Write-Host "`n=== 有 $($script:failed) 项失败 ===" -ForegroundColor Red
  exit 1
}
