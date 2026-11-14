# Floating quick-chat window for the chill plugin.
#
# A frameless WinForms window hosting a WebView2 control. It is a plain desktop window:
# it does NOT launch or attach to the user's Edge/Chrome, keeps its own WebView2
# user-data folder, and behaves like any other window (no forced always-on-top).
#
# Chrome: rounded corners (DWM preference on Windows 11 plus a window region so the
# WebView2 child is clipped too), a 34px flat title strip with minimize / close,
# and the same palette as tools/quick.html (#202124 / #2a2b2f / #ff6060).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File quickfloat.ps1 `
#     -Url http://127.0.0.1:10722/chill/quick -UserDataDir <data dir>\quickfloat

param(
  [string]$Url = 'http://127.0.0.1:10722/chill/quick',
  [int]$Width = 430,
  [int]$Height = 187,   # one third of the old 560: a slim strip, log + composer only
  [int]$PosX = -1,
  [int]$PosY = -1,
  [int]$Radius = 16,
  [string]$UserDataDir = '',
  [string]$SdkDir = '',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Write-Note([string]$text) {
  if (-not $Quiet) { Write-Output $text }
}

# ---- DPI -------------------------------------------------------------------
# Without this the process is DPI-virtualized: Windows renders a 430x560 window and then
# stretches the bitmap to 645x840 on a 150% display, so every glyph is soft. Declaring
# awareness keeps the size we ask for and lets WebView2 render at the real pixel density.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class QuickFloatDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Enable() {
    try { SetProcessDPIAware(); } catch { }
  }
}
"@
[QuickFloatDpi]::Enable()


# ---- single instance ------------------------------------------------------
# A named mutex is global to the session: a second click must not stack a second widget.
$created = $false
try {
  $mutex = [System.Threading.Mutex]::new($true, 'Local\ChillQuickFloat', [ref]$created)
} catch {
  $created = $true
}
if (-not $created) {
  # Second click: bring the existing widget to the front instead of stacking a copy.
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class QuickFloatFocus {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  public static IntPtr Find(string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      var sb = new StringBuilder(512); GetWindowTextW(h, sb, 512);
      if (sb.ToString().Contains(needle)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
  $existing = [QuickFloatFocus]::Find('Chill Quick')
  if ($existing -ne [IntPtr]::Zero) {
    [void][QuickFloatFocus]::ShowWindow($existing, 9)
    [void][QuickFloatFocus]::ShowWindow($existing, 1)
    [void][QuickFloatFocus]::SetForegroundWindow($existing)
    Write-Note 'focused the existing widget'
  } else {
    Write-Note 'already running'
  }
  exit 0
}

# ---- WebView2 assemblies --------------------------------------------------
$candidates = @()
if ($SdkDir) { $candidates += $SdkDir }
if ($env:DSHL_WEBVIEW2_DIR) { $candidates += $env:DSHL_WEBVIEW2_DIR }
$candidates += @(
  'D:\dshl',
  (Join-Path $env:LOCALAPPDATA 'DSHL'),
  (Join-Path $env:ProgramFiles 'DSHL'),
  (Join-Path $env:USERPROFILE '.nuget\packages\microsoft.web.webview2')
)
$resolved = ''
foreach ($dir in $candidates) {
  if (-not $dir) { continue }
  if (-not (Test-Path $dir)) { continue }
  $core = Get-ChildItem $dir -Recurse -Filter 'Microsoft.Web.WebView2.Core.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
  $wf = Get-ChildItem $dir -Recurse -Filter 'Microsoft.Web.WebView2.WinForms.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($core -and $wf) { $resolved = $core.DirectoryName; break }
}
if (-not $resolved) {
  Write-Output 'WebView2 .NET assemblies not found; pass -SdkDir'
  exit 2
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $resolved 'Microsoft.Web.WebView2.Core.dll')
Add-Type -Path (Join-Path $resolved 'Microsoft.Web.WebView2.WinForms.dll')

# ---- rounded corners + flat chrome helpers ---------------------------------
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class QuickFloatChrome {
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);
  [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hwnd, IntPtr rgn, bool redraw);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);

  // node spawns us with windowsHide:true (STARTUPINFO SW_HIDE), and the very first
  // ShowWindow the form performs inherits that flag, so the widget can come up
  // minimized. Restore it explicitly once the handle exists.
  public static void Reveal(IntPtr hwnd) {
    ShowWindow(hwnd, 9); // SW_RESTORE
    ShowWindow(hwnd, 5); // SW_SHOW
  }

  // Windows 11: let DWM round the frame (also gives the proper shadow/edges).
  public static bool PreferRounded(IntPtr hwnd) {
    try {
      int preference = 2; // DWMWCP_ROUND
      int hr = DwmSetWindowAttribute(hwnd, 33, ref preference, 4);
      return hr == 0;
    } catch { return false; }
  }

  // Every Windows: clip the window, so the WebView2 child is rounded as well.
  public static void ClipRounded(IntPtr hwnd, int width, int height, int radius) {
    if (width <= 0 || height <= 0) return;
    IntPtr rgn = CreateRoundRectRgn(0, 0, width + 1, height + 1, radius * 2, radius * 2);
    SetWindowRgn(hwnd, rgn, true); // ownership passes to the window
  }
}
"@

# ---- state -----------------------------------------------------------------
$stateDir = if ($UserDataDir) { $UserDataDir } else { Join-Path $env:LOCALAPPDATA 'ChillQuickFloat' }
$profileDir = Join-Path $stateDir 'WebView2'
if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir -Force | Out-Null }
$posFile = Join-Path $stateDir 'pos.json'

