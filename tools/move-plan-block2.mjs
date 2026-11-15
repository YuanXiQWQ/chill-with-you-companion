import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')

const endMarker = `        log('[perf] planSequence failed: ' + (error && error.message))
      }`
const a = s.indexOf('      // 编排必须排在所有 cue 变换之后')
const start = a >= 0 ? a : s.indexOf('      mark("plan-enter"')
const b = s.indexOf(endMarker)
if (start < 0 || b < 0 || b < start) throw new Error('块边界异常')
const block = s.slice(start, b + endMarker.length)
s = s.slice(0, start) + s.slice(b + endMarker.length)

// 沙箱分支外面：sandbox:true 的联调轮次也要编排，否则调参永远测不到
const anchor = '    // 沙箱轮次完全不落地：历史、事实、摘要、状态一律不碰'
if (!s.includes(anchor)) throw new Error('沙箱分支锚点未找到')
s = s.replace(anchor, block + '\n' + anchor)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 编排块移到沙箱分支之外')
