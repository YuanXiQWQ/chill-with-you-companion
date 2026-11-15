/**
 * dsh-chill-with-you-companion 纯逻辑层：无 IO、无 ctx，可被单测直接 import。
 * 这里是"后端说了算"的全部规则：情绪白名单、输出解析、长度与语种护栏、状态机。
 */
import { createHash } from 'node:crypto'

/** AIChat（现成表演端）只认这 8 个标签。 */
export const BASE_EMOTIONS = ['Happy', 'Confused', 'Sad', 'Fun', 'Agree', 'Drink', 'Wave', 'Think']

/**
 * 自研表演端可用的扩展集。
 *
 * 2026-11-13 重排：原来的 19 个里有近一半（Greeting/Understand/Working/Idle…）
 * 是"状态"而不是"情绪"，模型选了也不会让人物表情变活。现在按游戏里真实存在的
 * 子动作重排——每一条都能对应 assets.json 里一条真 clip（352 条动画校验过）。
 */
export const EXTENDED_EMOTIONS = [
  ...BASE_EMOTIONS,
  'Shy',         // 害羞：被夸、被看穿
  'Guts',        // 打气：给自己或对方加油
  'Frustration', // 沮丧：稿子写不动、被打击
  'Laugh',       // 笑出来：真的好笑
  'Tired',       // 疲惫：熬夜、撑不住
  'Surprise',    // 惊讶：被打断、听到意外的事
  'Cheer',       // 欢呼：成功、达成
  'Excited',     // 兴奋：聊到喜欢的东西
  'Relaxed',     // 放松：休息、喝茶
  'Curious',     // 好奇：追问细节
  'Sleepy',      // 困：深夜、打哈欠
  'Angry',       // 生气：真的被惹到（少见）
  'Disagree',    // 反驳：不同意、嘴硬
  'Deep',        // 沉下去：认真想事情
  'Fidget',      // 坐立不安：等你回答、心虚
]

/** 情绪中文注解：拼进提示词帮模型选准（只影响提示，不参与解析）。 */
export const EMOTION_HINTS = Object.freeze({
  Happy: '开心', Confused: '困惑', Sad: '低落', Fun: '玩笑', Agree: '同意', Drink: '喝一口', Wave: '招呼',
  Think: '思考', Shy: '害羞', Guts: '打气', Frustration: '沮丧', Laugh: '笑出声', Tired: '疲惫',
  Surprise: '惊讶', Cheer: '欢呼', Excited: '兴奋', Relaxed: '放松', Curious: '好奇', Sleepy: '困',
  Angry: '生气', Disagree: '反驳', Deep: '沉思', Fidget: '坐立不安',
})

/**
 * 情绪分档，决定"这一轮要不要动手"：
 *   strong——情绪够强，几乎必配一个动作（灵动感来源）
 *   soft——轻轻带一下，按概率
 *   still——情绪本来是"收着"的，动手反而假
 */
export const EMOTION_TIERS = Object.freeze({
  strong: ['Joy', 'Fun', 'Guts', 'Laugh', 'Cheer', 'Surprise', 'Shy', 'Frustration', 'Angry', 'Excited', 'Wave', 'Happy'],
  soft: ['Agree', 'Think', 'Deep', 'Tired', 'Curious', 'Fidget', 'Disagree', 'Confused', 'Sleepy', 'Relaxed'],
  still: ['Sad', 'Drink', 'Idle'],
})

/** 情绪 → 档位；未知情绪按 soft（宁可轻动，也不要僵着）。 */
export function emotionTier(emotion) {
  const e = String(emotion || '')
  if (EMOTION_TIERS.strong.includes(e)) return 'strong'
  if (EMOTION_TIERS.still.includes(e)) return 'still'
  return 'soft'
}

export const PHASES = ['idle', 'focus', 'break']

/** 她说来说去最容易撞车的几个母题。命中就记一次，连着说不换就提示。 */
export const MOTIFS = Object.freeze({
  eyes: { re: /眼睛|撑不住|发干|糊了|干了|看屏幕/, label: '眼睛累' },
  report: { re: /报告|第二页|第二节/, label: '报告进度' },
  novel: { re: /第三章|小说|稿子|下一章|写不下去/, label: '小说进度' },
  exam: { re: /考试|实训|教授|老师|父母/, label: '学业压力' },
  coffee: { re: /咖啡|喝茶|倒了一杯/, label: '喝东西' },
})

