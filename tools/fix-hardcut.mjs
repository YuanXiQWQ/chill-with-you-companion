import { readFileSync, writeFileSync } from 'node:fs'

const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const log = []

// ── ① 进入过渡改成按距离算（固定 0.45s/0.12s 就是硬切的根因）──
const A = '            clipFadeIn = continueFamily ? 0.12f : 0.45f;'
if (!s.includes(A)) throw new Error('clipFadeIn 锚点失配')
s = s.replace(A, [
  '            // 进入过渡不能是固定值：她此刻在什么姿势、这条 clip 第一帧是什么姿势，',
  '            // 差多少度就得给多久。固定 0.45s 对 10° 的点头够用，对 100° 的起身/离座就是硬切；',
  '            // 衔接时用 0.12s 更是一定切。所以按角差算，同族且几乎没位移时才走利落档。',
  '            float entryDeg = 0f;',
  '            if (lastRot != null && clipBaseRot != null && bones != null)',
  '            {',
  '                for (int i = 0; i < bones.Length && i < lastRot.Length && i < clipBaseRot.Length; i++)',
  '                {',
  '                    if (bones[i] == null) continue;',
  '                    float d = Quaternion.Angle(lastRot[i], clipBaseRot[i]);',
  '                    if (d > entryDeg) entryDeg = d;',
  '                }',
  '            }',
  '            // 0.18s + 4.5ms/度：10°→0.23s、60°→0.45s、120°→0.72s、160°→0.90s',
  '            clipFadeIn = Mathf.Clamp(0.18f + entryDeg * 0.0045f, 0.18f, 0.90f);',
  '            if (continueFamily && entryDeg < 8f) clipFadeIn = 0.12f;',
  '            dbgEntryDeg = entryDeg;'
].join('\n'))
log.push('① 进入过渡按距离 (' + A.trim().slice(0, 12) + ')')

// ── ② 衔接不再强制短淡入：距离公式已经覆盖它 ──
const B = '            bool continueFamily = chainEntry || clipActive && string.Equals(activeBase, fam, StringComparison.OrdinalIgnoreCase)'
if (s.includes(B)) {
  s = s.replace(B, [
    '            // chainEntry 只作标记（日志用）：淡入时长交给下面的距离公式，',
    '            // 否则"接队"就等于强制 120ms —— 换族时那一下就是硬切。',
    '            bool continueFamily = clipActive && string.Equals(activeBase, fam, StringComparison.OrdinalIgnoreCase)'
  ].join('\n'))
  log.push('② 衔接不再强制短淡入')
}

// ── ③ 字段 + 日志 ──
if (!s.includes('private float dbgEntryDeg;')) {
  const C = '        private float dbgMaxDeg;'
  if (!s.includes(C)) throw new Error('dbgMaxDeg 锚点失配')
  s = s.replace(C, C + '\n        private float dbgEntryDeg;')
  log.push('③ dbgEntryDeg 字段')
}

// plan 日志里带上进入角差与淡入时长：以后"硬切"有数可查
const D = '" wall="'
const dIdx = s.indexOf(D)
if (dIdx > 0) {
  const lineStart = s.lastIndexOf('\n', dIdx) + 1
  const lineEnd = s.indexOf('\n', dIdx)
  const line = s.slice(lineStart, lineEnd)
  if (!line.includes('fade=')) {
    const patched = line.replace('" wall="', '" fade=" + Mathf.RoundToInt(clipFadeIn * 1000f) + "ms/" + Mathf.RoundToInt(dbgEntryDeg) + "deg wall="').replace('"ms/" + Mathf.RoundToInt(dbgEntryDeg) + "deg wall="', '"ms/" + Mathf.RoundToInt(dbgEntryDeg) + "deg wall="')
    s = s.slice(0, lineStart) + patched + s.slice(lineEnd)
    log.push('④ plan 日志加 fade/entry')
  }
}

// ── ④ 与队列并发的归还：50ms 太硬，改成"按距离算，但最多 250ms"──
const E = [
  '                if (HasAnimPending())',
  '                {',
  '                    exitRelSec = 0.05f;',
  '                    float chainEnd = ct + 0.05f;',
  '                    if (chainEnd < exitEndT || exitEndT <= 0f) exitEndT = chainEnd;',
  '                }'
].join('\n')
if (s.includes(E)) {
  s = s.replace(E, [
    '                // 后面还排着动作：归还缩到"够快但不成硬切"的程度 —— 最多 250ms，',
    '                // 而近距离本来就用不到 250ms（exitRelSec 此时已是按距离算出的值）。',
    '                if (HasAnimPending())',
    '                {',
    '                    if (exitRelSec > 0.25f) exitRelSec = 0.25f;',
    '                    float chainEnd = ct + exitRelSec;',
    '                    if (chainEnd < exitEndT || exitEndT <= 0f) exitEndT = chainEnd;',
    '                }'
  ].join('\n'))
  log.push('⑤ 归还 50ms -> ≤250ms 按距离')
}

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  ' + log.join('\n  '))
