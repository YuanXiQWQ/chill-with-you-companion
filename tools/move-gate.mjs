import { readFileSync, writeFileSync } from 'node:fs'
const p = 'brain.mjs'
let s = readFileSync(p, 'utf8')

const block = `        // 闸门：内容明确指向某类动作（喝/写/累/走）而模型选的类别完全不符，就换掉。
        // 提示词只是建议，这里才是保证；只看"完全不符"，不敢覆盖模型的部分正确选择。
        const gate = enforceContentClass(cues, {
          text,
          emotion: parsed.emotion,
          manifest,
          currentLayer: curLayer,
        })
        if (gate.changed.length) {
          cues = gate.cues
          log('[perf] content gate: ' + JSON.stringify(gate.changed))
        }
`
if (!s.includes(block)) throw new Error('闸门块未找到')
s = s.replace(block, '')

const anchor = `        const planned = planSequence(cues, {`
if (!s.includes(anchor)) throw new Error('planSequence 调用未找到')
// 闸门必须排在"情绪兜底 / gateCues"之后：模型有时不给动作，兜底补的那条也要过闸门
s = s.replace(anchor, block + anchor)
writeFileSync(p, s, 'utf8')
console.log('  ✓ 闸门移到兜底之后、编排之前')
