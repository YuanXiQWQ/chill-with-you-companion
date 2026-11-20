// 姿势族查表：她那 180 条原生动作是**按族命名**的，族与族之间姿势基准不同。
//
// 跨族播不是"换个动作"，是"换一套姿势基准"——她会从当前姿势被搬走再搬回来，
// 观感就是一次打断。游戏端（ChillPerformer.dll）已经有一道闸，同族才播；
// 这里做的是**前置挑**：在手上有别的选择时，先按她此刻的族去挑，而不是事后被丢掉。
//
// 数据来源：game/native-gestures.json，由游戏枚举 Enum.GetNames(AnimationType) 导出，
// 族划分与 stateToFamily 都是实测/推断混合，字段里标了 evidence。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

let TABLE = null
let TABLE_ERROR = ''

/** 惰性读表。读不到就让调用方拿到 null，整条链退回"不挑，交给游戏端闸门"。 */
export function table() {
  if (TABLE || TABLE_ERROR) return TABLE
  try {
    TABLE = JSON.parse(readFileSync(join(HERE, '..', 'game', 'native-gestures.json'), 'utf8'))
  } catch (e) {
    TABLE_ERROR = String(e && e.message ? e.message : e)
    TABLE = null
  }
  return TABLE
}

export function tableError() {
  table()
  return TABLE_ERROR
}

/** 族名 -> 这一族里真正能演的动作（去掉光秃秃的族名本身）。 */
export function gesturesIn(family) {
  const t = table()
  if (!t || !family) return []
  const list = t.families && t.families[family]
  if (!Array.isArray(list)) return []
  return list.filter((n) => String(n).indexOf('_') > 0)
}

/** 她的 ActionStateType 对应哪一族。表里没有就猜：BreakXxx -> BreakBase00N 不猜，返回 ''。 */
export function familyOfState(stateName, animName = '') {
  const t = table()
  const s = String(stateName || '')
  if (t && t.stateToFamily && t.stateToFamily[s]) return String(t.stateToFamily[s].family || '')
  // 退一步看她此刻的动画名，前缀就是族
  const a = String(animName || '')
  const cut = a.indexOf('_')
  if (cut > 0) return a.slice(0, cut)
  return a || ''
}

/** clip id 属于哪一族。和游戏端 ClipFamily 同一套判断。 */
export function familyOfClip(clipId) {
  const s = String(clipId || '').toLowerCase()
  if (!s) return ''
  if (s.includes('work_pc')) return 'WorkBase002'
  if (s.includes('work_book')) return 'WorkBase002'
  if (s.includes('work_report')) return 'WorkBase003'
  if (s.includes('break_movie')) return 'BreakBase001'
  if (s.includes('break_novel')) return 'BreakBase002'
  if (s.includes('break_music')) return 'BreakBase003'
  if (s.includes('break_tea')) return 'BreakBase004'
  if (s.includes('break_sleep')) return 'BreakBase005'
  if (s.includes('break_forward')) return 'BreakBase006'
  if (s.includes('story') || s.includes('base001')) return 'Base001'
  if (s.includes('wild')) return 'Wild'
  return ''
}

/** 近义动作词。各族动作表很小（休息族 2~6 条），得按它真有的词去找。 */
const SYNONYMS = {
  shy: ['Laugh', 'Interest', 'Smile'],
  smile: ['Laugh', 'Interest', 'Smile'],
  happy: ['Laugh', 'Interest', 'Smile'],
  fun: ['Laugh', 'Interest', 'Smile'],
  laugh: ['Laugh', 'Interest', 'Smile'],
  cheer: ['Laugh', 'Interest'],
  think: ['Interest', 'Thinking', 'Suspenseful'],
  thinking: ['Interest', 'Thinking', 'Suspenseful'],
  curious: ['Interest'],
  wonder: ['Interest'],
  surprise: ['Suspenseful', 'Interest'],
  fear: ['Suspenseful'],
  worry: ['Suspenseful', 'Interest'],
  nervous: ['Suspenseful', 'Interest'],
  drink: ['DrinkTea', 'DrinkHot', 'CoolingDrinkTea'],
  tea: ['DrinkTea', 'DrinkHot', 'CoolingDrinkTea'],
  sip: ['DrinkTea', 'DrinkHot'],
  stretch: ['Stretch', 'Laugh'],
  relax: ['Stretch', 'Laugh'],
  read: ['NextPage', 'Interest'],
  page: ['NextPage', 'Interest'],
  nod: ['Interest', 'Laugh', 'Thinking', 'Stop'],
  shakehead: ['Stop', 'Thinking', 'Interest'],
}

