import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')

const endMarker = `        log('[perf] planSequence failed: ' + (error && error.message))
      }`
const startMarker = '      mark("plan-enter"'
const a = s.indexOf(startMarker)
const b = s.indexOf(endMarker)
if (a < 0 || b < 0) throw new Error('编排块边界未找到')
const block = s.slice(a, b + endMarker.length)
s = s.slice(0, a) + s.slice(b + endMarker.length)

// 插到「所有 cue 变换都做完」之后：状态推进之前
const anchor = '      state.turnCount += 1'
if (!s.includes(anchor)) throw new Error('插入锚点未找到')
s = s.replace(anchor, block + '\n' + anchor)

// 注释说明为什么放这么靠后
s = s.replace(startMarker, `      // 编排必须排在所有 cue 变换之后（情绪兜底 / 情绪签名 / 专注态降级都在这之前），
      // 否则闸门看到的是空数组，什么都换不掉 —— 之前就栽在这里。
${startMarker}`)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 编排块已移到 cue 组装完成之后')
