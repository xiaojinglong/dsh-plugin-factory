param(
  [int]$DurationSeconds = 20,
  [string]$Out = "",
  [string]$Name = "desktop-recording"
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RecWin {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
'@
if (-not $Out) { throw "Out is required" }
$events = New-Object System.Collections.ArrayList
$start = [DateTime]::UtcNow
function NowMs { return [int]([DateTime]::UtcNow - $start).TotalMilliseconds }
$lastPos = @{ x = -1; y = -1 }
$buttons = @{ 1 = $false; 2 = $false; 4 = $false }
$keys = @(8,9,13,16,17,18,27,32,33,34,37,38,39,40,46,65,67,86,88,90)
$keyState = @{}
foreach ($k in $keys) { $keyState[$k] = $false }

$hwnd = [RecWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[RecWin]::GetWindowText($hwnd, $sb, 256) | Out-Null
$windowTitle = $sb.ToString()

while ((NowMs) -lt ($DurationSeconds * 1000)) {
  $p = New-Object RecWin+POINT
  [RecWin]::GetCursorPos([ref]$p) | Out-Null
  if ($p.X -ne $lastPos.x -or $p.Y -ne $lastPos.y) {
    [void]$events.Add([ordered]@{ t = (NowMs); type = "mouse_move"; x = $p.X; y = $p.Y })
    $lastPos = @{ x = $p.X; y = $p.Y }
  }
  foreach ($vk in @(1,2,4)) {
    $down = ([RecWin]::GetAsyncKeyState($vk) -band 0x8000) -ne 0
    if ($down -ne $buttons[$vk]) {
      $btn = if ($vk -eq 1) { "left" } elseif ($vk -eq 2) { "right" } else { "middle" }
      [void]$events.Add([ordered]@{ t = (NowMs); type = $(if ($down) { "mouse_down" } else { "mouse_up" }); x = $p.X; y = $p.Y; button = $btn })
      $buttons[$vk] = $down
    }
  }
  foreach ($vk in $keys) {
    $down = ([RecWin]::GetAsyncKeyState($vk) -band 0x8000) -ne 0
    if ($down -ne $keyState[$vk]) {
      [void]$events.Add([ordered]@{ t = (NowMs); type = $(if ($down) { "key_down" } else { "key_up" }); key = $vk })
      $keyState[$vk] = $down
    }
  }
  Start-Sleep -Milliseconds 15
}

[ordered]@{
  name = $Name
  window = $windowTitle
  recordedAt = (Get-Date).ToString("o")
  durationMs = (NowMs)
  events = $events
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $Out
Write-Output $Out
