// 动作分类与编排（大脑侧）。
// 分类口径必须与游戏端 game/src/MotionClass.cs 完全一致，否则两端对"这段算什么动作"理解不同。
// 编排只做三件事：
//   1) 按回复内容的相关度给 cue 排序（先说出口的手势在前，需要够道具/起身的在后）
//   2) 把互相冲突的类别串行化（走路时不能同时喝茶、起身时不能点头）
//   3) 以"她此刻正在做的动作"为起点算过渡，冲突的往后推，而不是硬切

import { layerOf, segsOf, durationOf, tripleOf, familyOf as grammarFamily } from './game-grammar.js'

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

// 这些是游戏自己的镜头/界面/环境动画，永远不该当表演动作下发：
// ui_* 界面动画（ui_levelup_none 长达 60 秒）、env_* 场景循环（摩天轮 600 秒）、
// start* 开场运镜、item_* 物品翻页。把它们当动作发下去，她会"消失"或定格一分钟。
export const NON_PERFORMANCE_SCENES = ['ui', 'env', 'start', 'startcamera', 'startvolume', 'item']

export function isPerformanceClip(id) {
  const s = String(id || '').replace(/^anim_/i, '').toLowerCase()
  if (!s) return false
  return !NON_PERFORMANCE_SCENES.some((pre) => s === pre || s.startsWith(pre + '_'))
}

// 离座类：这些动作会把她从椅子上带走（离座、走去拿东西、坐沙发、回座）。
// 表演是"插入"——起手锚在她此刻坐着的姿势，归还也要还到坐姿上；
// 一旦放她离座，归还就没有落点，回来时姿势也对不上（实测 leavechair_cupcake
// 交接 dev 从 0.3° 涨到 8°），而且离座那几秒她根本不在画面里。
// 结论：不排离座，宁可这段没有动作。
const OFFCHAIR_TOKENS = ['leavechair', 'leaveseat', 'standup', 'walk', 'run', 'approach']

export function isOffChair(id) {
  const tk = tokensOf(id)
  if (tk.length === 0) return false
  return OFFCHAIR_TOKENS.some((k) => hasToken(tk, k))
}

// 每轮编排前先看她此刻在做什么待机：如果正处在离座/沙发待机里，
// 这一轮就整段不排动作 —— 身体不在椅子上，插入没有落点，演了只会把她拽回来。
// 游戏端上报的是 motion.base（她当前的基础动画），motion.active 是我们自己的插入。
export function offSeatIdle(snap) {
  const m = (snap && snap.motion) || (snap && snap.game && snap.game.motion) || {}
  // live = 游戏 Animator 此刻真的在播的 clip（她当前的待机）——这是唯一可信的"现在在哪"。
  // active = 我们自己正在插的动作（万一插的就是离座，也算离座中）。
  // 绝不能用 base：base 是"我们上次演过的家族"，会一直挂在旧值上，永远误判。
  const ids = [m.live, m.active].map((v) => String(v || '')).filter(Boolean)
  const hit = ids.find((id) => isOffChair(id))
  return hit || ''
}

// 编排前的坐姿守卫：她若正离座，本轮整段不排动作（只留字幕/口型）。
// 单独抽出来是为了可测——这条规矩比"动作好不好看"更硬：插错了会把她从沙发上拽起来。
export function seatGuard(cues, snap) {
  const off = offSeatIdle(snap)
  if (!off) return { cues: asArray(cues), skipped: '' }
  const kept = asArray(cues).filter((c) => !(c && c.slot === 'animations'))
  return { cues: kept, skipped: off }
}

export const MOTION_CLASS = {
  GESTURE: 'gesture',
  PROP: 'prop',
  POSTURE: 'posture',
  LOCOMOTION: 'locomotion',
  IDLE: 'idle',
  UNKNOWN: 'unknown'
}