# ---- pixel sizes -----------------------------------------------------------
# Width / Height / Radius are logical units. The process is DPI aware, so multiply them
# by the monitor scale: same on-screen size as before, but WebView2 renders at the real
# pixel density instead of being stretched by the compositor.
$dpiGraphics = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
$scale = $dpiGraphics.DpiX / 96.0
$dpiGraphics.Dispose()
if ($scale -le 0) { $scale = 1.0 }
$pxW = [int][Math]::Round($Width * $scale)
$pxH = [int][Math]::Round($Height * $scale)
$pxRadius = [int][Math]::Round($Radius * $scale)
$barH = [int][Math]::Round(34 * $scale)
$btnW = [int][Math]::Round(38 * $scale)

if ($PosX -lt 0 -or $PosY -lt 0) {
  if (Test-Path $posFile) {
    try {
      $saved = Get-Content $posFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($null -ne $saved.x) { $PosX = [int]$saved.x }
      if ($null -ne $saved.y) { $PosY = [int]$saved.y }
    } catch { }
  }
}
if ($PosX -lt 0 -or $PosY -lt 0) {
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  if ($PosX -lt 0) { $PosX = [Math]::Max($wa.Left, $wa.Right - $pxW - [int](40 * $scale)) }
  if ($PosY -lt 0) { $PosY = [Math]::Max($wa.Top, $wa.Bottom - $pxH - [int](60 * $scale)) }
}

# palette shared with tools/quick.html
$cBg = [System.Drawing.Color]::FromArgb(32, 33, 36)      # --bg
$cBar = [System.Drawing.Color]::FromArgb(42, 43, 47)     # --bar
$cText = [System.Drawing.Color]::FromArgb(236, 236, 238) # --text
$cDim = [System.Drawing.Color]::FromArgb(140, 140, 146)  # --faint
$cAccent = [System.Drawing.Color]::FromArgb(255, 96, 96) # --accent
$cHover = [System.Drawing.Color]::FromArgb(52, 53, 58)   # --line

# ---- window ----------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Chill Quick'
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = New-Object System.Drawing.Point($PosX, $PosY)
$form.ClientSize = New-Object System.Drawing.Size($pxW, $pxH)
$form.MinimumSize = New-Object System.Drawing.Size([int](280 * $scale), [int](140 * $scale))
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.ShowInTaskbar = $true
$form.BackColor = $cBg
$form.Padding = New-Object System.Windows.Forms.Padding(0)

# title strip
$header = New-Object System.Windows.Forms.Panel
$header.Height = $barH
$header.Dock = [System.Windows.Forms.DockStyle]::Top
$header.BackColor = $cBar
$header.Margin = New-Object System.Windows.Forms.Padding(0)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Chill Quick'
$title.ForeColor = $cDim
$title.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
$title.AutoSize = $false
$title.Dock = [System.Windows.Forms.DockStyle]::Fill
$title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$title.Padding = New-Object System.Windows.Forms.Padding(12, 0, 0, 0)

