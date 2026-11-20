// 离座触发时那句语音是游戏自己的（PlayLeaveChairVoiceThenGo），我们的 gate 没掐到。
//
// 原因：Enter 写在 mi.Invoke 之后 —— 游戏是"先播语音再走"，等我们关的时候
// 它已经起播了；而 CancelVoice 只调一次，只打断那一刻正在响的。
//
// 改法：
//   1. Enter 提到 invoke 之前，先把闸门关上再让它动；
//   2. Tick 在压住期间周期性 CancelVoice —— 游戏可能在我们之后才起播。
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

// 1) 把"压住 gate"从 log 之后挪到 invoke 之前
sub('摘掉旧的 Enter',
  /[ \t]*\/\/ 离座那段的字幕和语音是我们的：把它们按接管窗口压住，到点由 Tick 自己恢复。\r?\n[ \t]*float holdSec = holdMs > 0 \? holdMs \/ 1000f : 300f;\r?\n[ \t]*GameVoiceGate\.Enter\("trip " \+ planName, holdSec\);\r?\n/,
  '')

sub('Enter 提到 invoke 之前',
  /([ \t]*)mi\.Invoke\(ai, new object\[\] \{ plan \}\);/,
  '$1// 先把闸门关上再让它动：游戏是"先播离座语音再走"，晚了就抢不过它。\n'
  + '$1float holdSec = holdMs > 0 ? holdMs / 1000f : 300f;\n'
  + '$1GameVoiceGate.Enter("trip " + planName, holdSec);\n'
  + '$1mi.Invoke(ai, new object[] { plan });')

// 2) Tick 里周期性 CancelVoice
sub('Tick 周期打断',
  /([ \t]*)if \(!active\) return;\r?\n([ \t]*)if \(Time\.unscaledTime < expireAt\) return;\r?\n([ \t]*)depth = 0;\r?\n([ \t]*)Restore\("到点恢复"\);/,
  '$1if (!active) return;\n'
  + '$1// 游戏可能在我们关闸之后才起播（离座语音就是这样），所以压住期间持续打断。\n'
  + '$1if (Time.unscaledTime >= nextCancelAt)\n'
  + '$1{\n'
  + '$1    nextCancelAt = Time.unscaledTime + 0.5f;\n'
  + '$1    try { Invoke0(voice, "CancelVoice", null); } catch { }\n'
  + '$1}\n'
  + '$1if (Time.unscaledTime < expireAt) return;\n'
  + '$2depth = 0;\n'
  + '$3Restore("到点恢复");')

// 3) 字段
sub('nextCancelAt 字段',
  /([ \t]*)private static float expireAt;\r?\n/,
  '$1private static float expireAt;\n$1private static float nextCancelAt;\n')

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
