/**
 * 游戏状态监测器。
 *
 * 之前侧车对游戏状态的认知只有一条 2 秒一次的心跳：快照里 `focus` 变了就更新番茄钟，
 * 没变就什么都不知道。于是：
 *   - 她刚睡着，最坏要 2 秒后侧车才知道，这 2 秒里还在往她身上推动作；
 *   - 她切状态（去开会/躺下/进剧情），侧车完全不知道，只能按"上一次是什么"猜。
 *
 * 这个模块把心跳从"定时轮询"改成"差分 + 事件"：每次快照进来先跟上一份比，
 * 只把**变了的那几项**拿出来交给导演层。事件不是给日志看的，是换模式的信号。
 */

/**
 * 会改变编排口径的字段：名字 + 类型。一张表管三件事——归一化、比对、取值，
 * 免得同一份字段写三遍然后漂移。
 *
 * 故意不在里面的两类：
 *   - `timer`：专注倒计时每秒都在变，算进变化里就成了每秒一条事件，等于没做差分。
 *     它的意义由 `focus` 的边沿覆盖（开始/结束专注）。
 *   - `fps` / `queue.*`：高频噪声，变了也不影响她怎么演。
 */
const FIELDS = [
  ['focus', Boolean],
  // 她当前在演什么 ActionStateType。导演层靠它认出"她已经在睡了"。
  ['heroState', String],
  ['busy', Boolean],
  // 游戏自己在演剧情/说话。DLL 这时连 pull 都不做，侧车排戏只会排进 feed 里过期。
  ['hard', Boolean],
  ['busyReason', String],
  ['scene', String],
  ['heroineReady', Boolean],
  // 玩家此刻看到的机位（VirtualCameraType 名：Base/Chair/Desk/Window/Sofa/StoryLandscape…）。
  // 换机位是玩家的动作，不是噪声。构图还会决定一个全身动作在不在镜头里。
  ['cam', String],
  // 游戏自己说的"正在演剧情"（RoomCameraManager.isPlayingStory），比我们从文本/语音
  // token 猜的 hard 权威。先只观察，不接管 busy 判定——证据够了再改。
  ['camStory', Boolean],
]

/** 同一个变化在这个窗口内反复出现只算一次（游戏端偶尔会抖）。 */
const FLAP_MS = 250

function norm(json) {
  const j = json || {}
  const out = {}
  for (const [k, cast] of FIELDS) out[k] = cast === Boolean ? Boolean(j[k]) : String(j[k] || '')
  return out
}

export function createMonitor(opts) {
  const onChange = (opts && opts.onChange) || (() => {})
  const log = (opts && opts.log) || (() => {})
  let cur = null
  let seq = 0        // 收到多少次快照（观测计数）
  let changeSeq = 0  // 报出去多少次变化（切换计数）
  let lastChangeAt = 0

  /**
   * 喂一份快照。返回这次产生的变化数组（空数组=没变化）。
   * 调用方同时把快照交给番茄钟（applyHeartbeat）：职责不同——这里回答"什么变了"，
   * 番茄钟回答"这意味着哪一个 phase"。
   */
  function observe(json, now) {
    const t = Number.isFinite(now) ? now : Date.now()
    const next = norm(json)
    seq += 1

    if (!cur) {
      cur = Object.assign({}, next, { seq, changeSeq, at: t })
      lastChangeAt = t
      return []
    }

    const changes = []
    for (const [f] of FIELDS) {
      if (next[f] === cur[f]) continue
      // 字符串字段变成空 = 这一轮没读到，不算"她切走了"。
      // 最常见的是 HeroineAI 还没就绪；剧情语音结束时 busyReason 也会清空，
      // 那一侧的切换已经由 hard 覆盖。
      if (typeof next[f] === 'string' && !next[f]) continue
      changes.push({ field: f, from: cur[f], to: next[f] })
    }

    cur = Object.assign({}, next, { seq, changeSeq, at: t })
    if (!changes.length) return []
    // 抖动抑制：同一时间的重复变化只报一次
    if (t - lastChangeAt < FLAP_MS) return []
    lastChangeAt = t

    changeSeq += 1
    const ev = { type: 'game_change', at: t, seq, changeSeq, changes, state: snapshot() }
    log('monitor: ' + changes.map((c) => c.field + ' ' + JSON.stringify(c.from) + '→' + JSON.stringify(c.to)).join(', '))
    onChange(ev)
    return changes
  }

  function snapshot() {
    return cur ? Object.assign({}, cur) : null
  }

  /** 游戏正在走自己的剧情/语音：这时排戏是白排。 */
  function storyTelling() {
    return Boolean(cur && cur.hard)
  }

  function reset() {
    cur = null
    seq = 0
    changeSeq = 0
    lastChangeAt = 0
  }

  return {
    observe,
    snapshot,
    storyTelling,
    reset,
    get seq() { return seq },
    get changeSeq() { return changeSeq },
  }
}