function New-StripButton([string]$glyph, [int]$width, [System.Drawing.Color]$color) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $glyph
  $b.Width = $width
  $b.Dock = [System.Windows.Forms.DockStyle]::Right
  $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $b.FlatAppearance.BorderSize = 0
  $b.FlatAppearance.MouseOverBackColor = $cHover
  $b.FlatAppearance.MouseDownBackColor = $cBg
  $b.ForeColor = $color
  $b.BackColor = $cBar
  $b.Font = New-Object System.Drawing.Font('Segoe UI', 9)
  $b.TabStop = $false
  $b.Cursor = [System.Windows.Forms.Cursors]::Hand
  return $b
}

$btnClose = New-StripButton ([string][char]0x2715) $btnW $cDim
$btnMin = New-StripButton ([string][char]0x2212) $btnW $cDim

$header.Controls.Add($title)
# Docking lays right-docked controls out from the last added to the first, so add
# minimize first to keep close at the far right -- the usual Windows order.
$header.Controls.Add($btnMin)
$header.Controls.Add($btnClose)

# content
$wv = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$wv.Dock = [System.Windows.Forms.DockStyle]::Fill
$cp = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
$cp.UserDataFolder = $profileDir
$wv.CreationProperties = $cp

# a 1px hairline between strip and content, same trick the page uses for --line
$line = New-Object System.Windows.Forms.Panel
$line.Height = 1
$line.Dock = [System.Windows.Forms.DockStyle]::Top
$line.BackColor = $cHover

$form.Controls.Add($wv)
$form.Controls.Add($line)
$form.Controls.Add($header)

# ---- behaviour -------------------------------------------------------------
$script:dragging = $false
$script:dragStart = New-Object System.Drawing.Point(0, 0)

$onDown = {
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $script:dragging = $true
    $script:dragStart = $e.Location
  }
}
$onMove = {
  param($sender, $e)
  if ($script:dragging) {
    $screen = [System.Windows.Forms.Cursor]::Position
    $form.Location = New-Object System.Drawing.Point(($screen.X - $script:dragStart.X), ($screen.Y - $script:dragStart.Y))
  }
}
$onUp = {
  param($sender, $e)
  $script:dragging = $false
}
$onHoverIn = {
  param($sender, $e)
  if ($sender -ne $title) { $sender.BackColor = $cHover }
}
$onHoverOut = {
  param($sender, $e)
  $sender.BackColor = $cBar
}

foreach ($c in @($header, $title)) {
  $c.Add_MouseDown($onDown)
  $c.Add_MouseMove($onMove)
  $c.Add_MouseUp($onUp)
}
foreach ($b in @($btnMin, $btnClose)) {
  $b.Add_MouseEnter($onHoverIn)
  $b.Add_MouseLeave($onHoverOut)
}

$btnMin.Add_Click({ $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized })
$btnClose.Add_Click({ $form.Close() })

$applyChrome = {
  if ($form.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) { return }
  $h = $form.Handle
  [void][QuickFloatChrome]::PreferRounded($h)
  [QuickFloatChrome]::ClipRounded($h, $form.Width, $form.Height, $pxRadius)
}

$form.Add_Resize({ & $applyChrome })
$form.Add_Shown({
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
  [QuickFloatChrome]::Reveal($form.Handle)
  & $applyChrome
  try {
    $wv.Source = [Uri]$Url
  } catch {
    Write-Note ('navigation failed: ' + $_.Exception.Message)
  }
})

$form.Add_FormClosing({
  try {
    $state = @{ x = $form.Location.X; y = $form.Location.Y; w = $form.Width; h = $form.Height } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($posFile, $state, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
})

if (-not $Quiet) {
  Write-Output ('widget opened: ' + $pxW + 'x' + $pxH + ' (scale ' + $scale + ') at ' + $PosX + ',' + $PosY + ' radius=' + $pxRadius)
}

[void][System.Windows.Forms.Application]::Run($form)
