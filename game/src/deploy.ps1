# Deploy a built ChillPerformer.dll into the game, refusing while it is running.
# Game dir: -GameDir > $env:CHILL_GAME_DIR > default Steam location.
param([string]$GameDir = '')

$ErrorActionPreference = 'Stop'
if (-not $GameDir) { $GameDir = $env:CHILL_GAME_DIR }
if (-not $GameDir) { $GameDir = 'C:\Program Files (x86)\Steam\steamapps\common\Chill With You Lo-Fi Story' }
if (-not (Test-Path $GameDir)) { throw "game dir not found: $GameDir (pass -GameDir or set CHILL_GAME_DIR)" }

$src = Join-Path $PSScriptRoot 'bin\ChillPerformer.dll'
$dst = Join-Path $GameDir 'BepInEx\plugins\ChillPerformer.dll'

if (-not (Test-Path $src)) { throw "build first: $src missing" }
$proc = Get-Process -Name 'Chill With You' -ErrorAction SilentlyContinue
if ($proc) { throw ("game is running (pid " + ($proc.Id -join ',') + "); close it first") }
if (Test-Path $dst) {
  $bak = $dst + '.bak-' + (Get-Date -Format 'yyyyMMddHHmmss')
  Copy-Item $dst $bak -Force
  'backup: ' + (Split-Path $bak -Leaf)
}
Copy-Item $src $dst -Force
'deployed: ' + (Get-Item $dst).Length + ' bytes'
''
'next: start the game, wait about 20s, then read BepInEx\chill-timeofday.txt'