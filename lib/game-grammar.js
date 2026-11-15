// 照着游戏自己的语法编排（数据来自 lib/game-grammar.json，由 tools/learn-game-grammar.mjs 生成）。
//
// 学到的四条：
//   1) 场景层：剧情动作 / 站立动作 / 休息 / 工作 / 表情 —— 她的动作属于某一层，跨层就是"打架"
//      （坐在工位却在演站起来的动作 = 视觉穿模，之前 summarizer 只能靠排除法躲，现在有层判定）
//   2) 家族形态：46 个家族是 start+loop+end 三段，137 个是单段。三段式要按说话长度决定 loop 次数
//   3) 单段动作中位 4.0s，比我们给 cue 的 d（1.8~2.4s）长 —— 之前是为了塞进 d 而加速，等于改她的节奏
//   4) loop 段中位 1.9s，是"保持"的节拍，不是"演完"
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const grammar = JSON.parse(readFileSync(fileURLToPath(new URL('./game-grammar.json', import.meta.url)), 'utf8'))
// 表结构：byFamily 是家族字典（families 只是计数）。旧版把字典也叫 families，这里同时兼容。
const FAM = grammar.byFamily || grammar.families || {}

const LAYER_OF_SCENE = {
  story: '剧情动作',
  wild: '站立动作',
  break: '休息',
  work: '工作',
  face: '表情'
}

export function familyOf(id) {
  return String(id || '').replace(/_(start|loop|loop2|end)$/, '')
}

export function segmentOf(id) {
  const m = String(id || '').match(/_(start|loop|loop2|end)$/)
  return m ? m[1] : 'single'
}

/** 这条动作属于哪个场景层（游戏自己的语义第 1 层） */
export function layerOf(id) {
  const fam = FAM[familyOf(id)]
  if (fam?.semantic?.length) return fam.semantic[0]
  const scene = (/^anim_([a-z]+)_/.exec(familyOf(id)) || [])[1]
  return LAYER_OF_SCENE[scene] || ''
}

/** 家族有哪些段（single / start+loop+end …） */
export function segsOf(id) {
  const fam = FAM[familyOf(id)]
  return fam?.segs || ['single']
}

/** 这条段自己的时长（毫秒），拿不到就返回 null —— 绝不猜 */
export function durationOf(id) {
  const fam = FAM[familyOf(id)]
  const seg = segmentOf(id)
  const d = fam?.segDurations?.[seg] ?? fam?.durationMs
  return Number.isFinite(d) && d > 0 ? d : null
}

/** 家族的完整三段（若游戏给了） */
export function tripleOf(id) {
  const fam = familyOf(id)
  const segs = segsOf(id)
  const has = (s) => segs.includes(s)
  const out = []
  if (has('start')) out.push(fam + '_start')
  const loopName = has('loop2') ? fam + '_loop2' : has('loop') ? fam + '_loop' : ''
  if (loopName) out.push(loopName)
  if (has('end')) out.push(fam + '_end')
  return out
}

export { grammar }