// 与 MotionClass.cs 同步的关键词表（顺序即优先级）
const KEYS = [
  [MOTION_CLASS.LOCOMOTION, ['walk', 'run', 'leavechair', 'go', 'comeback', 'move', 'approach']],
  [MOTION_CLASS.POSTURE, ['sit', 'stand', 'laya', 'sleep', 'slee', 'yawn', 'stretch', 'plank', 'dance', 'lie', 'wake', 'banzai', 'guts', 'eieio', 'feellarge', 'wet']],
  [MOTION_CLASS.PROP, ['drink', 'eat', 'tea', 'coffee', 'cup', 'book', 'openbook', 'pen', 'apen', 'phone', 'headphone', 'pc', 'report', 'typing', 'write', 'magazine', 'newspaper', 'trash', 'window', 'pageflip', 'flip', 'novel', 'textbook']],
  [MOTION_CLASS.GESTURE, ['nod', 'shake', 'agree', 'think', 'laugh', 'cry', 'smile', 'shy', 'sad', 'joy', 'fun', 'anger', 'surprise', 'presshands', 'hand', 'wave', 'bow', 'reaction', 'movie', 'lookplayer', 'dryeye', 'eye', 'rub', 'music', 'sway', 'hum', 'playingwithapen']],
  [MOTION_CLASS.IDLE, ['idle', 'breath']]
]

// 按 token 比对：id 用 _ 切开，token 相等才算命中；
// 长键（>=4 字符）允许 token 前缀，用来吃掉 nod1 / thinking1 这类编号后缀。
// 不做整串 includes —— lookpenguin 会被 pen 命中，suspense 也是。
function tokensOf(id) {
  return String(id || '').toLowerCase().replace(/^anim_/, '').split('_').filter(Boolean)
}
function hasToken(tokens, key) {
  return tokens.some((t) => t === key || (key.length >= 4 && t.startsWith(key)))
}

export function classifyClip(id) {
  // _base / _idle 是段名，不做 token 匹配 —— 否则 story_base001_* 里的
  // ase001 会被当成"基础姿态"，整族动作全变 idle。
  // 段名是 base/idle/breath 的一律算待机；X_base_loop 也是（game 自己的场景base循环，
  // 我们不演它，只是它已经在她身上跑着）。少了后半条，break_tea_base_loop 会被
  // 当成道具动作，编排就会去"演她正在做的待机"。
  // _single 是单段版后缀，判类前先剥掉：break_forward_base_single 仍是 base 待机
  const bare = String(id || '').replace(/_single$/i, '')
  if (/_(?:base|subbase\d*|idle|breath)$/i.test(bare)) return MOTION_CLASS.IDLE
  if (/_(?:base|subbase\d*|idle|breath)_(?:loop2?|idle)$/i.test(bare)) return MOTION_CLASS.IDLE
  const s = String(id || '').toLowerCase()
  if (!s) return MOTION_CLASS.UNKNOWN
  const tokens = tokensOf(s)
  for (const [cls, keys] of KEYS) if (keys.some((k) => hasToken(tokens, k))) return cls
  if (tokens.includes('sub')) return MOTION_CLASS.GESTURE
  if (tokens.includes('idle') || tokens.includes('breath') || (tokens.includes('base') && tokens.some((t) => t === 'loop' || t === 'start' || t === 'end'))) return MOTION_CLASS.IDLE
  if (tokens.includes('wild')) return MOTION_CLASS.POSTURE
  return MOTION_CLASS.UNKNOWN
}

// 从当前状态过渡到目标状态要多久（毫秒）。两端同值才是一致口径；
// 这里比 C# 侧的 RampMs 略长，因为大脑先按它排时间，游戏端稍快一点不会露出空档。
const TRANSITION_MS = {
  'gesture>gesture': 200,
  'gesture>prop': 620,
  'gesture>posture': 900,
  'gesture>locomotion': 700,
  'prop>gesture': 420,
  'prop>prop': 380,
  'prop>posture': 900,
  'prop>locomotion': 800,
  'posture>gesture': 520,
  'posture>prop': 700,
  'posture>posture': 900,
  'posture>locomotion': 900,
  'locomotion>gesture': 600,
  'locomotion>prop': 700,
  'locomotion>posture': 900,
  'locomotion>locomotion': 500,
  'idle>gesture': 240,
  'idle>prop': 600,
  'idle>posture': 900,
  'idle>locomotion': 700
}

