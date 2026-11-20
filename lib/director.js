// 动作导演系统：先定"这句话的主戏是什么"，再以它为主体编一整套动作。
//
// 为什么要这一层：模型给的是零散 id，同一句话每次挑的可能不一样——「有点渴了」
// 曾经演成打哈欠，因为"喝"和"困"在模型眼里都是"身体反应"。这里先用语句判主戏，
// 判出来就把整段锁死在一个族上：进入 → 循环（按语音长度）→ 收尾，一套完整动作。
//
// 只使用游戏本身已有的族（清单里"activity"级，带 start/loop/end 的那些）。
// 离座类不进来：她始终坐在椅子上（见 motion-class.isOffChair）。
//
// 动作知识（族名、正则、传染/陪伴/他的身体、原生 AnimationType）全部在 actions.js，
// 这里只负责"从一句话里认出哪一个是主戏"。
import { classifyClip, isOffChair, MOTION_CLASS } from './motion-class.js'

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
import { segsOf, durationOf } from './game-grammar.js'
import { subjectOf, isAboutHim } from './subject.js'
import {
  ORDERED_ACTIONS,
  COMPANION_VERBS as SHARED,
  isHisBody,
} from './actions.js'

// 转出去给测试和下游用：动作表按优先级排好的数组形态
export { ORDERED_ACTIONS }

// 模型常把一组动作拆成 X_start / X_loop / X_end 三条独立 cue 下发。
// 游戏端收到分段 cue 时只能播它点名的那一段（不能替上游拼组，否则三条各演一遍会更糟），
// 于是三段之间各走一次"归还姿势 → 重新淡入"：张嘴 → 收回 → 张嘴 → 收回。
// 观感就是演出开头那一下抽动。所以在这一层按基名合并成一条，让游戏端自己拼完整组——
// 它的 start→loop→end 是连续的，没有中途归还。
const SEG_RE = /_(start|loop|end)$/
export function mergeSegments(list) {
  const out = []
  const seen = new Map()
  for (const c of asArray(list)) {
    if (!c || c.slot !== 'animations' || !SEG_RE.test(String(c.id))) { out.push(c); continue }
    const base = String(c.id).replace(SEG_RE, '')
    const prev = seen.get(base)
    if (prev) {
      prev.durationMs = Math.max(Number(prev.durationMs) || 0, Number(c.durationMs) || 0)
      continue
    }
    const merged = { ...c, id: base }
    seen.set(base, merged)
    out.push(merged)
  }
  return out
}

function familyOk(family) {
  if (!family || isOffChair(family)) return false
  return true
}

// 从一句话里认出主戏。返回按语句先后出现的全部命中（最多留两拍：
// 「先喝口水，然后接着写」= 喝水开场、写代码收尾），第一个就是主戏。
//
// opts.includeHis：把"他说他自己"的 activity 也报出来（带 subject 字段）。
// 需求层要它——"谁做"是需求层的事，不是匹配层的事：匹配层负责认出动词，
// 需求层才决定这件事轮不轮得到她。
export function decideCore(text, cues, opts = {}) {
  const s = String(text || '')
  const hits = []
  for (const c of ORDERED_ACTIONS) {
    if (!familyOk(c.family)) continue
    const m = c.re.exec(s)
    if (!m) continue
    const subj = subjectOf(s, m.index)
    // 他的身体状态不锁成她的动作：「我累瘫了」不该让她瘫在椅子上，
    // 「我有点渴了」也不该让她去抿一口。做事类（写代码/看书/看电影）例外——那是陪伴。
    // 手势更例外：点头/笑本来就是对他说的话的反应。
    if (c.kind === 'activity' && !SHARED.has(c.verb) && subj === 'me' && !opts.includeHis) continue
    hits.push({ ...c, atChar: m.index, said: m[0], subject: subj })
  }
  // 「写代码写得有点累，先喝口水」——主戏是"喝水"，不是先提到的那件事。
  // 句子里带 先/要/得/想 的那一拍才算主旨，否则按出现先后。
  const marked = (h) => /先|让我|帮我|给我|去|来一/.test(s.slice(Math.max(0, h.atChar - 3), h.atChar)) ? -1 : 0
  hits.sort((a, b) => marked(a) - marked(b) || a.atChar - b.atChar)
  if (hits.length) return { core: hits[0], also: hits.slice(1, 2), from: 'text' }
  // 语句里没有可用动词时，退一手：拿模型第一条动作的族当主戏（不猜内容）。
  const first = asArray(cues).find((c) => c && c.slot === 'animations' && familyOk(c.id))
  if (!first) return { core: null, also: [], from: 'none' }
  const verb = ORDERED_ACTIONS.find((c) => c.family === String(first.id).replace(/_(start|loop|end|single)$/, ''))
  return { core: verb ? { ...verb, said: '' } : { verb: 'cue', kind: classifyClip(first.name || first.id) === MOTION_CLASS.GESTURE ? 'gesture' : 'activity', family: first.id, label: String(first.id).replace(/^anim_/, '') }, also: [], from: 'cue' }
}