export const DEFAULT_STATE = Object.freeze({
  phase: 'idle',
  since: 0,
  focusCount: 0,
  breakCount: 0,
  energy: 78,
  affection: 10,
  // 心情：外部连续状态，带二阶动量。见 Subaharan 2026 —— 逐轮独立采样情绪会让人格漂，
  // 状态持续才有连贯轨迹和「恢复」；加动量就有惯性+迟滞
  //（好消息不会立刻让她振奋，坏心情也不会一句话就好）。
  mood: 60,
  moodVel: 0,
  turnCount: 0,
  lastEventAt: 0,
  // 时间感：上次真说话是什么时候、那轮在聊什么。只在轮次结束时更新，
  // 这样本轮组装 prompt 时读到的还是"上一次"的值，不会当场变成 0。
  lastTalkAt: 0,
  lastTopic: '',
  // 最近演过的动作（基名，去掉 _start/_loop/_end）：她老用同一个姿势会显得僵，
  // 比如连着几轮都是 sub_fun，看起来就是一直在点头。组装 prompt 时列给模型看。
  recentActions: Object.freeze([]),
  // 母题疲劳：她翻来覆去就那几件事——眼睛干、报告卡在第几页、稿子卡在第几章。
  // 记最近 6 轮各落在哪些母题上，同一件事占到 3 轮就在 prompt 里点名换掉。
  // 用窗口而不是连续计数：她往往隔一轮就绕回来，连续阈值永远碰不到。
  motifWindow: Object.freeze([]),
  // 最近几轮她实际说出的话。模型看不到自己的历史就必然重复，
  // 直接把原话列给它，比任何"别重复"的抽象指令都管用。
  recentSubs: Object.freeze([]),
  // 番茄钟实况：由游戏心跳里的 focus / timer 推导，不依赖游戏主动发事件
  pomo: Object.freeze({
    running: false,   // 倒计时真的在跑
    panelOpen: false, // 只是把番茄钟界面打开了，没在计时
    remainMs: 0,      // 剩余时间（拿不到 timer 文本时为 0）
    totalMs: 0,       // 本轮观察到的最大剩余，用来估总长
    startedAt: 0,     // 本轮开始时间
    lastBeatAt: 0,
  }),
})

/**
 * 情绪 → 游戏 AnimationType id。
 * 全部取自游戏程序集真实枚举 `Bulbul.HeroineService.AnimationType`（下面注释是枚举名）。
 */
// 这些 id 是「运行时真实 clip 名」，由表演端把 Character 动画器的 clip 列表
// dump 成 BepInEx\chill-clips.txt 后回填（DLL 里的类型名并不能直接播放）。
export const DEFAULT_ACTION_MAP = Object.freeze({
  // 开心/好笑都没有 story 组的三段式，只有 break_movie_sub_laugh 这一组带
  // 进入/保持/退出。它是 _sub 上半身叠加动作，跟场景不打架，撑满长句比单段好看。
  Happy: 'anim_break_movie_sub_laugh_start',
  // 沮丧是**状态**不是瞬时反应：用三段式的垂肩，能跟着整句话撑着；
  // sub_sad 只有 1900ms，二十个字念四五秒，她演完就僵在那儿了。
  Sad: 'anim_story_base001_sub_dropshoulders_start',
  Fun: 'anim_break_movie_sub_laugh_start',
  // 点头本来就该短促，说完就完，不需要撑满
  Agree: 'anim_story_base001_sub_nod',
  Confused: 'anim_story_base001_sub_thinking1_start',
  Think: 'anim_work_pc_sub_thinking_start',
  Drink: 'anim_break_yawn_1_start',
  Wave: 'anim_story_subbase001_sub_joy',
})

/**
 * 扩展情绪 → 真实动作 id（表演端支持扩展集时才用）。
 * 每个 id 都在 assets.json 的 352 条动画里校验过，且优先选"情绪签名"清楚的子动作：
 * 疲惫用 anim_wild_tired 而不是打哈欠，欢呼用 anim_wild_cheer 而不是 joy，
 * 这样同一句话在不同情绪下真的会做出不同的动作。
 */
export const EXTENDED_ACTION_MAP = Object.freeze({
  ...DEFAULT_ACTION_MAP,
  Joy: 'anim_story_subbase001_sub_joy',
  Guts: 'anim_story_subbase001_sub_guts',
  Shy: 'anim_story_base001_sub_shy_start',
  Frustration: 'anim_story_base001_sub_frustration2_start',
  Laugh: 'anim_break_movie_sub_laugh_start',
  // wild_tired 是全身瘫下去那类动作（7000ms、scope=full），会把她的坐姿整个重摆；
  // 她绝大部分时间在工位说话，疲惫用上半身的垂肩才对。
  Tired: 'anim_story_base001_sub_dropshoulders_start',
  Surprise: 'anim_story_subbase001_sub_fun',
  Cheer: 'anim_wild_cheer',
  Excited: 'anim_wild_guts',
  Relaxed: 'anim_break_tea_sub_drink',
  Curious: 'anim_story_base001_sub_thinking1_start',
  Sleepy: 'anim_break_yawn_1_start',
  Angry: 'anim_story_base001_sub_frustration2_start',
  Disagree: 'anim_story_base001_sub_shakehead',
  Deep: 'anim_story_base001_sub_deep_start',
  Fidget: 'anim_wild_fidget',
  // 旧标签保留映射：老配置或老客户端仍可能发它们
  Greeting: 'anim_story_base001_sub_nod',
  Working: 'anim_work_pc_base_loop',
  Understand: 'anim_story_base001_sub_nod',
  Nervous: 'anim_story_base001_sub_shy_start',
  Idle: 'anim_story_base001_base',
})

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

export function emotionsOf(emotionSet) {
  return emotionSet === 'extended' ? EXTENDED_EMOTIONS : BASE_EMOTIONS
}

/**
 * 状态机：所有事件只改状态，不产生文本（文本由模型产出、由本层裁剪）。
 * 事件由表演端上报（focus_start / focus_end / break / idle / ping），也可以由前台 UI 手动触发。
 */
/**
 * 二阶情绪动力学（Subaharan 2026 的简化版，VAD 三维砍到一维）。
 * 目标值由当下在干什么决定；速度项负责惯性——今天一直在 55，突然该到 76 也不会一步到位，
 * 要几轮爬上去，反过来降也一样。这就是「状态持续」和「逐轮独立采样」的区别。
 */