export function transitionMs(from, to) {
  const key = `${from || MOTION_CLASS.IDLE}>${to || MOTION_CLASS.IDLE}`
  return TRANSITION_MS[key] ?? 400
}

// 独占类别：正在演的时候不接受别的动作（走、起身、躺下）
const EXCLUSIVE = new Set([MOTION_CLASS.LOCOMOTION, MOTION_CLASS.POSTURE])

// 内容相关度：同一句回复里，先说出口的配手势，动作型内容配道具，情绪收尾配姿态
const CONTENT_HINT = [
  // 位移优先：一句话里既提到走又提到累，先让她起来，累是走之后的事
  [MOTION_CLASS.LOCOMOTION, ['去趟', '过去', '出去', '离开', '出门', '便利店', '等我', '马上回来', '走一趟', '站起来走']],
  [MOTION_CLASS.GESTURE, ['嗯', '对', '是', '好', '没错', '当然', '我想', '觉得', '加油', '棒', '不错', '笑', '开心', '难过', '抱歉', '谢谢']],
  [MOTION_CLASS.PROP, ['写', '敲', '代码', '报告', '看书', '读', '笔记', '咖啡', '茶', '喝', '吃', '电脑', '键盘']],
  [MOTION_CLASS.POSTURE, ['累', '困', '睡', '休息', '起来', '走', '站', '伸', '打哈欠', '放松', '躺']]
]

export function contentClasses(text) {
  const s = String(text || '')
  const out = []
  for (const [cls, words] of CONTENT_HINT) if (words.some((w) => s.includes(w))) out.push(cls)
  return out
}

/**
 * 编排一条回复的动画序列。
 * @param cues     已经过 sanitizePerformance 的 cue 列表（slot=animations，at 是毫秒）
 * @param opts.currentClass 她此刻正在做的动作类别（来自 /game 的 motion.class）
 * @param opts.currentEndsAt 当前动作预计结束的时刻（毫秒，相对本条回复）
 * @param opts.text 回复台词，用于相关度排序
 * @returns { cues, notes }  cues 的 at 已被重排，notes 记录为什么挪动
 */
/**
 * 编排一条回复的动画序列 —— 完全照游戏自己的语法：
 *   · 层锁定：她此刻在哪个场景层（剧情/站立/休息/工作/表情），就优先给同层的动作；
 *     跨层的动作往后排并标注 layerSwitch，因为"坐着演站起来"会穿模。
 *   · 三段展开：家族是 start+loop+end 就把 loop 按说话长度重复填满，而不是演完就僵住。
 *   · 时长用游戏自己的（单段中位 4.0s），不再为了塞进 cue 的 d 而改她的节奏。
 * @param cues 已通过 sanitizePerformance 的 cue（slot=animations）
 * @param opts { text, currentClass, currentLayer, currentEndsAt, speechMs }
 */
