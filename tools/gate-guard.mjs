import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')

const anchor = `      // 编排必须排在所有 cue 变换之后`
if (!s.includes(anchor)) throw new Error('编排注释锚点未找到')

// cues 为 null 表示"没有清单，交给 buildAct 按情绪映射兜底"，不能被我们替换成 []
if (!s.includes('Array.isArray(cues) && cues.length > 0')) {
  s = s.replace(anchor, `      // 只在真有 cue 时编排：cues === null 表示没清单、由 buildAct 按情绪兜底，
      // 把它换成 [] 等于告诉下游"明确没有动作"，actions 会变空（server.smoke 抓到过）。
      if (Array.isArray(cues) && cues.length > 0) {
${anchor}`)
  // 找到这段的收尾 catch 后补一个右花括号
  const catchEnd = `        log('[perf] planSequence failed: ' + (error && error.message))
      }`
  if (!s.includes(catchEnd)) throw new Error('catch 锚点未找到')
  s = s.replace(catchEnd, catchEnd + '\n      }')
}
writeFileSync(p, s, 'utf8')
console.log('  ✓ 编排加了 cues 存在性守卫')