export function stepMood(s) {
  const target = s.phase === 'break' ? 76 : s.phase === 'focus' ? 52 : 62
  const prev = Number.isFinite(s.mood) ? s.mood : 60
  const vel = Number.isFinite(s.moodVel) ? s.moodVel : 0
  const nextVel = 0.62 * vel + 0.38 * (target - prev) * 0.3
  return clamp(prev + nextVel, -100, 100)
}

export function applyEvent(state, event, now = Date.now()) {
  const s = { ...DEFAULT_STATE, ...(state || {}) }
  const type = String(event?.type || '').trim()
  s.lastEventAt = now

  if (type === 'focus_start') {
    s.phase = 'focus'
    s.since = now
  } else if (type === 'focus_end') {
    const mins = s.phase === 'focus' && Number.isFinite(s.since) && now >= s.since ? (now - s.since) / 60000 : 0
    s.phase = 'idle'
    s.since = now
    s.focusCount += 1
    s.energy = clamp(s.energy - Math.round(mins / 8), 0, 100) // 专注越久越累
    s.affection = clamp(s.affection + 1, 0, 100)
  } else if (type === 'break') {
    s.phase = 'break'
    s.since = now
    s.breakCount += 1
    s.energy = clamp(s.energy + 8, 0, 100)
  } else if (type === 'idle') {
    s.phase = 'idle'
    s.since = now
  }
  // 'ping' 与其他未知事件只刷新时间戳
  s.mood = stepMood(s)
  return s
}

/** 把 "24:59" / "1:05:00" / "25：00" 解析成毫秒；解析不出给 null。 */
export function parseClock(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const m = raw.match(/(\d{1,3})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?/)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  const c = m[3] === undefined ? null : Number(m[3])
  const seconds = c === null ? a * 60 + b : a * 3600 + b * 60 + c
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds * 1000
}

const POMO_DONE_WITHIN_MS = 90 * 1000   // 剩余时间落到这个范围后就没了 → 判定"跑完了"
const POMO_MIN_REAL_MS = 3 * 60 * 1000  // 少于 3 分钟不算一个番茄钟

/**
 * 用游戏心跳（focus / timer）推进番茄钟状态，返回 { state, events }。
 * 事件沿用 applyEvent 的那几种，所以下游只认 phase 就够了。
 */
export function applyHeartbeat(state, beat, now = Date.now()) {
  const s = { ...DEFAULT_STATE, ...(state || {}) }
  const prev = { ...DEFAULT_STATE.pomo, ...(s.pomo || {}) }
  const events = []

  const focusFlag = Boolean(beat && beat.focus)
  const remainMs = parseClock(beat && beat.timer)
  const running = focusFlag && remainMs !== null
  const panelOpen = focusFlag && remainMs === null

  const next = {
    running,
    panelOpen,
    remainMs: remainMs === null ? 0 : remainMs,
    totalMs: prev.totalMs,
    startedAt: prev.startedAt,
    lastBeatAt: now,
  }

  // 开始计时
  if (running && !prev.running) {
    next.startedAt = now
    next.totalMs = remainMs
    s.phase = 'focus'
    s.since = now
    events.push({ type: 'focus_start', remainMs })
  } else if (running) {
    // 正在进行：记住本轮见过的最长剩余，用来估总长
    if (remainMs > next.totalMs) next.totalMs = remainMs
    if (s.phase !== 'focus') {
      s.phase = 'focus'
      s.since = next.startedAt || prev.lastBeatAt || now
    }
  }

  // 计时停了（跑完 / 手动停 / 关掉界面）
  if (!running && prev.running) {
    const elapsed = next.startedAt ? Math.max(0, now - next.startedAt) : 0
    const finished = prev.remainMs > 0 && prev.remainMs <= POMO_DONE_WITHIN_MS
    if (finished) {
      s.phase = 'break'
      s.since = now
      s.breakCount += 1
      s.focusCount += 1
      s.energy = clamp(s.energy - Math.round(elapsed / 60000 / 8) + 8, 0, 100)
      s.affection = clamp(s.affection + 1, 0, 100)
      events.push({ type: 'break', minutes: Math.round(elapsed / 60000) })
    } else if (elapsed >= POMO_MIN_REAL_MS) {
      s.phase = 'idle'
      s.since = now
      s.focusCount += 1
      s.energy = clamp(s.energy - Math.round(elapsed / 60000 / 8), 0, 100)
      s.affection = clamp(s.affection + 1, 0, 100)
      events.push({ type: 'focus_end', minutes: Math.round(elapsed / 60000), stoppedEarly: true, remainMs: prev.remainMs })
    } else {
      s.phase = 'idle'
      s.since = now
      events.push({ type: 'focus_end', minutes: Math.round(elapsed / 60000), aborted: true, remainMs: prev.remainMs })
    }
    next.startedAt = 0
    next.totalMs = 0
  }

  // 休息结束：又开了新的一轮，说明上一段休息过去了
  if (s.phase === 'break' && (running || now - s.since > 20 * 60000)) {
    if (now - s.since > 20 * 60000 && !running) {
      s.phase = 'idle'
      s.since = now
    }
  }

  s.pomo = next
  s.lastEventAt = now
  return { state: s, events }
}