// 一整套：可选的小反应（起手）→ 主戏 → 可选的第二拍（收尾）。
// 只给顺序与角色，具体每段多长、循环几次由下游按语音窗口决定——
// 两边都算时长就会互相打架（历史 bug）。
export function buildSuite(cues, text, opts = {}) {
  const raw = mergeSegments(asArray(cues))
  // 兜底：整句在说他，就把他的身体类动作摘掉，剩下的照旧走
  const him = isAboutHim(text)
  const list = him
    ? raw.filter((c) => !(c && c.slot === 'animations' && isHisBody(c.id)))
    : raw
  const { core, also, from } = decideCore(text, list)
  if (!core) return { cues: list, core: null, suite: [], from }
  // 语句里没有可用动词时只做诊断、不改结构：那种情况模型给的就是全部信息，
  // 按"第一条当主戏"重组会把其余动作吞掉（历史行为不能退）。
  if (from === 'cue') return { cues: list, core, suite: [], from }
  const steps = []
  // 起手：只留一条内容对得上的手势，别让她先做一套才进入正题
  // 起手的小反应只在内容对得上时才留：累瘫了先"调皮一下"再瘫，比不演还怪。
  const REACT_OK = /好|嗯|对|同意|赞成|害羞|不好意思|笑|哈哈|想想|嗯…/
  // 起手的候选要排一次序再取第一条。原先直接 list.find，取到的是"模型这次把哪条排前面"，
  // 同一句话换个请求就可能换个起手动作——演出不稳定的一大来源，而且是模型侧改不掉的。
  // 排序键只跟内容有关：先按时间点，再按 id 字典序，和模型给的顺序无关。
  const pre = list
    .filter((c) => c && c.slot === 'animations' && familyOk(c.id)
      && classifyClip(c.id) === MOTION_CLASS.GESTURE && String(c.id) !== core.family)
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || String(a.id).localeCompare(String(b.id)))[0]
  const preOk = pre && REACT_OK.test(String(text || '')) && !/fun|laugh|surprise/.test(String(pre.id))
  if (preOk && core.kind === 'activity') steps.push({ slot: 'animations', id: pre.id, role: 'pre', locked: true })
  steps.push({ slot: 'animations', id: core.family, role: 'core', verb: core.verb, locked: true })
  // 去重：起手已经演过的那条不再当收尾（否则"嗯…我同意"会点两次头）
  if (also.length && also[0].family !== core.family && !steps.some((s) => s.id === also[0].family) && also[0].family !== String(pre && pre.id)) {
    steps.push({ slot: 'animations', id: also[0].family, role: 'after', verb: also[0].verb, locked: true })
  }
  // 手势类主戏：她自己那一段就是全套，不追加起手/收尾。
  const cleaned = core.kind === 'gesture'
    ? [{ slot: 'animations', id: core.family, role: 'core', verb: core.verb, locked: true }]
    : steps
  const others = list.filter((c) => c && c.slot !== 'animations')
  const seq = cleaned.map((c, i) => ({ ...c, at: 0, order: i, spanMs: spanOf(c.id) }))
  return { cues: [...seq, ...others], core, suite: seq, from, segs: segsOf(core.family) }
}
// 这一族整套跑完大约多长（start + loop + end 的段时长之和）。
// 用途只有一个：让"下一拍"排在它整段之后。家族级 durationOf 只给循环段长度，
// 拿它算位置会让收尾插进主戏的中段（实测：写代码接伸懒腰，伸懒腰被插在中途）。
export function spanOf(family) {
  const name = String(family || '')
  if (!name) return 0
  const segs = segsOf(name)
  // 46 个族是三段式，另外 137 个是单段 —— 单段的 segs 就是 ['single']，
  // 时长记在族自己身上（segDurations.single）。早先这里不分情况一律拼
  // family + '_' + seg，单段族拼出 anim_..._nod_single 这种不存在的键，
  // 于是半边动作表算出来是 0，arrange 退回 1200ms 兜底，整条时间轴错位。
  // 三段族里的 'single' 是"不拆分时的整段"，和三段重复，不能加进去。
  const real = segs.filter((s) => s !== 'single')
  let ms = 0
  if (real.length === 0) {
    ms = Number(durationOf(name)) || 0
  } else {
    for (const s of real) ms += Number(durationOf(name + '_' + s)) || 0
    if (ms <= 0) ms = Number(durationOf(name)) || 0
  }
  return ms > 0 ? Math.min(ms, 12000) : 0
}
