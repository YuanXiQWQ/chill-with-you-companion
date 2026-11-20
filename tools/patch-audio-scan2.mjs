// 上一版扫描只覆盖了前 8 秒，而离座语音很可能是延迟起的（PlayLeaveChairVoiceThenGo 是
// <>c__DisplayClass18_0 里的 lambda，说明它挂在某个 delayed action 上）。
// 改成：闸门压住的整段时间里每 1 秒扫一次，不限次数，只记「有新源开始播」的时刻。
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'game/src/PerformerPlugin.cs'
let src = readFileSync(P, 'utf8')
const hits = []
function sub(name, re, rep) {
  const m = src.match(re)
  if (!m) { hits.push('skip ' + name); return }
  src = src.replace(re, rep)
  hits.push('ok   ' + name)
}

sub('扫描不限次数',
  /([ \t]*)if \(scanCount >= 16\) return;\r?\n([ \t]*)scanCount\+\+;/,
  '$1if (Time.unscaledTime < nextScanAt) return;\n$1nextScanAt = Time.unscaledTime + 1f;\n$2scanCount++;')

sub('只报变化',
  /([ \t]*)Plugin\.Log\.LogInfo\("audio scan #" \+ scanCount \+ " playing=" \+ n \+ " -> " \+ sb\.ToString\(\)\);/,
  `$1string line = sb.ToString();
$1if (line != lastAudioLine)
$1{
$1    lastAudioLine = line;
$1    Plugin.Log.LogInfo("audio scan #" + scanCount + " playing=" + n + " -> " + line);
$1}`)

sub('新增字段',
  /([ \t]*)private static int scanCount;\r?\n/,
  '$1private static int scanCount;\n$1private static float nextScanAt;\n$1private static string lastAudioLine = "";\n')

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
