/**
 * 导演层的模式。
 *
 * 以前"专注"是 `extractNeeds` 末尾一个硬编码的 if：导演照常排全身表演，
 * 排完再判掉要身体的那些。这不是模式，是事后过滤——代价是编排预算全花在
 * 不能演的素材上，她像掉线一样坐着（实测十条里空六条）。
 *
 * 现在把它抬成一等概念：一个模式说明**这一段时间允许演什么**，
 * 导演层拿到的就是这份约束，而不是演完再被剪。
 *
 * 模式不是"少演"，是"换一种演法"：
 *   - upperOnly  只放行上半身能演的动作（要和给游戏端的 motionScope 对齐）
 *   - alt        演不了时换成的头颈替代（换不了才丢）
 *   - beats      这一轮最多几拍（专注时多拍会打断手上的事）
 * 还有一条隐性规则：`state` 动词（切整段行为）在任何受限模式下都不许，
 * 因为它换的是 DebugChangeState，跟采样族被分到哪一类无关。
 *
 * 注意 sleep 不是 phase，是**她已经在睡**（游戏按连续专注时长送她进去的）。
 * 那个状态下我们完全不演：既不能吵醒她，也不该在她趴着时动骨架。
 */
import { ACTIONS, FOCUS_ALT } from './actions.js'
import { classifyClip, MOTION_CLASS } from './motion-class.js'

const G = MOTION_CLASS.GESTURE

/**
 * 模式表。
 *
 * `upperOnly` 表示只动上半身，要和 `scopeFor` 给游戏端的 motionScope 对齐：
 * 那边对 focus / break 返回 upper，这边就必须只放行上身能演的动作，
 * 否则会出现用 upper 的骨权重去播一个全身 clip——动作做一半，看着像抽搐。
 */
export const MODES = {
  // 正常聊天：什么都能演
  idle: {
    name: 'idle',
    label: '正常',
    upperOnly: false,
    beats: 2,
    alt: {},
  },
  // 专注：只动头颈，演不了的换成头颈替代，且只要一拍
  focus: {
    name: 'focus',
    label: '专注',
    upperOnly: true,
    beats: 1,
    alt: FOCUS_ALT,
  },
  // 休息：和专注同样只动上半身（scope 那边本来也是 upper），
  // 但替代更放松——休息时点头比思考自然
  break: {
    name: 'break',
    label: '休息',
    upperOnly: true,
    beats: 2,
    alt: Object.assign({}, FOCUS_ALT, {
      work_pc: 'nod', work_report: 'nod', read_book: 'nod', novel: 'nod', pageflip: 'nod',
    }),
  },
  // 游戏自己在演剧情/说话：不排动作。
  // 这跟"专注"不同——专注时她还能用头颈回应，剧情时游戏占着整个舞台，
  // DLL 连 cue 都不肯取（RespectGame），侧车排了也只是排进 feed 里过期。
  busy: {
    name: 'busy',
    label: '剧情中',
    upperOnly: true,
    beats: 0,
    alt: {},
  },
  // 她已经睡了：什么都不做
  sleep: {
    name: 'sleep',
    label: '睡着',
    upperOnly: true,
    beats: 0,
    alt: {},
  },
}

function label(mode) {
  return (mode && mode.label) || (mode && mode.name) || ''
}

/**
 * 这一轮用哪个模式。
 *
 * `heroineState` 是游戏端上报的当前 ActionStateType 名。它比 phase 更权威：
 * 她睡着时游戏可能仍然是 idle，但那时我们绝对不能动她。
 */
export function modeOf(input) {
  const s = input || {}
  const heroine = String(s.heroineState || '')
  if (heroine === 'BreakSleep') return MODES.sleep
  // 游戏在走剧情时优先让位：她睡着也是不演，但日志口径要说清是哪一种。
  if (s.gameStory) return MODES.busy
  const phase = String(s.phase || '')
  if (phase === 'focus') return MODES.focus
  if (phase === 'break') return MODES.break
  return MODES.idle
}

/** 这个动词在给定模式下能不能直接演。 */
export function canPlay(verb, mode) {
  const a = ACTIONS[verb]
  if (!a || a.noMotion) return false
  if (mode.upperOnly && a.state) return false
  if (mode.upperOnly && classifyClip(a.family) !== G) return false
  return true
}

/**
 * 按模式整理需求：能演的留着，演不了的换成替代，换不了才丢，最后按拍数截断。
 *
 * 原地改 `needs`（调用方持有的数组），把理由交给 hooks 记录。
 * 之所以原地改而不是返回新数组：`needs` 里那些对象还被 `dropped` 引用着，
 * 复制一份会让丢的是哪一条变得对不上。
 */
export function applyMode(needs, mode, hooks) {
  const note = (hooks && hooks.note) || (() => {})
  const drop = (hooks && hooks.drop) || (() => {})
  const m = mode || MODES.idle
  if (!m.upperOnly) {
    trimBeats(needs, m, note, drop)
    return
  }

  for (let i = needs.length - 1; i >= 0; i -= 1) {
    const n = needs[i]
    if (canPlay(n.verb, m)) continue
    const alt = m.alt[n.verb]
    if (alt && canPlay(alt, m)) {
      note(label(m) + '：' + n.family + ' → 换成 ' + ACTIONS[alt].family)
      n.verb = alt
      n.family = ACTIONS[alt].family
      n.name = ''
      continue
    }
    const why = ACTIONS[n.verb] && ACTIONS[n.verb].state
      ? label(m) + '态不切状态'
      : label(m) + '态只动头颈'
    note(label(m) + '：' + n.family + ' 演不了，且没有替代，本轮不做')
    drop(Object.assign({}, n, { why }))
    needs.splice(i, 1)
  }

  // 替换会把不同意图压到同一个动作上（「困了 + 伸懒腰」都变成 nod）。
  // 同族只留优先级最高的一条，否则同一个点头会被排两遍。
  const best = new Map()
  for (const n of needs) {
    const cur = best.get(n.family)
    if (!cur || (Number(n.prio) || 0) > (Number(cur.prio) || 0)) best.set(n.family, n)
  }
  for (let i = needs.length - 1; i >= 0; i -= 1) {
    if (best.get(needs[i].family) !== needs[i]) {
      note(label(m) + '：' + needs[i].family + ' 与另一条重复，只留一条')
      needs.splice(i, 1)
    }
  }

  trimBeats(needs, m, note, drop)
}

/** 只留最重要的 N 拍。超出的记进 dropped，别静默消失。 */
function trimBeats(needs, mode, note, drop) {
  const max = Number(mode.beats)
  if (!Number.isFinite(max) || needs.length <= max) return
  const ranked = needs
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (Number(b.n.prio) || 0) - (Number(a.n.prio) || 0) || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map((x) => x.n)
  for (let i = needs.length - 1; i >= 0; i -= 1) {
    if (ranked.includes(needs[i])) continue
    note(label(mode) + '：' + needs[i].family + ' 超出本模式的拍数，本轮不排')
    drop(Object.assign({}, needs[i], { why: label(mode) + '态只排 ' + max + ' 拍' }))
    needs.splice(i, 1)
  }
}
