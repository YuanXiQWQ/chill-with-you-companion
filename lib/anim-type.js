// 原生动作映射。动作知识全在 actions.js，这里只保留"哪些动词走原生"的白名单
// 和给 cue 用的 nativeName / nativeId 形状。

import { ACTIONS, ACTION_ORDER, nativeOf } from './actions.js'

// 只有"她自己做一下"的动作切原生。
// 活动类（写代码 / 看书 / 看电影 / 听歌）先留采样路径：
// 原生那边对应的 WorkBase* / BreakBase* 是持续状态，不是"播一次动作"，
// 用 ChangeAnimation 播完会立刻回落待机，对持续状态不对。
// 判据只有一条：actions.js 里配了 native 的才走。
// 配 native 的必然是一次性动作（打哈欠、点头）；持续状态（写代码、看书）
// 一个都没配——它们要的是 HeroineAI 的状态切换，不是播一次。
export const NATIVE_VERBS = new Set(ACTION_ORDER.filter((v) => ACTIONS[v].native))

// 返回的键名必须带 native 前缀：这个对象是 spread 进 cue 的，
// 用 { name, id } 会把 cue 自己的 id（clip 族名）覆盖成枚举数字。
export function toNative(verb) {
  const a = ACTIONS[verb]
  if (!a) return null
  // 表情独立于动作：它落在 L2，动作在 L0，可以只换脸不换姿势。
  // 所以「有 facial 但既不是持续状态也不是原生动作」时也要返回，不能返回 null。
  const facial = a.facial ? { facial: String(a.facial) } : {}
  // 持续状态优先于单次动作：work_pc / read_book / movie 这些不是"演一下"，
  // 是"她在干什么"。有 state 就交给游戏的状态机，别用采样硬凑。
  if (a.state) return { stateName: String(a.state), ...facial }
  if (!NATIVE_VERBS.has(verb)) return (facial.facial ? facial : null)
  return { ...nativeOf(verb), ...facial }
}

// 日志用：这一轮有几条走了原生。带 nativeSub 的没写死全名——全名要到游戏端按基底才拼得出来。
export function describeNative(cues) {
  return (Array.isArray(cues) ? cues : [])
    .filter((c) => c && (c.nativeName || c.nativeSub || c.stateName || c.facial))
    .map((c) => {
      const body = c.nativeName || (c.nativeSub ? '<sub:' + c.nativeSub + '>' : '')
      const head = [c.stateName ? '状态:' + c.stateName : '', body].filter(Boolean).join(' ')
      const face = c.facial ? '表情:' + c.facial : ''
      const tail = [head || '仅表情', face].filter(Boolean).join(' ')
      return tail + '(' + (c.durationMs || 0) + 'ms)'
    })
}