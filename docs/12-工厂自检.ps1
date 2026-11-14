# 12 · 工厂自检脚本（发布前 / 新增插件后跑一次）
# 检查：技能命名 → MCP 结构 → patch 一致性 → 端口唯一 → 服务健康
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File 12-工厂自检.ps1 [-SkipHealth]

param([switch]$SkipHealth)

$ErrorActionPreference = 'Continue'
$repo = 'D:\www\dshskills'
$patch = "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml"
$fail = 0
function Ok($m) { Write-Host "[OK]   $m" -ForegroundColor Green }
function Bad($m) { $script:fail++; Write-Host "[FAIL] $m" -ForegroundColor Red }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

Write-Host "`n=== 1. 技能检查（skills/*/SKILL.md） ===" -ForegroundColor Cyan
$skills = Get-ChildItem "$repo\skills" -Directory -ErrorAction SilentlyContinue
foreach ($s in $skills) {
  $f = Join-Path $s.FullName 'SKILL.md'
  if (-not (Test-Path $f)) { Bad "$($s.Name)：缺 SKILL.md"; continue }
  $t = Get-Content $f -Raw -Encoding UTF8
  if ($t -notmatch '(?m)^---') { Bad "$($s.Name)：frontmatter 缺失"; continue }
  $nm = [regex]::Match($t, '(?m)^name:\s*(\S+)').Groups[1].Value
  $desc = [regex]::Match($t, '(?m)^description:\s*(.+)').Groups[1].Value
  if ($nm -ne $s.Name) { Bad "$($s.Name)：name=$nm 与目录不一致" } else { Ok "$($s.Name)：name 一致" }
  if ([string]::IsNullOrWhiteSpace($desc)) { Bad "$($s.Name)：description 为空" } else { Ok "$($s.Name)：有触发词描述" }
}

Write-Host "`n=== 2. MCP 薄壳检查（tools/*-mcp） ===" -ForegroundColor Cyan
$tools = Get-ChildItem "$repo\tools" -Directory -ErrorAction SilentlyContinue
$toolBaseUrls = @{}
foreach ($t in $tools) {
  foreach ($need in @('index.js', 'config.json', 'package.json')) {
    if (-not (Test-Path (Join-Path $t.FullName $need))) { Bad "$($t.Name)：缺 $need" }
  }
  $idx = Join-Path $t.FullName 'index.js'
  if (Test-Path $idx) {
    node --check $idx 2>$null
    if ($LASTEXITCODE -ne 0) { Bad "$($t.Name)：node --check 失败" } else { Ok "$($t.Name)：语法通过" }
  }
  $cfg = Join-Path $t.FullName 'config.json'
  if (Test-Path $cfg) {
    try {
      $c = Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
      $u = [string]$c.service.baseUrl
      if ([string]::IsNullOrWhiteSpace($u)) { Bad "$($t.Name)：baseUrl 为空" } else { Ok "$($t.Name)：baseUrl=$u"; $toolBaseUrls[$t.Name] = $u }
      if ($c.statusMap.done -ne 'succeeded') { Warn "$($t.Name)：statusMap.done=$($c.statusMap.done)" }
    } catch { Bad "$($t.Name)：config.json 解析失败" }
  }
}