export function planSequence(cues, opts = {}) {
  // 离座类不进入编排：她始终坐在椅子上（见 isOffChair 的说明）
  // trip = 离座长途自己排的段，它们本来就要离开椅子（见 lib/seat-trip.js）
  const list = asArray(cues).filter((c) => c && c.slot === 'animations' && (c.trip || !isOffChair(c.id)))
  const others = asArray(cues).filter((c) => c && c.slot !== 'animations')
  if (list.length === 0) return { cues: others, notes: [] }

  const notes = []
  const speechMs = Number.isFinite(opts.speechMs) ? opts.speechMs : 3200
  let cursor = Number.isFinite(opts.currentEndsAt) ? Math.max(0, opts.currentEndsAt) : 0
  let fromClass = opts.currentClass || MOTION_CLASS.IDLE
  let curLayer = opts.currentLayer || ''

  // 核心动作机制给出的 "一整套" 已经是最终顺序：起手 → 核心 → 收尾。
  // 这种带 role/locked 的输入不再排序，否则"喝水"的核心会被一条恰好命中的小动作顶掉。
  const lockedOrder = list.some((c) => c && c.locked)
  // 相关度：内容命中的类别靠前；同层优先（层不同要给切换留时间）
  const hint = contentClasses(opts.text)
  if (lockedOrder) {
    const seq = list.slice().map((c, i) => ({ cue: c, cls: classifyClip(c.id), layer: layerOf(c.id), score: 0, order: i }))
    return serialize(seq)
  }
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

  // 串行化：只决定"什么时候开始"，不改顺序。排序（ranked）与锁定顺序（suite）都从这里出去。
  function serialize(seq) {
    const out = []
    for (const item of seq) {
      const wantAt = Math.max(0, Number(item.cue.at) || 0)
      const start = Math.max(wantAt, cursor)
      if (start !== wantAt) notes.push({ id: item.cue.id, cls: item.cls, movedFrom: wantAt, to: start, why: 'wait-for-previous' })

      if (curLayer && item.layer && item.layer !== curLayer) {
        notes.push({ id: item.cue.id, layerFrom: curLayer, layerTo: item.layer, why: 'layer-switch' })
        curLayer = item.layer
        fromClass = MOTION_CLASS.POSTURE // 换层要先起身/坐下，按姿态类留过渡
      }

      // 用游戏自己的时长：单段动作往往 4 秒，别压成 2 秒。
      // 展开（start→loop×n→end）已交给 chainStartToLoop：这里只决定"演哪一条、什么时候开始"，
      // 两边都展开过，就会同 id 同 at 下发两遍（历史 bug）。
      const dur = Math.max(600, durationOf(item.cue.id) || Number(item.cue.durationMs) || 2400)
      out.push({ ...item.cue, at: start, durationMs: dur })
      // 推进游标按"整套跨度"：核心动作会展开成 start→loop×n→end，比单段长得多。
      // 只按循环段长度推进，下一拍就会插进核心的中段（实测伸懒腰被插在写代码中途）。
      cursor = start + Math.max(dur, Number(item.cue.spanMs) || 0)

      const trans = transitionMs(fromClass, item.cls)
      cursor += EXCLUSIVE.has(item.cls) ? Math.max(0, trans) : trans
      if (EXCLUSIVE.has(item.cls)) notes.push({ id: item.cue.id, cls: item.cls, exclusive: true })
      fromClass = item.cls
      if (item.layer) curLayer = item.layer
    }
    return { cues: [...out, ...others], notes }
  }
  return serialize(ranked)
}

// ── 内容类别硬约束 ──────────────────────────────────────────────────
// 提示词只是建议，这里才是闸门：内容明确指向某类动作（喝/写/累/走），
// 而模型给的类别完全不符，就从动作库里挑一条同类别、同场景层的替换掉。
const EMOTION_WORDS = {
  Tired: ['累', '疲', '困', '睡', '哈欠', '伸'],
  Shy: ['害羞', '羞'],
  Happy: ['笑', '开心', '高兴', '喜'],
  Fun: ['玩', '趣', '笑'],
  Sad: ['难', '悲', '低'],
  Frustration: ['沮丧', '烦'],
  Confused: ['困惑', '歪头', '思'],
  Agree: ['点', '同意', '认'],
  Disagree: ['摇', '拒绝', '不同'],
  Excited: ['兴奋', '跳'],
  Guts: ['加油', '鼓劲'],
  Drink: ['喝', '茶', '咖啡', '杯']
}

