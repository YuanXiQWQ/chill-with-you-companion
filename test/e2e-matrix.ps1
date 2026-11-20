# 端到端用例矩阵：逐条打 /act，核对返回的 cue 是否带上了该带的东西。
# 只读 + sandbox，不写记忆、不动真实状态。
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:10722/chill/v1'

function Ask([string]$text, [int]$settle = 0) {
  $json = @{ text = $text; remember = $false; sandbox = $true } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Uri "$base/act" -Method POST -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 90
  if ($settle -gt 0) { Start-Sleep -Seconds $settle }
  return $r
}

function Show([string]$label, $r, [string]$wantField, [string]$wantValue) {
  $c = @($r.performance)[0]
  if (-not $c) { "  ✗ {0,-14} 没有 performance" -f $label; return }
  $got = switch ($wantField) {
    'facial'    { [string]$c.facial }
    'stateName' { [string]$c.stateName }
    'nativeSub' { [string]$c.nativeSub }
    'id'        { [string]$c.id }
    default     { '' }
  }
  $mark = if ($got -eq $wantValue) { '✓' } else { '✗' }
  "  {0} {1,-14} {2,-11} 期望={3,-22} 实际={4}" -f $mark, $label, $wantField, $wantValue, ($(if ($got) { $got } else { '(空)' }))
}

Write-Host '=== 表情通道 ==='
foreach ($case in @(
  @('别夸我了，我脸红了', 'Shy_Fun'),
  @('哈哈哈太好笑了', 'Shy_Joy'),
  # 他说累不传染 → tired 会被主动丢弃；换成主语是她的说法才走得到表情
  @('困死了，打个哈欠', 'Shy_Sad'),
  @('伸个懒腰', 'Shy_Joy'),
  @('深呼吸一下', 'Shy_Rest'),
  @('你看起来很累', 'Shy_Sad')
)) { Show $case[0] (Ask $case[0]) 'facial' $case[1] }

Write-Host ''
Write-Host '=== 持续状态 ==='
foreach ($case in @(
  @('我写会儿代码', 'WorkPC'),
  @('我想看会儿书', 'WorkBook'),
  @('我想看小说', 'BreakReadBook'),
  @('一起看电影吧', 'BreakMovie')
)) { Show $case[0] (Ask $case[0] 5) 'stateName' $case[1] }

Write-Host ''
Write-Host '=== 持续状态里的片段 ==='
# 先进入各自基底，再发片段需求；全名由 DLL 按当前基底拼，服务端只给后缀
$null = Ask '我写会儿代码' 5
Show '翻页(写字基底)' (Ask '翻一页吧' 4) 'nativeSub' 'PageFlip'
$null = Ask '我想看小说' 5
Show '翻页(小说基底)' (Ask '翻一页吧' 4) 'nativeSub' 'PageFlip'
$null = Ask '一起看电影吧' 5
Show '紧张(电影基底)' (Ask '好紧张啊' 4) 'nativeSub' 'Suspenseful'