Write-Host "`n=== 3. patch 一致性（id/serverName/args/env） ===" -ForegroundColor Cyan
if (-not (Test-Path $patch)) {
  Bad "patch 不存在：$patch"
} else {
  $lines = Get-Content $patch -Encoding UTF8
  $ids = @(); $servers = @(); $current = $null; $entries = @{}
  foreach ($ln in $lines) {
    if ($ln -match '^\s*-\s*id:\s*(\S+)') { $current = $Matches[1]; $ids += $current; $entries[$current] = @{ args = $null; env = $null; server = $null } }
    if ($current) {
      if ($ln -match '^\s*serverName:\s*(\S+)') { $entries[$current].server = $Matches[1]; $servers += $Matches[1] }
      if ($ln -match 'args:\s*\["(.+?)"\]') { $entries[$current].args = $Matches[1] }
      if ($ln -match 'MCP_SERVICE_BASE_URL:\s*"(.+?)"') { $entries[$current].env = $Matches[1] }
    }
  }
  $dupIds = $ids | Group-Object | Where-Object Count -gt 1
  if ($dupIds) { Bad "patch id 重复：$($dupIds.Name -join ',')" } else { Ok "id 唯一（$($ids.Count) 条）" }
  $dupSrv = $servers | Group-Object | Where-Object Count -gt 1
  if ($dupSrv) { Bad "serverName 重复：$($dupSrv.Name -join ',')" } else { Ok "serverName 唯一（$($servers.Count) 个）" }

  foreach ($k in ($entries.Keys | Where-Object { $_ -like 'mcp-*' })) {
    $e = $entries[$k]
    if ($e.args) {
      if (-not (Test-Path $e.args)) { Bad "$k：args 指向不存在的文件 $($e.args)" }
      else {
        $dir = Split-Path $e.args -Parent
        $cfgPath = Join-Path $dir 'config.json'
        if (Test-Path $cfgPath) {
          $cfgUrl = [string]((Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json).service.baseUrl)
          if ($cfgUrl -ne $e.env) { Bad "$k：patch.env=$($e.env) 与 config.baseUrl=$cfgUrl 不一致" } else { Ok "$k：env 与 config 一致（$($e.env)）" }
        }
      }
    } else { Warn "$k：未解析到 args（检查格式）" }
  }
}

Write-Host "`n=== 3.5 registry 校验（taskType 唯一 / 报告存在） ===" -ForegroundColor Cyan
$regPath = Join-Path $repo 'registry.md'
if (-not (Test-Path $regPath)) {
  Warn "registry.md 不存在：$regPath"
} else {
  $taskList = @()
  $regRows = Get-Content $regPath -Encoding UTF8 | Where-Object { $_ -match '^\|' -and $_ -notmatch '^\|\s*[-:]' }
  foreach ($r in $regRows) {
    $c = @(($r.Trim().Trim('|')).Split('|') | ForEach-Object { $_.Trim() })
    if ($c.Count -lt 9) { continue }
    if ($c[0] -match '^\d+$' -or $c[0] -eq '业务标识' -or $c[0] -eq '端口') { continue }
    $id = $c[0]; $taskType = $c[6]; $svcDir = $c[8]
    if ($taskType) { $taskList += $taskType }
    if ($svcDir) {
      $parent = Split-Path $svcDir -Parent
      $report = Join-Path $parent ("report\" + $id + "-report.html")
      if (Test-Path $report) { Ok "$id：报告存在" } else { Warn "$id：未找到报告 $report（未跑或命名不符）" }
    }
  }
  $dupTask = $taskList | Group-Object | Where-Object { $_.Count -gt 1 }
  if ($dupTask) { Bad "taskType 重复：$($dupTask.Name -join ',')" } else { Ok "taskType 唯一（$($taskList.Count) 个）" }
}

Write-Host "`n=== 4. 端口与健康 ===" -ForegroundColor Cyan
$urls = $toolBaseUrls.Values | Sort-Object -Unique
$portMap = @{}
foreach ($u in $urls) {
  $port = ([uri]$u).Port
  if ($portMap.ContainsKey($port)) { Bad "端口 $port 被多个 MCP 使用：$($portMap[$port]) / $u" } else { $portMap[$port] = $u }
  if ($SkipHealth) { continue }
  try {
    $h = Invoke-RestMethod "$($u.TrimEnd('/'))/health" -TimeoutSec 4
    if ($h.ok) { Ok "服务健康：$u" } else { Bad "健康检查异常：$u" }
  } catch { Warn "服务未启动或不可达：$u（$($_.Exception.Message)）" }
}

Write-Host "`n=== 结果 ===" -ForegroundColor Cyan
if ($fail -eq 0) { Write-Host "全部通过 ✅" -ForegroundColor Green; exit 0 }
Write-Host "发现 $fail 个问题 ❌" -ForegroundColor Red; exit 1
