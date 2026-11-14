# Build ChillPerformer.dll and deploy to BepInEx\plugins
# No .NET SDK needed: uses Windows' own .NET Framework csc, referencing the
# game's Managed assemblies and BepInEx core (standard way to build Unity plugins).
# NOTE: keep this file ASCII-only; PS 5.1 reads non-BOM scripts as ANSI.

# Game dir: -GameDir > $env:CHILL_GAME_DIR > default Steam location.
# Never hardcode a local path here; this file ships with the plugin.
param([string]$GameDir = '')

$ErrorActionPreference = 'Stop'

if (-not $GameDir) { $GameDir = $env:CHILL_GAME_DIR }
if (-not $GameDir) { $GameDir = 'C:\Program Files (x86)\Steam\steamapps\common\Chill With You Lo-Fi Story' }
if (-not (Test-Path $GameDir)) { throw "game dir not found: $GameDir (pass -GameDir or set CHILL_GAME_DIR)" }
$Managed = Join-Path $GameDir 'Chill With You_Data\Managed'
$Core = Join-Path $GameDir 'BepInEx\core'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out = Join-Path $Here 'bin\ChillPerformer.dll'

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }
if (-not (Test-Path $Core)) { throw "BepInEx not installed: $Core" }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null

$refs = @(
  (Join-Path $Core 'BepInEx.dll'),
  (Join-Path $Managed 'mscorlib.dll'),
  (Join-Path $Managed 'System.dll'),
  (Join-Path $Managed 'System.Core.dll'),
  (Join-Path $Managed 'netstandard.dll'),
  (Join-Path $Managed 'UnityEngine.dll'),
  (Join-Path $Managed 'UnityEngine.CoreModule.dll'),
  (Join-Path $Managed 'UnityEngine.AnimationModule.dll'),
  (Join-Path $Managed 'UnityEngine.AudioModule.dll'),
  (Join-Path $Managed 'UnityEngine.IMGUIModule.dll'),
  (Join-Path $Managed 'UnityEngine.TextRenderingModule.dll'),
  (Join-Path $Managed 'UnityEngine.UIModule.dll'),
  (Join-Path $Managed 'UnityEngine.UI.dll'),
  (Join-Path $Managed 'UnityEngine.InputLegacyModule.dll'),
  (Join-Path $Managed 'UnityEngine.JSONSerializeModule.dll'),
  (Join-Path $Managed 'UnityEngine.UnityWebRequestModule.dll'),
  (Join-Path $Managed 'UnityEngine.UnityWebRequestAudioModule.dll')
)
foreach ($r in $refs) { if (-not (Test-Path $r)) { throw "missing reference: $r" } }

# /noconfig skips csc.rsp; /nostdlib+ uses only the game's mscorlib (avoids duplicate System)
$a = @('/nologo', '/noconfig', '/nostdlib+', '/target:library', '/langversion:5', '/nowarn:0618', "/out:$Out")
foreach ($r in $refs) { $a += "/r:$r" }
$a += (Join-Path $Here 'SceneProbe.cs')
$a += (Join-Path $Here 'JsonLite.cs')
$a += (Join-Path $Here 'PerformerPlugin.cs')
$a += (Join-Path $Here 'AnimIdMap.cs')
$a += (Join-Path $Here 'NativeSubtitle.cs')
$a += (Join-Path $Here 'GameBusy.cs')

& $csc @a
if ($LASTEXITCODE -ne 0) { throw "build failed exit=$LASTEXITCODE" }

$Plugins = Join-Path $GameDir 'BepInEx\plugins'
New-Item -ItemType Directory -Force -Path $Plugins | Out-Null
Copy-Item $Out $Plugins -Force

'OK ' + (Get-Item $Out).Length + ' bytes -> ' + (Join-Path $Plugins 'ChillPerformer.dll')