// 话题命中表：[内容触发词, 语义/名字里的词, 动作 id 里该出现的动词 token]
// 第三列是关键：内容说"喝"，要落到 drink 那族，而不是名字里带"茶"的 base 待机。
const CONTENT_TOPIC = {
  prop: [
    [['喝', '水', '茶', '咖啡', '杯', '渴'], ['喝', '茶', '咖啡', '杯', '水'], ['drink']],
    [['吃', '饭', '零食'], ['吃', '饭'], ['eat']],
    [['写', '报告', '代码', '敲', '键盘'], ['写', '报告', '电脑', '键盘'], ['write', 'report', 'pc', 'typing']],
    [['看', '书', '读', '笔记', '翻页'], ['看', '书', '读'], ['read', 'book', 'pageflip', 'novel']],
    [['转笔', '笔'], ['笔', '转'], ['apen', 'pen']]
  ],
  posture: [
    [['困', '睡', '躺', '哈欠', '累'], ['哈欠', '睡', '躺', '疲'], ['yawn', 'sleep', 'lie', 'tired']],
    [['伸', '懒腰', '起来', '站'], ['伸', '站', '起'], ['stretch', 'stand', 'up']]
  ],
  locomotion: [
    [['去', '出去', '离开', '便利店', '等我', '过去'], ['离座', '回座', '走', '出去', '离开'], ['leavechair', 'go', 'walk', 'comeback']]
  ],
  gesture: [
    [['同意', '对', '是', '好', '没错'], ['点', '同意', '认'], ['nod']],
    [['不好意思', '害羞', '被夸'], ['害羞', '羞'], ['shy']],
    [['想', '觉得', '考虑'], ['思', '想', '歪头'], ['thinking', 'look', 'glance']],
    [['眼睛', '揉', '干'], ['眼'], ['dryeye', 'eye', 'rub']],
    [['音乐', '歌', '听'], ['音乐', '歌'], ['music']]
  ]
}

function topicScore(cls, text, sem, id) {
  const rows = CONTENT_TOPIC[cls] || []
  const tokens = String(id || '').toLowerCase().replace(/^anim_/, '').split('_')
  // 只看第一条命中的话题：句子里的"喝"是动作，"写代码"是背景，不能让它抢
  for (const [triggers, wanted, verbs] of rows) {
    if (!triggers.some((w) => text.includes(w))) continue
    let score = wanted.some((w) => sem.includes(w)) ? 40 : 10
    if (verbs && verbs.some((v) => tokens.includes(v) || tokens.some((t) => t.startsWith(v)))) score += 35
    return score
  }
  return 0
}