function findInFamily(family, key) {
  if (!family || !key) return ''
  const list = gesturesIn(family)
  const k = String(key).toLowerCase()
  for (const name of list) if (String(name).toLowerCase().includes(k)) return name
  return ''
}

/**
 * 把一个动作名换算到她此刻的族里。
 * 返回族里真实的动作名；换不出来返回 ''（调用方应把这条动作丢掉，只留表情与嘴形）。
 */
export function mapGesture(want, family) {
  const w = String(want || '')
  const f = String(family || '')
  if (!w) return ''
  if (!f) return w
  const cut = w.indexOf('_')
  const wBase = cut > 0 ? w.slice(0, cut) : w
  if (wBase.toLowerCase() === f.toLowerCase()) return w
  const suffix = cut >= 0 ? w.slice(cut + 1) : w

  const exact = f + '_' + suffix
  if (gesturesIn(f).some((n) => n.toLowerCase() === exact.toLowerCase())) return exact

  const lastCut = suffix.lastIndexOf('_')
  const key = lastCut >= 0 && lastCut < suffix.length - 1 ? suffix.slice(lastCut + 1) : suffix
  const byKey = findInFamily(f, key)
  if (byKey) return byKey

  for (const alt of SYNONYMS[String(key).toLowerCase()] || []) {
    const hit = findInFamily(f, alt)
    if (hit) return hit
  }
  // 都没命中时别返回空。返回空 = 这条动作被整条丢掉，一轮下来 0 条 cue，她站着不说话也不动。
  // 实测：专注时她的族是 WorkBase001（只有 Stop / Thinking / DrinkTea / Break / Break2），
  // 而模型给的常是 Story 族的 sub_nod / sub_fun —— 这些词在 WorkBase001 里一个都没有，
  // 于是「点头」被丢掉、「笑」被丢掉，那一轮什么都没演。
  // 退到这一族的第一个手势：动作不一定贴情绪，但她是活的，而且不会打断姿势基准。
  const any = gesturesIn(f)
  return any.length ? any[0] : ''
}

/**
 * 按族改写整段演出的动作。
 * - nativeSub：换成族里同名的子动作；没有就清空（游戏端也会跳过，但这里清掉能让日志说人话）
 * - nativeName：换算成族内等价动作；没有就清掉
 * - 纯采样 cue（没有原生标记）：clip 属于别的族就整条去掉动作
 *
 * 返回统计，调用方拿去打一行日志。
 */
export function applyFamily(act, family, { allow = false } = {}) {
  const stats = { family: String(family || ''), mapped: 0, dropped: 0, sampledDropped: 0, kept: 0 }
  if (!act || !Array.isArray(act.performance) || allow) return stats
  const f = String(family || '')
  for (const c of act.performance) {
    if (!c || c.slot !== 'animations') { continue }
    const hasNative = Boolean(c.nativeName || c.nativeSub)
    if (hasNative) {
      if (c.nativeSub) {
        const mappedSub = mapGesture(f + '_' + String(c.nativeSub), f)
        if (mappedSub) {
          if (mappedSub !== c.nativeSub) c.nativeSub = mappedSub.slice(f.length + 1)
        } else {
          c.nativeSub = ''
          if (!c.nativeName) { stats.dropped += 1 }
        }
      }
      if (c.nativeName) {
        const mapped = mapGesture(c.nativeName, f)
        if (mapped && mapped !== c.nativeName) { c.nativeName = mapped; stats.mapped += 1 } else if (mapped) { stats.kept += 1 } else { c.nativeName = ''; stats.dropped += 1 }
      }
      continue
    }
    const clipFam = familyOfClip(c.id)
    if (f && clipFam && clipFam.toLowerCase() !== f.toLowerCase()) {
      c.id = ''
      stats.sampledDropped += 1
    }
  }
  // id 被清空的 cue 等于没有动作，直接从这一段里去掉（表情/台词在别的 cue 上）
  const before = act.performance.length
  act.performance = act.performance.filter((c) => c && !(c.slot === 'animations' && !c.id && !c.nativeName && !c.nativeSub))
  if (before !== act.performance.length) stats.removed = before - act.performance.length
  return stats
}
