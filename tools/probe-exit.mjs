import { readFileSync, writeFileSync } from 'node:fs'

const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const log = []

if (!s.includes('dbgPeakBone')) {
  const A = '        private float dbgPeakDt;'
  if (!s.includes(A)) throw new Error('dbgPeakDt 锚点失配')
  s = s.replace(A, A + '\n        private string dbgPeakBone = "";\n        private float dbgExitDeg;\n        private float dbgExitSec;')
  log.push('① 字段')
}

const B = '                    if (spd > headSpeedMax) { headSpeedMax = spd; dbgPeakAt = ct; dbgPeakDt = dt; }'
if (s.includes(B)) {
  s = s.replace(B, '                    if (spd > headSpeedMax) { headSpeedMax = spd; dbgPeakAt = ct; dbgPeakDt = dt; dbgPeakBone = tr.name ?? ""; }')
  log.push('② 记骨头名')
}

// 交接段：算出 exitFrom→exitRot 的真实角差与给的时间，并打在日志里
const C = '                    if (HasAnimPending()) exitRelSec = 0.12f;'
if (s.includes(C)) {
  s = s.replace(C, [
    '                    if (HasAnimPending()) exitRelSec = Mathf.Min(exitRelSec, 0.25f);',
    '                    // 交接质量硬指标：要从"她最后演到的姿势"回到"游戏姿势"差多少度、给了多少时间',
    '                    dbgExitDeg = 0f;',
    '                    if (exitFrom != null && exitRot != null)',
    '                        for (int bb = 0; bb < exitFrom.Length && bb < exitRot.Length; bb++)',
    '                        {',
    '                            float dd = Quaternion.Angle(exitFrom[bb], exitRot[bb]);',
    '                            if (dd > dbgExitDeg) dbgExitDeg = dd;',
    '                        }',
    '                    dbgExitSec = exitRelSec;',
    '                    if (Plugin.VerboseCues != null && Plugin.VerboseCues.Value)',
    '                        Plugin.Log.LogInfo("exit: deg=" + dbgExitDeg.ToString("F1") + " over=" + (exitRelSec * 1000f).ToString("F0") + "ms => " + (dbgExitDeg / Mathf.Max(0.01f, exitRelSec)).ToString("F0") + "dps");'
  ].join('\n'))
  log.push('③ 交接段度量')
}

const D = '" peakHead=" + headSpeedMax.ToString("F0") + "dps@t"'
if (s.includes(D)) {
  s = s.replace('+ "dps@t" + dbgPeakAt.ToString("F2") + "s/dt" + (dbgPeakDt * 1000f).ToString("F1") + "ms"', '+ "dps@t" + dbgPeakAt.ToString("F2") + "s/dt" + (dbgPeakDt * 1000f).ToString("F1") + "ms/" + dbgPeakBone')
  log.push('④ 日志带骨头名')
}

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  ' + log.join('  '))
