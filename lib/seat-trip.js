// 离座长途：有些事必须离开椅子才能做（去拿杯子、去沙发躺一下）。
// 这不是"插入一个动作"，而是**接管一段时间**：起身 → 走开 → 做那件事 → 回来坐下。
// 接管期间她不在椅子上，所以这段时间里的对话一律不安排表演（只出字幕与语音）。
//
// 与核心动作（core-action.js）的分工：
//   核心动作 = 坐着能做完的一件事，落地在椅子上，随时可以还回去；
//   离座长途 = 一个时间段，有明确的开始（起身）与结束（坐下），中途不能被打断。
//
// 只在"真有必要"时才启动——每次启动都是十几到三十秒的接管，启动前要看队列空、
// 冷却时间够、且不在专注模式。
import { durationOf, segsOf } from './game-grammar.js'

// 每个行程：怎么说 → 用哪几段。段必须按"出去的东西 → 在那做的事 → 回来的路"排。
export const TRIPS = {
  cup: {
    label: '去拿杯子',
    re: /拿个杯子|拿杯子|倒杯水|去倒水|倒水去|去拿水|杯子没|杯子忘/,
    steps: ['anim_wild_leavechair_cup_go', 'anim_wild_leavechair_cup_comeback']
  },
  snack: {
    label: '去拿零食',
    re: /拿点吃的|拿点零食|去拿饼干|薯片|零食/,
    steps: ['anim_wild_leavechair_normal_go', 'anim_wild_leavechair_cookie_comeback']
  },
  bread: {
    label: '去拿面包',
    re: /面包|去拿点吃的垫/,
    steps: ['anim_wild_leavechair_normal_go', 'anim_wild_leavechair_bread_A_comeback']
  },
  cupcake: {
    label: '去拿蛋糕',
    re: /纸杯蛋糕|拿蛋糕|吃蛋糕/,
    steps: ['anim_wild_leavechair_normal_go', 'anim_wild_leavechair_cupcake_comeback']
  },
  sofa: {
    label: '去沙发躺一下',
    re: /沙发|躺一会|躺一下|去躺|躺会儿|歪一会/,
    steps: ['anim_wild_leavechair_sofa_go', 'anim_wild_leavechair_sofa_deepthink', 'anim_wild_leavechair_sofa_comeback']
  },
  walk: {
    label: '出去走一下',
    re: /出去一下|走开一下|站一会|去窗边|接个电话/,
    steps: ['anim_wild_leavechair_normal_go', 'anim_wild_leavechair_normal_comeback']
  }
}

// 每段多长：单段族就是它自己，多段族按 start+loop+end 累加（循环按 1 次算）。
export function stepMs(id) {
  const segs = segsOf(id)
  let ms = 0
  for (const s of segs) ms += Number(durationOf(String(id) + '_' + s)) || 0
  if (ms > 0) return ms
  return Number(durationOf(String(id))) || 0
}

// 这句话是不是要她离开椅子。返回行程对象（含排好的时间轴）或 null。
export function decideTrip(text) {
  const s = String(text || '')
  for (const key of Object.keys(TRIPS)) {
    const t = TRIPS[key]
    const m = t.re.exec(s)
    if (!m) continue
    const plan = tripPlan(key)
    if (!plan) continue
    return { key, said: m[0], ...plan }
  }
  return null
}

// 排时间轴：一趟行程是有先后的，不能并行。
export function tripPlan(key) {
  const t = TRIPS[key]
  if (!t) return null
  const steps = []
  let cursor = 0
  for (const id of t.steps) {
    const ms = stepMs(id)
    if (!ms) continue
    steps.push({ slot: 'animations', id, trip: true, role: 'trip', locked: true, at: cursor, spanMs: ms })
    cursor += ms
  }
  if (!steps.length) return null
  return { label: t.label, steps, totalMs: cursor }
}

// 接管窗口：从第一段开始到最后一段结束，末尾留一点"走回来的余地"，
// 免得她刚坐下就被下一句拽起来。
export const AWAY_TAIL_MS = 2500

export function awayWindow(plan, startedAt = Date.now()) {
  if (!plan) return null
  return { from: startedAt, until: startedAt + plan.totalMs + AWAY_TAIL_MS, trip: plan.label }
}
// 两趟离座之间的冷却：3~5 分钟。
// 为什么不是固定值：她是人，不是地铁——每次差几十秒才不像"定时离席"。
// 为什么不是更长：一句话里提一句"沙发"，隔三五分钟再想起来是自然的；
// 隔 25 分钟就变成"这句话她一直没接"。
export const COOLDOWN_MIN_MS = 3 * 60 * 1000
export const COOLDOWN_MAX_MS = 5 * 60 * 1000

export function cooldownMs(random = Math.random) {
  const r = Math.min(0.999, Math.max(0, Number(random()) || 0))
  return Math.round(COOLDOWN_MIN_MS + (COOLDOWN_MAX_MS - COOLDOWN_MIN_MS) * r)
}