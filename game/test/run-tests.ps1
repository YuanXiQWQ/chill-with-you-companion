# 游戏端（C#）的独立测试。不需要 Unity、不需要 .NET SDK —— 用 Windows 自带的 csc.exe。
# 只测不依赖 UnityEngine 的部分：JsonLite（所有 cue 的入口）和 AnimIdMap（id -> clip 名）。
#
# 用法：powershell -ExecutionPolicy Bypass -File game/test/run-tests.ps1
# 退出码：0 = 全过，1 = 有失败
#
# NOTE: keep this file ASCII-only, or write it with a BOM -- PS 5.1 reads
# non-BOM scripts as ANSI and mangles any non-ASCII byte into a syntax error.

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src = Join-Path (Split-Path -Parent $Here) 'src'
$Out = Join-Path $Here 'bin\CueParsingTests.exe'

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }

# 只编译不依赖 Unity 的三个文件
$files = @(
  (Join-Path $Src 'JsonLite.cs'),
  (Join-Path $Src 'AnimIdMap.cs'),
  (Join-Path $Here 'CueParsingTests.cs')
)
foreach ($f in $files) { if (-not (Test-Path $f)) { throw "missing source: $f" } }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
if (Test-Path $Out) { Remove-Item $Out -Force }

& $csc /nologo /warn:4 /target:exe /out:$Out $files
if ($LASTEXITCODE -ne 0) { throw "csc failed with $LASTEXITCODE" }

& $Out
exit $LASTEXITCODE
