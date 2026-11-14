# Restore and place the quick-box browser window at a fixed geometry.
#
# Why this exists: Chromium can create the app window hidden, minimized, or at a stale
# rect, and --window-size alone does not correct it. This script finds the window by the
# browser process' command line (the profile path, so no non-ASCII title is needed),
# restores it, shows it, and moves it to the requested geometry.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File place-window.ps1 `
#          -CommandLineMatch quickbox-profile -Width 430 -Height 560

param(
  [string]$CommandLineMatch = 'quickbox-profile',
  [string]$Title = '',
  [int]$Width = 430,
  [int]$Height = 560,
  [int]$PosX = -1,
  [int]$PosY = -1,
  [int]$DelayMs = 800,
  [int]$TimeoutMs = 15000,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }

$cs = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class QuickBoxWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int procId);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(int action, int param, out RECT rect, int winIni);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  public struct RECT { public int Left, Top, Right, Bottom; }

  // Largest first: the app window dwarfs the IME / hint / crashpad helpers that belong
  // to the same browser process, and a small helper must never be the one we move.
  public static List<IntPtr> WindowsOf(List<int> pids) {
    var found = new List<KeyValuePair<long, IntPtr>>();
    EnumWindows((h, p) => {
      int procId; GetWindowThreadProcessId(h, out procId);
      if (!pids.Contains(procId)) return true;
      var sb = new StringBuilder(512); GetWindowTextW(h, sb, 512);
      if (sb.Length == 0) return true;
      RECT r; GetWindowRect(h, out r);
      long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
      if (area < 10000) return true;
      found.Add(new KeyValuePair<long, IntPtr>(area, h));
      return true;
    }, IntPtr.Zero);
    found.Sort((a, b) => b.Key.CompareTo(a.Key));
    var result = new List<IntPtr>();
    foreach (var kv in found) result.Add(kv.Value);
    return result;
  }

  public static List<IntPtr> ByTitle(string mustContain) {
    var found = new List<IntPtr>();
    EnumWindows((h, p) => {
      var sb = new StringBuilder(512); GetWindowTextW(h, sb, 512);
      if (sb.Length > 0 && sb.ToString().Contains(mustContain)) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static bool WorkArea(out RECT r) { return SystemParametersInfo(0x0030, 0, out r, 0); }
}
'@
if (-not ('QuickBoxWin' -as [type])) { Add-Type -TypeDefinition $cs }

# PosX/PosY < 0 means auto: bottom-right corner of the work area
if ($PosX -lt 0 -or $PosY -lt 0) {
  $wa = New-Object QuickBoxWin+RECT
  if ([QuickBoxWin]::WorkArea([ref]$wa)) {
    if ($PosX -lt 0) { $PosX = [Math]::Max($wa.Left, $wa.Right - $Width - 32) }
    if ($PosY -lt 0) { $PosY = [Math]::Max($wa.Top, $wa.Bottom - $Height - 48) }
  } else {
    if ($PosX -lt 0) { $PosX = 100 }
    if ($PosY -lt 0) { $PosY = 100 }
  }
}

function Find-Targets {
  $handles = New-Object 'System.Collections.Generic.List[IntPtr]'
  if ($CommandLineMatch) {
    $pids = New-Object 'System.Collections.Generic.List[int]'
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($CommandLineMatch) } |
      ForEach-Object { $pids.Add([int]$_.ProcessId) }
    if ($pids.Count -gt 0) {
      foreach ($h in [QuickBoxWin]::WindowsOf($pids)) { $handles.Add($h) }
    }
  }
  if ($handles.Count -eq 0 -and $Title) {
    foreach ($h in [QuickBoxWin]::ByTitle($Title)) { $handles.Add($h) }
  }
  return ,$handles
}

$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
$done = $false
while ((Get-Date) -lt $deadline -and -not $done) {
  foreach ($h in (Find-Targets)) {
    if ([QuickBoxWin]::IsIconic($h)) { [void][QuickBoxWin]::ShowWindow($h, 9) }
    [void][QuickBoxWin]::MoveWindow($h, $PosX, $PosY, $Width, $Height, $true)
    # SW_SHOWNORMAL, not SW_SHOW: a Chromium app window created hidden stays hidden
    # after SW_SHOW on some restore paths.
    [void][QuickBoxWin]::ShowWindow($h, 1)
    if ([QuickBoxWin]::IsWindowVisible($h)) { $done = $true; break }
  }
  if (-not $done) { Start-Sleep -Milliseconds 400 }
}

if (-not $Quiet) {
  if ($done) { Write-Output ('placed window at ' + $PosX + ',' + $PosY + ' ' + $Width + 'x' + $Height) }
  else { Write-Output ('window not found or still hidden within ' + $TimeoutMs + 'ms') }
}
