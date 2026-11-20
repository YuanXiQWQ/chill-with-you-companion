# 专注模式下的表演：只该动头颈，身体类一律不做。
# 会临时把 phase 设成 focus，跑完恢复成进入前的状态。
$ErrorActionPreference = 'Stop'
$ROOT = if ($env:CHILL_REPO) { $env:CHILL_REPO } else { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }

$base = 'http://127.0.0.1:10722/chill/v1'
$game = 'E:\SteamLibrary\steamapps\common\Chill with You Lo-Fi Story\BepInEx\LogOutput.log'

function Post($path, $obj) {
  $json = $obj | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "$base$path" -Method POST -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 90
}

$orig = (Get-Content (Join-Path $ROOT 'data\state.json') -Raw -Encoding utf8 | ConvertFrom-Json).phase
Write-Host ("  进入前 phase = " + $orig)

try {
  $null = Post '/event' @{ type = 'focus_start' }
  $now = (Get-Content (Join-Path $ROOT 'data\state.json') -Raw -Encoding utf8 | ConvertFrom-Json).phase
  Write-Host ("  现在   phase = " + $now)
  if ($now -ne 'focus') { throw '没进入专注态，后面的测试没有意义' }
  Write-Host ''

  # 每条都带"正常态下会做身体动作"的意图，看专注态是否把它们降级成头部动作
  $cases = @(
    @('我写会儿代码', '持续状态：正常态切 WorkPC'),
    @('伸个懒腰吧', '身体：正常态整段伸懒腰'),
    @('喝口水', '身体：正常态抬手喝水'),
    @('我想看会儿书', '持续状态：正常态切 WorkBook'),
    @('别夸我了，我脸红了', '手势：本来就只动头'),
    @('好耶，修好了', '手势：点头'),
    @('让我想想', '手势：想一想'),
    @('我累了', '他的身体：本来就不该演')
  )

  $before = (Get-Content $game -Encoding UTF8).Count
  foreach ($c in $cases) {
    $r = Post '/act' @{ text = $c[0]; remember = $false; sandbox = $true }
    $cues = @($r.performance)
    $desc = ($cues | ForEach-Object {
      $s = [string]$_.slot + ':' + [string]$_.id
      if ($_.stateName) { $s += ' state=' + $_.stateName }
      $s
    }) -join ' | '
    if (-not $desc) { $desc = '(无动作)' }
    Write-Host ("  " + $c[0].PadRight(12) + " -> " + $desc)
    Write-Host ("      期望: " + $c[1])
    Start-Sleep -Seconds 3
  }

  Write-Host ''
  Write-Host '  === 游戏端 motion scope ==='
  $new = Get-Content $game -Encoding UTF8 | Select-Object -Skip $before
  ($new | Select-String -Pattern 'motion scope' | Select-Object -First 8) | ForEach-Object { "    " + $_.Line.Trim() }
  $st = $new | Select-String -Pattern 'state: '
  if ($st) { $st | ForEach-Object { "    切状态: " + $_.Line.Trim() } } else { "    没有切过状态 ✓" }
}
finally {
  $null = Post '/event' @{ type = 'idle' }
  Write-Host ''
  Write-Host ("  已恢复 phase = " + (Get-Content (Join-Path $ROOT 'data\state.json') -Raw -Encoding utf8 | ConvertFrom-Json).phase)
}



