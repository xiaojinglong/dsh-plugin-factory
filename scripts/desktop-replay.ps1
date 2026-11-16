param(
  [string]$In = "",
  [double]$Speed = 1.0
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class PlayWin {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint flags, UIntPtr extra);
}
'@
if (-not $In) { throw "In is required" }
$rec = Get-Content -Raw -Encoding UTF8 -Path $In | ConvertFrom-Json
$last = 0
foreach ($e in $rec.events) {
  $delay = [int](($e.t - $last) / [Math]::Max(0.1, $Speed))
  if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
  $last = $e.t
  switch ($e.type) {
    "mouse_move" { [PlayWin]::SetCursorPos([int]$e.x, [int]$e.y) | Out-Null }
    "mouse_down" {
      [PlayWin]::SetCursorPos([int]$e.x, [int]$e.y) | Out-Null
      $flag = if ($e.button -eq "right") { 0x0008 } elseif ($e.button -eq "middle") { 0x0020 } else { 0x0002 }
      [PlayWin]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero)
    }
    "mouse_up" {
      $flag = if ($e.button -eq "right") { 0x0010 } elseif ($e.button -eq "middle") { 0x0040 } else { 0x0004 }
      [PlayWin]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero)
    }
    "wheel" { [PlayWin]::mouse_event(0x0800, 0, 0, [int]$e.data, [UIntPtr]::Zero) }
    "key_down" { [PlayWin]::keybd_event([byte]$e.key, 0, 0, [UIntPtr]::Zero) }
    "key_up" { [PlayWin]::keybd_event([byte]$e.key, 0, 2, [UIntPtr]::Zero) }
  }
}
Write-Output "replayed $($rec.events.Count) events"