function pickCandidate(targetClass, manifest, emotion, curLayer, text) {
  const anims = Array.isArray(manifest?.animations) ? manifest.animations : []
  const words = EMOTION_WORDS[emotion] || []
  const scored = []
  for (const e of anims) {
    const id = String(e?.id || '')
    if (!id.startsWith('anim_')) continue
    if (!isPerformanceClip(id)) continue
    if (classifyClip(id) !== targetClass) continue
    // 只考虑整条动作：单段，或三段式的 start（后续交给编排器展开 loop/end）
    if (/_loop2?$|_end$/.test(id)) continue
    const segs = segsOf(id)
    const isTriple = segs.includes('start')
    const layer = layerOf(id)
    const sem = Array.isArray(e.semantic) ? e.semantic.join('/') : ''
    let score = 0
    if (isTriple) score += 20                      // 三段式能撑满整句话
    if (curLayer && layer === curLayer) score += 15 // 同层不穿模
    if (words.length && words.some((w) => sem.includes(w))) score += 12
    // 话题命中权重最高：说到底在喝什么，比"同层"重要
    score += topicScore(targetClass, String(text || ''), sem, id)
    if (e.loop) score -= 5
    const d = Number(e.durationMs)
    if (Number.isFinite(d) && d >= 1200 && d <= 6000) score += 6
    // 保留 _start 原 id：家族名 anim_x 往往不在清单里，下发过去游戏端找不到 clip
    scored.push({ id, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored[0] || null
}

/**
 * 若内容指向的类别与模型给的完全不符，替换动作。
 * @returns { cues, changed: [{from,to,want,why}] }
 */
// 清单里每条 id 的语义（闸门判断"这条动作到底在干什么"用）
function semanticIndex(manifest) {
  const map = new Map()
  const anims = Array.isArray(manifest?.animations) ? manifest.animations : []
  for (const e of anims) {
    const id = String(e?.id || '')
    if (!id) continue
    const sem = Array.isArray(e.semantic) ? e.semantic.join('/') : String(e.name || '')
    map.set(id, sem)
  }
  return map
}

function semOf(map, id) {
  if (map.has(id)) return map.get(id)
  const fam = grammarFamily(id)
  for (const suffix of ['_start', '_loop', '_end', '']) {
    if (map.has(fam + suffix)) return map.get(fam + suffix)
  }
  return ''
}

/**
 * 内容闸门。两级判定，越靠后越严：
 *   ① 类别不符 —— 内容首要类别是 prop，模型给的却是 gesture：直接换。
 *   ② 类别对但内容不对 —— 内容说"伸懒腰"，模型给的是同类别的 fidget：
 *      模型那条在话题上得分为 0，而库里存在能得分的同类动作，才换。
 * 只有这两级都过不了才动手；其余一律尊重模型。
 * @returns { cues, changed, want, picked }
 */
export function enforceContentClass(cues, opts = {}) {
  const want = contentClasses(opts.text)
  const anims = asArray(cues).filter((c) => c && c.slot === 'animations')
  if (want.length === 0 || anims.length === 0) return { cues, changed: [], want, picked: null }

  const primary = want[0]
  // 专注态：身体被锁在游戏姿势，道具/姿态/位移演不出来（实测只剩脖子动 3~10°）。
  // 这种时候换成 prop 只是换个假动作，保留模型自己的小反应更诚实。
  if (opts.headOnly && primary !== 'gesture') {
    return { cues, changed: [], want, picked: null, skipped: 'head-only' }
  }
  const have = anims.map((c) => classifyClip(c.id))
  const sem = semanticIndex(opts.manifest)
  const curLayer = opts.currentLayer || ''
  const text = String(opts.text || '')

  const replace = (why) => {
    const pick = pickCandidate(primary, opts.manifest, opts.emotion, curLayer, text)
    if (!pick) return { cues, changed: [], want, picked: null }
    const out = cues.slice()
    const i = out.findIndex((c) => c && c.slot === 'animations')
    const from = out[i].id
    out[i] = { ...out[i], id: pick.id }
    return { cues: out, want, picked: pick.id, changed: [{ from, to: pick.id, want: primary, why }] }
  }

  // ① 类别不符
  if (!have.includes(primary)) return replace('content-class-mismatch')

  // ② 类别对，但模型这条在内容话题上完全没得分
  const modelTopic = Math.max(...anims.map((c) => topicScore(primary, text, semOf(sem, c.id), c.id)))
  // 30 分才是"语义真的对上"；10 分只是触发词命中，不能算满足
  if (modelTopic >= 30) return { cues, changed: [], want, picked: null }

  const pick = pickCandidate(primary, opts.manifest, opts.emotion, curLayer, text)
  if (!pick) return { cues, changed: [], want, picked: null }
  if (topicScore(primary, text, semOf(sem, pick.id), pick.id) < 30) {
    return { cues, changed: [], want, picked: null }
  }
  const out = cues.slice()
  const i = out.findIndex((c) => c && c.slot === 'animations')
  const from = out[i].id
  out[i] = { ...out[i], id: pick.id }
  return { cues: out, want, picked: pick.id, changed: [{ from, to: pick.id, want: primary, why: 'content-topic-mismatch' }] }
}
