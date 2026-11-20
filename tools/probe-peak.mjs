import { readFileSync, writeFileSync } from 'node:fs'

const p = 'game/src/PerformerPlugin.cs'
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const log = []

if (!s.includes('dbgPeakAt')) {
  const A = '        private float headSpeedMax;'
  if (!s.includes(A)) throw new Error('headSpeedMax 字段锚点失配')
  s = s.replace(A, A + '\n        // 尖峰定位：峰值角速度发生在第几秒、那一帧 dt 多少（判断是真空跳还是 dt 量化）\n        private float dbgPeakAt;\n        private float dbgPeakDt;')
  log.push('① 字段')
}

const B = '                    headSpeedMax = Mathf.Max(headSpeedMax, d / dt);'
if (s.includes(B)) {
  s = s.replace(B, [
    '                    float spd = d / dt;',
    '                    if (spd > headSpeedMax) { headSpeedMax = spd; dbgPeakAt = ct; dbgPeakDt = dt; }'
  ].join('\n'))
  log.push('② 记录峰值位置')
}

const C = '" peakHead=" + headSpeedMax.ToString("F0") + "dps'
if (s.includes(C)) {
  s = s.replace(C, '" peakHead=" + headSpeedMax.ToString("F0") + "dps@t" + dbgPeakAt.ToString("F2") + "s/dt" + (dbgPeakDt * 1000f).ToString("F1") + "ms')
  log.push('③ 日志带位置')
}

writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8')
console.log('  ' + log.join('  '))
