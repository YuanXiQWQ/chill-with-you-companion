// 离座：把这件事交还给游戏自己。
//
// ── 为什么推倒重来（2026-11-15 实测，见 docs/离座真相.md）──────────────
// 旧设计是"排一条 clip 时间轴"：go → deepthink_start → loop(按住几分钟) → end → comeback，
// 外加自己搬角色根位移、自己切房间相机。全部证伪：
//
//   · Character 根全程 (2.74, 0.00, 1.70)，一格没动；
//   · HeroineService._currentPlace 全程 Desk（她正在播沙发动画时也是 Desk）；
//   · HeroineService._heroineTransform 是空表，没有可切换的摆位点；
//   · 唯一在变的是 AnimationType：Wild003_LeaveChair_Sofa_Look_Outside …
//
// 也就是说，游戏里"沙发"是一个**动画状态**，不是一个空间位置。位移从一个设计里删掉，
// 不是因为参数没调好，是因为它根本不存在。
//
// 而"待着"也不是按住一条 loop：HeroineStateLeaveChairGoSofa 用权重 + 秒表在
// thinking(40~70s) / lookOutside(40~70s) / headphone(15~20s) 之间轮转，
// 每种抽过之后进 180/180/10 秒冷却。它自己会播 start/loop/end，自己会回来。
//
// 所以侧车这一层只剩两件事：
//   1. 判定"这句话的主戏是离开椅子"（用户口径：主戏是离开就触发这段）；
//   2. 在那段时间里锁住编排——她不在椅子上，插动作没有落点。
//
// 走出去、坐下、在沙发上轮转、起身、回来——全部由游戏自己的
// HeroineAI / HeroineStateLeaveChair* 负责，我们只按下开始。

import { subjectOf } from './subject.js'

// 每个计划：怎么说 → 游戏那边的 LeaveChairPlan 枚举名。
// 枚举名是游戏自己的词汇（已实测 Sofa 可用）；名字对不上时游戏端会打日志并回退，
// 不会静默什么都不做。
export const LEAVE_PLANS = {
  sofa: {
    plan: 'Sofa',
    label: '去沙发',
    re: /沙发|躺一会|躺一下|去躺|躺会儿|歪一会|过去坐/
  },
  far: {
    plan: 'Far',
    label: '去拿点东西',
    re: /拿个杯子|拿杯子|倒杯水|去倒水|拿点吃的|拿点零食|去拿饼干|零食|薯片|面包|纸杯蛋糕|拿蛋糕|去厨房|去冰箱/
  }
}

// 这句话是不是要她离开椅子。返回 { key, plan, label, said } 或 null。
// 只认"明确要她起身"的说法；"我想吃蛋糕"不算——那是想吃，不是让她去拿。
export function decideTrip(text) {
  const s = String(text || '')
  for (const key of Object.keys(LEAVE_PLANS)) {
    const p = LEAVE_PLANS[key]
    const m = p.re.exec(s)
    if (!m) continue
    // 「我去沙发上躺一会儿」是**他**要躺。她要真去了，椅子上就只剩他自己。
    // 只有"你去/去/一起"这种才算派给她。
    if (subjectOf(s, m.index) === 'me') continue
    return { key, plan: p.plan, label: p.label, said: m[0] }
  }
  return null
}

// 接管窗口：她这一趟大概会离开多久。
// 这个数字**不决定**演出时长——时长是游戏自己的（GoSofa 的 _stayMaxSeconds + 轮转）。
// 它只是"这段时间别往队列里塞动作"的锁；短了她自己还在沙发上、seatGuard 会兜住，
// 长了下一句会被无谓地空转，所以按经验给 3~5 分钟。
export const AWAY_MIN_MS = 3 * 60 * 1000
export const AWAY_MAX_MS = 5 * 60 * 1000

export function awayMs(random = Math.random) {
  const r = Math.min(0.999, Math.max(0, Number(random()) || 0))
  return Math.round(AWAY_MIN_MS + (AWAY_MAX_MS - AWAY_MIN_MS) * r)
}

// 两趟离座之间的冷却：3~5 分钟。
// 游戏自己的节奏是 NextActionSelector 的 WildMotionDelayMinutes=30 / 概率 25，
// 那套是它自己的自动行为；这里是"用户一句话让她起来"，太频繁就不像话。
export const COOLDOWN_MIN_MS = 3 * 60 * 1000
export const COOLDOWN_MAX_MS = 5 * 60 * 1000

export function cooldownMs(random = Math.random) {
  const r = Math.min(0.999, Math.max(0, Number(random()) || 0))
  return Math.round(COOLDOWN_MIN_MS + (COOLDOWN_MAX_MS - COOLDOWN_MIN_MS) * r)
}

// 接管窗口：从这一句说完开始算。
export function awayWindow(trip, startedAt = Date.now(), random = Math.random) {
  if (!trip) return null
  const span = awayMs(random)
  return {
    plan: trip.plan,
    label: trip.label,
    from: startedAt,
    until: startedAt + span,
    spanMs: span
  }
}
