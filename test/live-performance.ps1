# 真实表演测试：逐条发、逐条看游戏端到底演了什么。
# 判据不是"接口返回 200"，而是 DLL 日志里出现了哪条动作、走的是原生还是采样、
# 采样段有没有触发限幅（clamp 不为 0 说明段边界有硬切）。
#
# 用 sandbox:true 只影响"写不写记忆"，不影响演出——游戏照演。
#
# 注意：本文件必须存成 UTF-8 **带 BOM**。PowerShell 5.1 在没有 BOM 时按 ANSI 读 .ps1，
# 中文全部乱码并导致解析失败。只有 JSON/YAML 不能带 BOM，脚本恰恰相反。

$ErrorActionPreference = 'Stop'
$ROOT = if ($env:CHILL_REPO) { $env:CHILL_REPO } else { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }

$log = 'E:\SteamLibrary\steamapps\common\Chill with You Lo-Fi Story\BepInEx\LogOutput.log'
$base = 'http://127.0.0.1:10722/chill/v1'
$stateFile = (Join-Path $ROOT 'data\state.json')

# 回归要在「正常态」下跑。专注态是另一套判据（只动头颈、不切状态），
# 身体类用例在那儿本来就该没有动作——混在一起跑会得到 nothing N 的假故障。
# 2026-11-19 就撞过一次：游戏内专注计时在走，phase 被游戏自己上报成 focus，
# 回归里前四条（哈欠 / 伸懒腰 / 喝水 / 写代码）全部空，看着像坏了。
function GetPhase {
  try { return (Get-Content $stateFile -Raw -Encoding utf8 | ConvertFrom-Json).phase } catch { return '?' }
}

# 每条都在验一条不同的判定分支
$cases = @(
  @{ t = '我困得不行了'; expect = '他说自己的身体 → 哈欠会传染 → 她跟着打' }
  @{ t = '伸个懒腰吧'; expect = '直接让她做 → 伸懒腰' }
  @{ t = '先喝口水，然后接着写代码'; expect = '两拍：喝水原生 → 写代码采样（混合路径）' }
  @{ t = '我写会儿代码'; expect = '他说他在做事 → 她陪着做自己那份' }
  @{ t = '好耶，这个 bug 终于修好了'; expect = '手势反应 → 点头' }
  @{ t = '我想看会儿书'; expect = '陪伴 → 看书（采样）' }
  @{ t = '我累了'; expect = '他说自己累 → 不传染 → 她不该瘫' }
  @{ t = '让我想想'; expect = '手势 → 想一想' }
  @{ t = '今天天气真好'; expect = '没判出主戏 → 用模型给的信息' }
  @{ t = '我有点不好意思'; expect = '手势 → 害羞' }
)

function Mark {
  @(Get-Content $log -Encoding UTF8 | Select-String -Pattern 'native play|native done|native fallback|play anim_|clip done|^state: ').Count
}