/** 把状态翻译成一句"给模型看的处境"，比让模型自己猜要稳。 */
/**
 * 把「几天前」说成人话。72 小时前不是人话，三天前才是。
 * 一天内按小时，一周内按天，再往上按周/月，半年以外就不给具体数了。
 */
export function humanGap(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const min = Math.round(ms / 60000)
  if (min < 2) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.round(min / 60)
  if (hour < 6) return `${hour} 个小时前`
  if (hour < 20) return '今天早些时候'
  const day = Math.round(ms / 86400000)
  if (day <= 1) return '昨天'
  if (day === 2) return '前天'
  if (day < 7) return `${day} 天前`
  if (day < 14) return '上周'
  if (day < 40) return `${Math.round(day / 7)} 周前`
  if (day < 200) return `${Math.round(day / 30)} 个月前`
  return '很久以前'
}

/** 今天几号、星期几、现在几点。她得知道现在是什么时候，不然永远活在"此刻"。 */
export function todayLine(now = Date.now()) {
  const d = new Date(now)
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  const hh = d.getHours()
  // 13:42 是下午一点多，不是中午。中午只到 13 点。
  const part = hh < 5 ? '凌晨' : hh < 9 ? '早上' : hh < 12 ? '上午'
    : hh < 13 ? '中午' : hh < 18 ? '下午' : hh < 23 ? '晚上' : '深夜'
  const clock = `${String(hh).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `今天是 ${d.getMonth() + 1} 月 ${d.getDate()} 日${wd}，${part} ${clock}。`
}

/**
 * 这个点身体是什么感觉。
 *
 * 只给"下午 13:42"这种客观时间，模型会算，但它算得很保守——一律不主动提。
 * 直接告诉它此刻的身体感受，她才会有"一点半你还没吃饭吧"这种反应。
 */
export function timeFeel(now = Date.now()) {
  const hh = new Date(now).getHours()
  if (hh < 5) return '这个点我早就该睡了。'
  if (hh < 8) return '刚醒没多久，还没完全开机。'
  if (hh < 11) return '上午，精神最好的时候。'
  if (hh < 13) return '到饭点了，有点饿。'
  if (hh < 15) return '午后这段时间过得慢。'
  if (hh < 18) return '下午过半，光线开始变斜。'
  if (hh < 20) return '天黑了，有点想收工。'
  if (hh < 23) return '晚上，安静的时段，写东西最顺。'
  return '夜已经很深了。'
}

export function describeState(state, now = Date.now(), windowView = '') {
  const s = { ...DEFAULT_STATE, ...(state || {}) }
  const pomo = { ...DEFAULT_STATE.pomo, ...(s.pomo || {}) }
  const mins = Number.isFinite(s.since) && now >= s.since ? Math.round((now - s.since) / 60000) : 0
  let phaseText
  if (pomo.running) {
    const remainMin = Math.max(1, Math.round(pomo.remainMs / 60000))
    const totalMin = pomo.totalMs > 0 ? Math.max(remainMin, Math.round(pomo.totalMs / 60000)) : 0
    phaseText = totalMin > 0
      ? `他那边番茄钟在跑，还剩 ${remainMin} 分钟（这一轮共 ${totalMin} 分钟），已经专注 ${mins} 分钟`
      : `他那边番茄钟在跑，还剩 ${remainMin} 分钟，已经专注 ${mins} 分钟`
  } else if (s.phase === 'break') {
    phaseText = mins > 0 && mins < 240 ? `他刚跑完一个番茄钟，正在休息，休息了 ${mins} 分钟` : '他刚跑完一个番茄钟，在休息'
  } else if (s.phase === 'focus') {
    phaseText = `他的番茄钟开着，但计时没在走（已专注 ${mins} 分钟）`
  } else if (pomo.panelOpen) {
    phaseText = '他把番茄钟界面打开了，还没开始计时'
  } else {
    phaseText = mins > 0 && mins < 240 ? `我们都没在计时，上次互动 ${mins} 分钟前` : '我们都没在计时'
  }
  // 边界改成 >=：默认 78 与阈值 70 错开，不再每轮都卡在"我有点累了"上
  const energyText = s.energy >= 70 ? '我精神还不错' : s.energy >= 40 ? '我有点累了' : '我快撑不住了'
  // 心情和体力分开说：累但心情好、闲但闷得慌，都是常见的
  const moodText = s.mood > 70 ? '心情挺松的' : s.mood > 40 ? '心情平平' : s.mood > 10 ? '心里有点闷' : '情绪不太好'
  const affectionText = s.affection >= 60 ? '我跟你已经很熟了' : s.affection >= 25 ? '我们算熟人了' : '我们还在互相试探'

  // 时间感：她得知道现在是哪天、上次见面是什么时候、那次聊到哪里
  const stamp = [todayLine(now), timeFeel(now)]
  // 窗外：游戏里真正显示的那个景。她自己看得见，说出来才不会和画面打架。
  const viewHint = { Day: '窗外是白天', Sunset: '窗外正黄昏', Night: '窗外已经黑了', Cloudy: '窗外是阴天' }[windowView]
  if (viewHint) stamp.push('（' + viewHint + '。）')
  // 最近用过的动作：摊给模型看，它才知道该换一个
  const recent = Array.isArray(s.recentActions) ? s.recentActions.slice(-5) : []
  if (recent.length >= 2) {
    stamp.push(`最近几轮演过这些动作：${recent.map((x) => String(x).replace(/^anim_/, '')).join('、')}。换一个，别连着重复同一个姿势。`)
  }

  // 母题反复：最近几轮老在同一件事上打转，点名让她换
  const win = Array.isArray(s.motifWindow) ? s.motifWindow : []
  const counts = {}
  for (const set of win) for (const k of Array.isArray(set) ? set : []) counts[k] = (counts[k] || 0) + 1
  const hot = Object.keys(counts)
    .filter((k) => MOTIFS[k] && counts[k] >= 3)
    .sort((a, b) => counts[b] - counts[a])
    .map((k) => MOTIFS[k].label)
  if (hot.length > 0) {
    stamp.push('「' + hot.join('」「') + '」最近几轮你说得太多了，这轮一定换件事，别再提。')
  }
  // 原话摆出来，别让她换个说法讲同一件事
  const said = Array.isArray(s.recentSubs) ? s.recentSubs.filter(Boolean).slice(-4) : []
  if (said.length >= 2) {
    stamp.push('你刚才说过 ' + said.map((x) => '「' + String(x).slice(0, 22) + '」').join('') + '，别再说类似的，换个说法或换件事。')
  }

  const gap = Number.isFinite(s.lastTalkAt) && s.lastTalkAt > 0 ? now - s.lastTalkAt : NaN
  const gapText = humanGap(gap)
  if (gapText && gap > 8 * 3600000) {
    // 隔了半天以上才值得提一句。十分钟前刚聊过，"你十分钟前来过"很奇怪。
    stamp.push(`上次说话是 ${gapText}。`)
    if (s.lastTopic) stamp.push(`那次在聊：${s.lastTopic}。`)
  }
  return `${stamp.join('')}${phaseText}；${energyText}，${moodText}；${affectionText}；今天已完成 ${s.focusCount} 个番茄钟。`
}

/** 组装发给 DeepSeek 的 messages。system 里必须出现 "json" 字样与示例（DeepSeek JSON 模式的硬要求）。 */
export function buildMessages({ persona, memory = [], state, userText, emotionSet = 'base8', assetBrief = '', factsText = '', nearbyText = '', loreText = '', kbText = '', summaryText = '', skills = '', mode = 'work', now = Date.now(), actionMap = null, windowView = '' }) {
  const emotions = emotionsOf(emotionSet)
  const contract = [
    '# 输出契约（必须严格遵守）',
    '只输出一个 json 对象，字段为 emotion / voice_text / subtitle_text / performance。',
    `emotion 只能取以下之一（括号是它的意思）：${emotions.map((e) => (EMOTION_HINTS[e] ? `${e}(${EMOTION_HINTS[e]})` : e)).join('、')}。`,
    '按这一句真正的心情选，不要每轮都用 Happy：被夸或被看穿用 Shy，稿子写不动用 Frustration，真的笑出来用 Laugh，撑不住用 Tired，聊到喜欢的东西用 Excited，给自己或对方打气用 Guts，不同意就用 Disagree。',
    '同一段对话里情绪要跟着话题变；连续两轮用同一个 emotion 只有在情绪确实没变时才允许。',
    'voice_text 是念出来的台词，subtitle_text 是屏幕字幕；两句必须是同一次说话的内容。',
    'voice_kana 可选：voice_text 的假名读法（汉字全部写成平假名）。不写或写空都不影响口型，省 token 就干脆省略这个键。',
    'voice_text 必须是日语：可以带汉字，但整句要用日语语序，禁止写成中文句子（写成中文就没有声音了）。',
    'subtitle_text 用中文，和 voice_text 是同一次说话的内容。',
    '先直接接住他这句话的具体内容：他问什么就先回答那个问题，他说什么事就先回应那件事，然后再补一点自己的感受。',
    '禁止用「嗯」「谢谢」「我这边……」这类和话题无关的客套话搪塞过去。',
    'performance 是画面指令，不是装饰：按这一句「说完的过程」编，让她说话时有身体反应。',
    // slot 几乎永远是 animations，why 只是给人看的备注——两者都在输出 token 里白花钱。
    // 解析器对缺 slot 默认 animation，缺 why 就是空字符串。
    '每条只写 {"id":"<清单里的 id>","at":<0 到 1 之间的小数>} 两个字段，不要写 slot 和 why。',
    '只有用到椅子或音效时，才在那一处加 "slot":"chairs" 或 "slot":"sfx"。',
    'at 一律用 0 到 1 之间的小数，表示「这句话说到几成」：0 是刚开口，0.45 是说到四成半，0.9 是快说完。',
    '**不要写毫秒**。你没法知道这句话念出来有多长，写 4000 这种数一定会落到她已经说完之后，看起来像延迟抽搐。',
    '默认只给一条，at 写 0——开口那一下的姿态，整句话保持这个姿态说完就够了。',
    '只有这句念出来超过 20 个字，才追加第二条，at 写 0.55 左右，表示说到一半换了个反应。',
    '**不要每句话都塞两个动作**。真人在一句话里不会隔一两秒换一个姿势，那看起来像抽搐。',
    '至少给一条，**永远不要给空数组**。她不说话以外的每一句都要有身体反应，空数组等于这一句她是死的。',
    '动作先分类，再选：g=手势（反应类：点头/摇头/思考/笑/害羞/垂肩） p=道具（喝/吃/写/敲键盘/翻书/看电脑） P=姿态（起身/躺下/伸懒腰/打哈欠） l=位移（走/离座/过去） i=待机循环。',
    '类别必须和这句话的内容一致，这是硬要求：',
    '  说到正在喝/吃/写/敲/看书/看电脑 → 只能选 p；说到累/困/伸懒腰/站起来 → 只能选 P；',
    '  说到要走/过去/离开椅子 → 只能选 l；其余反应（认同、思考、害羞、笑、难过）→ 选 g。',
    '拿不准就用 g。用 p 或 P 装样子（没在喝却说在喝、没起身却躺下）比只点头更假。',
    'i 类只在真的要「保持某个状态一会儿」时用，不拿来当反应。',
    '按这句话在做什么选动作，不要只按心情套：',
    '  问回去 → 偏头或思考；被看穿、被夸 → 移开视线或低头；认同 → 点头；',
    '  讲到喜欢的东西 → 招手或前倾；撑不住 → 垂肩或叹气；认真讲做法 → 坐直。',
    '至少给一条。就算这句话只是附和（「うん」这种一个词）也要给，禁止写 []。',
    '清单里标注 full 的动作是三段式（进入 / 保持 / 退出），能撑满整句话，**优先选它**。',
    '标注 1.5s / 2.0s 这种是单段表情，一两秒就演完，只在这句话很短的时候才用——用在长句上，她演完就僵在那儿不动了。',
    'performance 只能用下面清单里出现过的 id，一个都不许编；id 必须原样照抄，大小写和下标都不能改。',
    '不要输出 markdown、代码块、编号、括号动作描写，也不要一次给多个候选。',
    // 这三个键只在真有内容时才写。空数组本身也要占输出 token（输出是最贵的），
    // 而解析器对缺键完全容忍，写 [] 纯属浪费。
    'remember / moments / open 是三个可选数组，**没有内容就整个省略这个键，不要写 []**。',
    'remember：这轮值得长期记住的事（他的偏好、约定、生活细节、你们的梗）。每条≤24 字，只写事实，最多 3 条。',
    'moments：你们之间真正发生过的一刻，格式 [{"text":"...","weight":1-10}]，≤30 字，最多 2 条；三个月后想起来还有感觉的才写。',
    'open：他提过但还没说完或没结果的事，≤24 字，最多 2 条；已经解决的不写。',
    '三个都没有就一个键都别写，让对象只有前面那几个字段。',
    '示例：{"emotion":"Agree","voice_text":"うん、私もこの段落、書き終えるね。","subtitle_text":"嗯，我也把这段写完。","performance":[{"id":"anim_story_subbase001_sub_joy","at":0}]}',
  ]
  const system = [
    persona.trim(),
    '',
    ...(loreText
      ? ['# 她的设定（角色背景：经历、好恶、说话方式的来处）', loreText, '']
      : []),
    ...(skills
      ? [
          '# 你已经掌握的领域',
          '下面这些是你学过、练过的东西，属于你自己的一部分：聊到就当本来就懂，直接给判断和做法。',
          '不要说「根据资料」「知识库里写着」「我查一下」这类话，也不要整段背条文；像行家那样把要点讲成自己的话。',
          skills,
          '',
        ]
      : []),
    ...(mode === 'work'
      ? [
          '# 现在的状态：工作上要能顶住',
          '他可能正卡在具体事情上。先接住问题本身：给判断、给能照做的步骤、给现成的写法或数字；',
          '再补半句自己的口气就够了。别用「你辛苦了」这类话占位置，也别把三句话能说完的事展开成一段。',
          '不确定的地方直说不确定，别编。',
          '',
        ]
      : []),
    ...(factsText ? ['', '# 你记得的事（长期记忆，自然带出来，不要逐条复述）', factsText] : []),
    ...(kbText
      ? ['', '# 你手边查到的资料（不是记忆，是外部资料；说到相关的事就直接讲出来）', kbText]
      : []),
    ...(summaryText ? ['', '# 你们之前的相处（摘要）', summaryText] : []),
    ...(assetBrief
      ? [
          '',
          '# 可用的游戏自带资源（performance 只能从这里选，id 必须原样照抄）',
          assetBrief,
        ]
      : []),
    // 只给清单不够：55 个动作里它总挑最保守的 nod，于是什么情绪都只点头。
    // 把「情绪 → 已经校验过的动作」这张表摊开，让它有默认答案，而不是每次现猜。
    ...(actionMap && emotions.some((e) => actionMap[e])
      ? [
          '',
          '# 情绪对应的动作（首选这一列，别自己从清单里另挑）',
          emotions
            .filter((e) => actionMap[e])
            .map((e) => `${e} → ${actionMap[e]}`)
            .join('\n'),
          'Emotion 是 Shy 就做 shy 那个动作，不要一律点头。转折处想换动作时，再从上面的 anim 清单里挑一个语义对得上的。',
        ]
      : []),
    // 完整契约放在稳定区，末尾只留六行摘要。
    // 契约本身每轮一模一样，跟着动态块一起失效太浪费——它占了 1900 字。
    ...contract,
    '',
    // 动态块压到最后：DeepSeek 的 prefix cache 从前往后匹配，
    // 这两个每轮都变，放在前面会让后面所有稳定内容（尤其 3200 字符的 assetBrief）全部失效。
    '# 当前处境（由系统提供，不要复述）',
    describeState(state, now, windowView),
    ...(nearbyText
      ? [
          '',
          '# 你刚才抬眼看到的（屏幕上的实况，不是他跟你说的）',
          nearbyText,
          '这是他那边真在发生的事，你就是知道。他问起来、或者你想搭一句，就按这个说——',
          '别答"我看不到""你自己屏幕上的不记得了"，那等于承认你刚才什么都没看。也别逐条念，挑一件说。',
        ]
      : []),
    // 只剩一句。完整契约就在上面几行，中间只隔了动态状态，
    // 五行复述全按全价（未命中缓存）计费，是这轮里最贵的一段重复内容。
    '',
    '只输出 json 对象，不要 markdown 或解释。',
  ].join('\n')

  const messages = [{ role: 'system', content: system }]
  for (const m of memory) {
    if (!m || typeof m.content !== 'string' || m.content.trim() === '') continue
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })
  }
  messages.push({ role: 'user', content: String(userText ?? '').trim() || '……' })
  return messages
}

/** 从模型输出里挖出第一个 JSON 对象（容忍 ```json 围栏与前后废话）。 */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** 三段式兜底：`[Emotion] ||| 台词 ||| 字幕`。 */
export function extractLegacy(text) {
  if (typeof text !== 'string') return null
  const m = text.match(/\[([A-Za-z]+)\]\s*\|\|\|\s*([\s\S]*?)\s*\|\|\|\s*([\s\S]*)/)
  if (!m) return null
  return { emotion: m[1], voice_text: m[2].trim(), subtitle_text: m[3].trim() }
}

const KANA = /[\u3040-\u30ff]/
const CJK = /[\u4e00-\u9fff]/
const HAN_ONLY = /^[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s]*$/
const QUESTION_HINT = /[？?]|吗|呢|怎么|为什么|什么|哪个|哪里|谁|多少|是不是|能不能|会不会|要不要|有没有|推荐|建议|帮我|给我|教我|告诉我|说说|讲讲|如何|怎么样|哪个好|选哪/
const STOP_CHARS = new Set('你我的了吗呢吧啊呀嘛哦是就不在有会能要也还都很这那个什么怎为谁哪多少几他她们和跟把被给对从到说想要觉 '.split(''))

export function isQuestion(text) {
  return QUESTION_HINT.test(String(text || ''))
}

function contentChars(text) {
  const out = new Set()
  const chars = String(text || '').match(/[\u4e00-\u9fff]/g) || []
  for (const c of chars) if (!STOP_CHARS.has(c)) out.add(c)
  return out
}

/** 他问的是问题、回复却一个实词都没接上 → 判为答偏（只在问题且实词 >= 3 个时判定，避免误杀）。 */
export function topicDrift(userText, reply) {
  const u = contentChars(userText)
  const r = contentChars(reply)
  if (u.size < 3 || r.size === 0) return false
  let hit = 0
  for (const c of u) if (r.has(c)) hit += 1
  return hit === 0
}

export function topicScore(userText, reply) {
  const u = contentChars(userText)
  const r = contentChars(reply)
  let hit = 0
  for (const c of u) if (r.has(c)) hit += 1
  return hit
}

/** 截断到句子边界，别把一句话切一半。 */
export function trimSentence(text, maxChars) {
  const s = String(text || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  const limit = Number(maxChars) || 0
  if (limit <= 0 || s.length <= limit) return s
  const slice = s.slice(0, limit)
  let boundary = -1
  for (const mark of ['。', '！', '？', '!', '?', '…', '、', '，', ',', '.']) {
    const at = slice.lastIndexOf(mark)
    if (at > boundary) boundary = at
  }
  if (boundary >= Math.floor(limit * 0.5)) return slice.slice(0, boundary + 1).trim()
  return slice.trim()
}

export function parseModelOutput(raw, opts = {}) {
  const emotionSet = opts.emotionSet || 'base8'
  const emotions = emotionsOf(emotionSet)
  const fallbackEmotion = emotions.includes(opts.fallbackEmotion) ? opts.fallbackEmotion : 'Agree'
  const maxSubtitle = opts.maxSubtitle || 60
  const maxVoice = opts.maxVoice || 60
  const warnings = []

  let obj = extractJsonObject(raw)
  let mode = 'json'
  if (!obj) {
    obj = extractLegacy(raw)
    mode = obj ? 'legacy' : 'text'
  }

  let emotion
  let voiceText
  let voiceKana = ''
  let subtitleText

  if (obj) {
    emotion = String(obj.emotion ?? obj.Emotion ?? '').trim()
    voiceText = String(obj.voice_text ?? obj.voiceText ?? obj.voice ?? '').trim()
    voiceKana = String(obj.voice_kana ?? obj.voiceKana ?? '').trim()
    subtitleText = String(obj.subtitle_text ?? obj.subtitleText ?? obj.subtitle ?? '').trim()
  } else {
    const rawText = String(raw ?? '').trim()
    // 截断的 JSON（模型被 max_tokens 砍在半句）绝不能当台词：那样的"台词"是
    // {"emotion":"Sad","voice_text":"うるさいと集中で… 这种残片，字幕会变成日文乱码片段。
    const looksJson = /^[\{\[]/.test(rawText) || /"(emotion|voice_text|subtitle_text)"\s*:/.test(rawText)
    if (looksJson) {
      voiceText = ''
      subtitleText = ''
      emotion = ''
      warnings.push('model-output-truncated-json')
    } else {
      const plain = rawText.replace(/^\[[A-Za-z]+\]\s*\|*\s*/, '').trim()
      voiceText = plain
      subtitleText = plain
      emotion = ''
      warnings.push('model-output-not-structured')
    }
  }

  if (!emotions.includes(emotion)) {
    warnings.push(`emotion-not-in-whitelist:${emotion || 'empty'}`)
    emotion = fallbackEmotion
  }
  if (!subtitleText && voiceText) {
    subtitleText = voiceText
    warnings.push('subtitle-filled-from-voice')
  }
  if (!voiceText && subtitleText) {
    voiceText = subtitleText
    warnings.push('voice-filled-from-subtitle')
  }
  if (!voiceText && !subtitleText) {
    warnings.push('empty-say')
  }

  const voice = trimSentence(voiceText, maxVoice)
  const subtitle = trimSentence(subtitleText, maxSubtitle)
  if (voice !== voiceText || subtitle !== subtitleText) warnings.push('truncated')

  // 语种护栏：日语 TTS 吃到纯汉字会退化/跳过，这里提前判定，让表演端只出字幕。
  const textLang = opts.textLang || 'ja'
  let ttsSkip = false
  if (textLang === 'ja' && voice && !KANA.test(voice)) {
    ttsSkip = true
    warnings.push('voice-has-no-kana')
  }
  if (textLang === 'zh' && voice && HAN_ONLY.test(voice) === false && !CJK.test(voice)) {
    warnings.push('voice-has-no-cjk')
  }

  return {
    emotion,
    voice_text: voice,
    voice_kana: /[\u3041-\u3096\u30a1-\u30f6]/.test(voiceKana) ? voiceKana : '',
    subtitle_text: subtitle,
    performance: Array.isArray(obj?.performance) ? obj.performance : [],
    remember: Array.isArray(obj?.remember)
      ? obj.remember.filter((x) => typeof x === 'string' && x.trim().length >= 2).map((x) => x.trim()).slice(0, 3)
      : [],
    // 共同经历：不是他的属性，是你们一起发生过的事。weight 越大越值得留着。
    moments: Array.isArray(obj?.moments)
      ? obj.moments
        .map((x) => {
          if (typeof x === 'string') return { text: x.trim(), weight: 6 }
          const text = String(x?.text || '').trim()
          const w = Math.max(1, Math.min(10, Number(x?.weight) || 6))
          return { text, weight: w }
        })
        .filter((x) => x.text.length >= 2)
        .slice(0, 2)
      : [],
    // 悬着的话题：他提过但没说完。以后可以主动问。
    open: Array.isArray(obj?.open)
      ? obj.open.filter((x) => typeof x === 'string' && x.trim().length >= 2).map((x) => x.trim()).slice(0, 2)
      : [],
    mode,
    ttsSkip,
    warnings,
  }
}

/** 给 AIChat 这类只认字符串的表演端用的两种编码。 */
export function encodeForLegacyClient(result) {
  return `[${result.emotion}] ||| ${result.voice_text} ||| ${result.subtitle_text}`
}

export function encodeForJsonClient(result) {
  return JSON.stringify({
    emotion: result.emotion,
    voice_text: result.voice_text,
    subtitle_text: result.subtitle_text,
  })
}

/** 合成结果缓存键：同 text/ref/lang/速度 → 同一份 wav。 */
export function cacheKey(parts) {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 20)
}

/**
 * 表演指令：这是后端交给前端"只负责表演"的全部信息。
 * cues 是已经过资源白名单校验的表演队列（见 lib/assets.js）；
 * 没给 cues 时退回"情绪 → 单个动作"的老行为，保证向后兼容。
 */
export function buildAct(result, ctx = {}) {
  const actionMap = ctx.actionMap || DEFAULT_ACTION_MAP
  const cues = Array.isArray(ctx.cues) ? ctx.cues : null
  const performance = cues === null
    ? (() => {
        const actionId = actionMap[result.emotion]
        if (actionId === undefined || actionId === null) return []
        return [{ slot: 'animations', id: String(actionId), at: 0, durationMs: null, text: null }]
      })()
    : cues
  return {
    turnId: ctx.turnId || '',
    emotion: result.emotion,
    voice: {
      text: result.voice_text,
      lang: ctx.textLang || 'ja',
      skipTts: Boolean(result.ttsSkip),
      audioUrl: ctx.audioUrl || null,
    },
    subtitle: { text: result.subtitle_text, maxChars: 60 },
    performance,
    actions: performance
      .filter((cue) => cue.slot === 'animations')
      .map((cue) => ({
        id: Number.isFinite(Number(cue.id)) ? Number(cue.id) : cue.id,
        kind: 'animation',
        from: cues === null ? 'emotion' : 'model',
        emotion: result.emotion,
        at: cue.at ?? 0,
      })),
    state: ctx.state || null,
    meta: {
      model: ctx.model || '',
      mode: result.mode,
      warnings: result.warnings,
      droppedCues: ctx.droppedCues ?? 0,
      latencyMs: ctx.latencyMs ?? null,
      usage: ctx.usage ?? null,
    },
  }
}
