// 让编排真正照着游戏语法走：层锁定、三段展开、用游戏自己的时长。
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'lib/motion-class.js'
let s = readFileSync(p, 'utf8')

if (!s.includes("from './game-grammar.js'")) {
  s = s.replace("const asArray = (v)", `import { layerOf, segsOf, durationOf, tripleOf, familyOf as grammarFamily } from './game-grammar.js'

const asArray = (v)`)
}

const startIdx = s.indexOf('export function planSequence')
if (startIdx < 0) throw new Error('planSequence 未找到')
const newPlanner = `/**
 * 编排一条回复的动画序列 —— 完全照游戏自己的语法：
 *   · 层锁定：她此刻在哪个场景层（剧情/站立/休息/工作/表情），就优先给同层的动作；
 *     跨层的动作往后排并标注 layerSwitch，因为"坐着演站起来"会穿模。
 *   · 三段展开：家族是 start+loop+end 就把 loop 按说话长度重复填满，而不是演完就僵住。
 *   · 时长用游戏自己的（单段中位 4.0s），不再为了塞进 cue 的 d 而改她的节奏。
 * @param cues 已通过 sanitizePerformance 的 cue（slot=animations）
 * @param opts { text, currentClass, currentLayer, currentEndsAt, speechMs }
 */
export function planSequence(cues, opts = {}) {
  const list = asArray(cues).filter((c) => c && c.slot === 'animations')
  const others = asArray(cues).filter((c) => c && c.slot !== 'animations')
  if (list.length === 0) return { cues: others, notes: [] }

  const notes = []
  const speechMs = Number.isFinite(opts.speechMs) ? opts.speechMs : 3200
  let cursor = Number.isFinite(opts.currentEndsAt) ? Math.max(0, opts.currentEndsAt) : 0
  let fromClass = opts.currentClass || MOTION_CLASS.IDLE
  let curLayer = opts.currentLayer || ''

  // 相关度：内容命中的类别靠前；同层优先（层不同要给切换留时间）
  const hint = contentClasses(opts.text)
  const ranked = list
    .map((c, i) => {
      const cls = classifyClip(c.id)
      const layer = layerOf(c.id)
      const hit = hint.indexOf(cls)
      const sameLayer = curLayer && layer === curLayer ? 12 : 0
      const score = (hit >= 0 ? 100 - hit * 10 : 0) + sameLayer + (cls === MOTION_CLASS.GESTURE ? 5 : 0) + (10 - i) * 0.1
      return { cue: c, cls, layer, score, order: i }
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)

  const out = []
  for (const item of ranked) {
    const wantAt = Math.max(0, Number(item.cue.at) || 0)
    const start = Math.max(wantAt, cursor)
    if (start !== wantAt) notes.push({ id: item.cue.id, cls: item.cls, movedFrom: wantAt, to: start, why: 'wait-for-previous' })

    if (curLayer && item.layer && item.layer !== curLayer) {
      notes.push({ id: item.cue.id, layerFrom: curLayer, layerTo: item.layer, why: 'layer-switch' })
      curLayer = item.layer
      fromClass = MOTION_CLASS.POSTURE // 换层要先起身/坐下，按姿态类留过渡
    }

    // 用游戏自己的时长：单段动作往往 4 秒，别压成 2 秒
    const ownMs = durationOf(item.cue.id)
    const segs = segsOf(item.cue.id)
    const triple = tripleOf(item.cue.id)

    if (triple.length >= 3 && speechMs > 1200) {
      // start 进入 → loop 按说话长度重复 → end 退出
      const startMs = durationOf(triple[0]) || 700
      const loopMs = durationOf(triple[1]) || 1900
      const endMs = durationOf(triple[2]) || 700
      const fill = Math.max(1, Math.round((Math.max(speechMs, startMs + loopMs) - startMs - endMs) / loopMs))
      out.push({ ...item.cue, id: triple[0], at: start, durationMs: startMs })
      for (let k = 0; k < fill; k += 1) {
        out.push({ ...item.cue, id: triple[1], at: start + startMs + k * loopMs, durationMs: loopMs })
      }
      out.push({ ...item.cue, id: triple[2], at: start + startMs + fill * loopMs, durationMs: endMs })
      notes.push({ id: grammarFamily(item.cue.id), triple: true, fill, why: 'game-grammar start+loop+end' })
      cursor = start + startMs + fill * loopMs + endMs
    } else {
      const dur = Math.max(600, ownMs || Number(item.cue.durationMs) || 2400)
      out.push({ ...item.cue, at: start, durationMs: dur, segs })
      cursor = start + dur
    }

    const trans = transitionMs(fromClass, item.cls)
    cursor += EXCLUSIVE.has(item.cls) ? Math.max(0, trans) : trans
    if (EXCLUSIVE.has(item.cls)) notes.push({ id: item.cue.id, cls: item.cls, exclusive: true })
    fromClass = item.cls
    if (item.layer) curLayer = item.layer
  }
  return { cues: [...out, ...others], notes }
}
`
s = s.slice(0, startIdx) + newPlanner
writeFileSync(p, s, 'utf8')
console.log('  ✓ planSequence 改为游戏语法驱动')