$report = @()
# 不强行改 phase：/act 会从游戏心跳（GameBusy.FocusMode）同步番茄钟状态，
# 游戏在专注时，每调一次 act 就把 phase 推回 focus，强行设 idle 是无效的。
# 正确做法是**记录**每条跑在什么 phase 下，专注态的空结果算"跳过"不算失败：
# 专注态的判据本来就不同（只动头颈、不切状态），身体类用例在那儿必然为空。
foreach ($c in $cases) {
  $before = Mark
  $body = @{ text = $c.t; sandbox = $true } | ConvertTo-Json -Compress
  $row = [ordered]@{ input = $c.t; expect = $c.expect; declared = ''; played = ''; clamp = ''; phase = '' }
  $failed = $false
  try {
    $r = Invoke-RestMethod -Uri "$base/act" -Method Post -ContentType 'application/json; charset=utf-8' `
      -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 120
  } catch {
    $failed = $true
    $row.declared = '接口失败'
    $row.played = $_.Exception.Message
  }

  if (-not $failed) {
    # /act 返回后 phase 才是这一条实际生效的那个（act 自己会从游戏心跳同步）
    $row.phase = GetPhase
    $perf = @()
    foreach ($p in @($r.performance)) {
      if ($p.stateName) { $perf += '状态:' + $p.stateName }
      elseif ($p.nativeName) { $perf += '原生:' + $p.nativeName }
      elseif ($p.id) { $perf += '采样:' + $p.id }
    }
    $row.declared = ($perf -join ' + ')

    Start-Sleep -Seconds 16
    $delta = Get-Content $log -Encoding UTF8 | Select-String -Pattern 'native play|native done|native fallback|play anim_|clip done|^state: ' | Select-Object -Skip $before
    $played = @()
    $clamp = ''
    foreach ($l in $delta) {
      $s = $l.Line -replace '^\[\w+\s*:ChillPerformer\]\s*', ''
      # "已经在 X" 也要算演了 —— 否则她在原地待着会被判成"什么都没做"
      if ($s -match '^state: 已经在 (.+)$') { $played += ('状态:' + $Matches[1]) }
      elseif ($s -match '^state: (.+) -> (.+)$') { $played += ('状态:' + $Matches[2]) }
      elseif ($s -match '^native done .* started=(True|False)') { $played += ($s -replace 'native done ', '原生完:') }
      elseif ($s -match '^native play (.+)') { $played += ('原生起:' + $Matches[1]) }
      elseif ($s -match '^native fallback') { $played += '回落采样' }
      elseif ($s -match '^play (anim_\S+)') { $played += ('采样起:' + $Matches[1]) }
      elseif ($s -match 'clip done: (\S+)') {
        $played += ('采样完:' + $Matches[1])
        if ($s -match 'clamp=(\d+(?:\.\d+)?)' ) { $clamp += $Matches[1] + ' ' }
      }
    }
    $row.played = ($played -join ' -> ')
    $row.clamp = $clamp.Trim()
  }
  # "played 空" 不等于 "什么都没做"：状态切换打的是 state: 行，delta 窗口有时切偏会漏采。
  # 以接口实际下发为准 —— declared 空才是真的没演。
  if (-not $row.played -and $row.declared) { $row.played = '(已下发，未采到日志)' }
  $report += [pscustomobject]$row
}

$nativeCnt = @($report | Where-Object { $_.played -match '原生起|状态:' }).Count
$sampleCnt = @($report | Where-Object { $_.played -match 'anim_' }).Count
$fallbackCnt = @($report | Where-Object { $_.played -match '回落' }).Count
$emptyCnt = @($report | Where-Object { -not $_.played -and $_.phase -ne 'focus' }).Count
# 专注态下身体类用例本来就该没有动作，那不是失败，是另一套判据。单独计数。
$skipCnt = @($report | Where-Object { -not $_.played -and $_.phase -eq 'focus' }).Count

$out = @("live performance test  $(Get-Date -Format 'yyyy-MM-dd HH:mm')", '')
if ($skipCnt -gt 0) {
  $out += "!! 本次有 $skipCnt 条跑在专注态（游戏 FocusMode=true）：身体类用例在那儿必然为空，"
  $out += "!! 这几条计入 skip 不计入 nothing。要跑正常态，先在面板上结束专注/等它结束。"
  $out += ''
}
$k = 0
foreach ($row in $report) {
  $k += 1
  Write-Host "[$k] $($row.input)"
  Write-Host "    expect  : $($row.expect)"
  Write-Host "    declared: $($row.declared)"
  Write-Host "    played  : $($row.played)"
  if ($row.phase) { Write-Host "    phase   : $($row.phase)" }
  if ($row.clamp) { Write-Host "    clamp   : $($row.clamp)  (non-zero = hard cut at segment edge)" }
  Write-Host ''
  $out += "[$k] $($row.input)"
  $out += "    expect  : $($row.expect)"
  $out += "    declared: $($row.declared)"
  $out += "    played  : $($row.played)"
  if ($row.phase) { $out += "    phase   : $($row.phase)" }
  if ($row.clamp) { $out += "    clamp   : $($row.clamp)" }
  $out += ''
}
$summary = "summary: native $nativeCnt / sample $sampleCnt / fallback $fallbackCnt / nothing $emptyCnt / skip $skipCnt"
Write-Host $summary
$out += $summary

$file = (Join-Path $ROOT 'data\live-performance.txt')
[IO.File]::WriteAllLines($file, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "report -> $file"



