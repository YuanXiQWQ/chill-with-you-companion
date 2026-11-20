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

// 字段：放在 performing 旁边（PerformerUI 内）
sub('挂起字段',
  /([ \t]*)private bool performing;(\r?\n)/,
  '$1private bool performing;$2$1private static string pendingPlan;$2$1private static int pendingHoldMs;$2$1private static float pendingUntil;$2')

// 每帧试一次
sub('Update 挂钩',
  /([ \t]*)GameVoiceGate\.Tick\(\);(\r?\n)/,
  '$1GameVoiceGate.Tick();$2$1TryFlushTrip();$2')

writeFileSync(P, src, 'utf8')
console.log(hits.join('\n'))
console.log('残留: pendingPlan=' + (src.split('pendingPlan').length - 1) + ' TryFlushTrip=' + (src.split('TryFlushTrip').length - 1))
