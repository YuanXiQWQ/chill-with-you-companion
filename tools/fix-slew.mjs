import { readFileSync, writeFileSync } from 'node:fs'

const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const log = []

// 写入端限速：放在所有混合（进入/归还/envelope）之后、真正写骨骼之前
const A = '                float d = Quaternion.Angle(lastRot[i], q);'
if (!s.includes(A)) throw new Error('写骨骼前锚点失配')
s = s.replace(A, [
  '                // 硬限速：段边界、envelope 尾巴、clip 自己的末帧，都会在某些帧造成单帧大跳。',
  '                // 这里按预算收口（头 160dps / 身体 320dps），任何来源的跳变都变成 1~2 帧的快速过渡，',
  '                // 而不是一帧切过去。1.15 留一点余量，免得正常快动作被压成慢动作。',
  '                {',
  '                    float limDt = Mathf.Max(0.0001f, Time.deltaTime);',
  '                    float budget = isHead',
  '                        ? (Plugin.HeadSpeedBudget == null ? 160f : Plugin.HeadSpeedBudget.Value)',
  '                        : (Plugin.BodySpeedBudget == null ? 320f : Plugin.BodySpeedBudget.Value);',
  '                    float allowDeg = Mathf.Max(0.6f, budget * limDt * 1.15f);',
  '                    float jumpDeg = Quaternion.Angle(lastRot[i], q);',
  '                    if (jumpDeg > allowDeg)',
  '                    {',
  '                        q = Quaternion.Slerp(lastRot[i], q, allowDeg / jumpDeg);',
  '                        dbgClamped++;',
  '                        if (jumpDeg > dbgClampMax) dbgClampMax = jumpDeg;',
  '                    }',
  '                }',
  A
].join('\n'))
log.push('① 写入端按预算限速')

if (!s.includes('dbgClamped')) {
  const B = '        private float dbgExitSec;'
  if (!s.includes(B)) throw new Error('dbgExitSec 锚点失配')
  s = s.replace(B, B + '\n        private int dbgClamped;\n        private float dbgClampMax;')
  log.push('② 计数器字段')
}

// 每段开头清零
const C = '            headDevDeg = 0f;\n            float wBody = planWBody'
if (s.includes(C)) {
  s = s.replace(C, '            headDevDeg = 0f;\n            dbgClamped = 0; dbgClampMax = 0f;\n            float wBody = planWBody')
  log.push('③ 每段清零')
}

// 日志里带限速次数
const D = '+ " moved=head:"'
if (s.includes(D)) {
  s = s.replace(D, '+ " clamp=" + dbgClamped + "\\u00b0" + dbgClampMax.ToString("F0") + "d"\n                + " moved=head:"')
  log.push('④ 日志带限速')
}

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  ' + log.join('  '))
