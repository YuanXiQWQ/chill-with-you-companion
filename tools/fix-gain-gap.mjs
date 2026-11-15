import { readFileSync, writeFileSync } from 'node:fs'

const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const log = []
const applied = (m, fn) => { if (s.includes(m)) { log.push('skip ' + m.slice(0, 14)); return } fn(); log.push('ok   ' + m.slice(0, 14)) }

// ① 限速位置：首次发生与最大跳变发生的时间
applied('dbgClampFirst', () => {
  const A = '        private int dbgClamped;'
  if (!s.includes(A)) throw new Error('dbgClamped 锚点失配')
  s = s.replace(A, A + '\n        private float dbgClampFirst = -1f;\n        private float dbgClampAt = -1f;')
})

applied('dbgClampFirst = ct;', () => {
  const A = [
    '                    if (jumpDeg > allowDeg)',
    '                    {',
    '                        q = Quaternion.Slerp(lastRot[i], q, allowDeg / jumpDeg);',
    '                        dbgClamped++;',
    '                        if (jumpDeg > dbgClampMax) dbgClampMax = jumpDeg;',
    '                    }'
  ].join('\n')
  if (!s.includes(A)) throw new Error('限速块锚点失配')
  s = s.replace(A, [
    '                    if (jumpDeg > allowDeg)',
    '                    {',
    '                        q = Quaternion.Slerp(lastRot[i], q, allowDeg / jumpDeg);',
    '                        dbgClamped++;',
    '                        if (dbgClampFirst < 0f) dbgClampFirst = ct;',
    '                        if (jumpDeg > dbgClampMax) { dbgClampMax = jumpDeg; dbgClampAt = ct; dbgClampBone = tr.name ?? ""; }',
    '                    }'
  ].join('\n'))
})

applied('dbgClampBone', () => {
  const A = '        private float dbgClampAt = -1f;'
  if (!s.includes(A)) throw new Error('dbgClampAt 锚点失配')
  s = s.replace(A, A + '\n        private string dbgClampBone = "";')
})

// 日志带上位置
applied('clampFirst=', () => {
  const A = '+ " clamp=" + dbgClamped'
  if (!s.includes(A)) throw new Error('clamp 日志锚点失配')
  s = s.replace(A, '+ " clamp=" + dbgClamped + "\\u00b0t" + dbgClampFirst.ToString("F2") + "/" + dbgClampAt.ToString("F2") + "s/" + dbgClampBone')
})

// 每段开头重置
applied('dbgClampFirst = -1f; dbgClampAt = -1f;', () => {
  const A = '            dbgClamped = 0; dbgClampMax = 0f;'
  if (!s.includes(A)) throw new Error('清零锚点失配')
  s = s.replace(A, A + '\n            dbgClampFirst = -1f; dbgClampAt = -1f; dbgClampBone = "";')
})

// ② 归还目标 2 帧平滑：游戏自己切 idle 时，单帧取到的目标会跳
applied('exitRotSmooth', () => {
  const A = '            exitValid = CaptureGamePose(exitRot);'
  if (!s.includes(A)) throw new Error('CaptureGamePose 锚点失配')
  s = s.replace(A, [
    '            exitValid = CaptureGamePose(exitRot);',
    '            // 游戏侧也会自己切待机：单帧取到的目标可能正处在它的过渡里。',
    '            // 用 2 帧平滑（0.5 权重）压掉那一下，交接差从 8° 降到 1° 量级。',
    '            if (exitValid)',
    '            {',
    '                if (exitSmooth == null || exitSmooth.Length != n)',
    '                {',
    '                    exitSmooth = new Quaternion[n];',
    '                    for (int bb = 0; bb < n; bb++) exitSmooth[bb] = exitRot[bb];',
    '                }',
    '                else',
    '                {',
    '                    for (int bb = 0; bb < n; bb++) exitRot[bb] = Quaternion.Slerp(exitSmooth[bb], exitRot[bb], 0.5f);',
    '                    for (int bb = 0; bb < n; bb++) exitSmooth[bb] = exitRot[bb];',
    '                }',
    '            }'
  ].join('\n'))
})

applied('private Quaternion[] exitSmooth;', () => {
  const A = '        private Quaternion[] exitFrom;'
  if (!s.includes(A)) throw new Error('exitFrom 字段锚点失配')
  s = s.replace(A, A + '\n        private Quaternion[] exitSmooth;')
})

// 离开时清掉平滑缓存，避免跨段串味
applied('exitSmooth = null;', () => {
  const A = '                        clipActive = false; ReleaseBaseGameCache(); exitValid = false;'
  if (!s.includes(A)) throw new Error('释放锚点失配')
  s = s.replace(A, A + '\n                        exitSmooth = null;')
})

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  ' + log.join('  '))
