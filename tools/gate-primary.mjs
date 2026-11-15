import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')
const old = '  if (want.some((w) => have.includes(w))) return { cues, changed: [], want, picked: null }'
if (!s.includes(old)) { console.log('  ! 锚点失配'); process.exit(1) }
const neu = `  // 只认首要类别：句子里既有"喝"又有"累"时，喝是动作、累是背景。
  // 命中任一就放行，模型拿个 posture 就能蒙过关（实测就是这么漏的）。
  if (have.includes(want[0])) return { cues, changed: [], want, picked: null }`
s = s.replace(old, neu)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 只认首要类别')
