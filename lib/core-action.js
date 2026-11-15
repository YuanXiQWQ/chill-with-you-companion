// 核心动作机制：先定"这句话的核心行为是什么"，再以它为主体编一整套动作。
//
// 为什么要这一层：模型给的是零散 id，同一句话每次挑的可能不一样——「有点渴了」
// 曾经演成打哈欠，因为"喝"和"困"在模型眼里都是"身体反应"。这里先用语句判核心行为，
// 判出来就把整段锁死在一个族上：进入 → 循环（按语音长度）→ 收尾，一套完整动作。
//
// 只使用游戏本身已有的族（清单里"activity"级，带 start/loop/end 的那些）。
// 离座类不进来：她始终坐在椅子上（见 motion-class.isOffChair）。
import { classifyClip, isOffChair, MOTION_CLASS } from './motion-class.js'

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
import { segsOf, durationOf } from './game-grammar.js'

// 顺序即优先级：先说到的、更需要身体的排前面。
// kind: activity = 一件事（按族整段演）；gesture = 一两秒的反应（只播自己那一段）。
const CORE_TABLE = [
  { verb: 'drink', kind: 'activity', family: 'anim_break_tea_sub_drink', label: '喝一口', re: /喝|渴|抿|润嗓|水/ },
  { verb: 'tea', kind: 'activity', family: 'anim_break_tea_sub_hot', label: '喝茶/咖啡', re: /茶|咖啡|暖手|泡/ },
  { verb: 'sleep', kind: 'activity', family: 'anim_break_sleep_sub_fall', label: '趴一会', re: /趴一会|趴着|眯一会|眯一下|睡一会|睡一下/ },
  { verb: 'stretch', kind: 'activity', family: 'anim_wild_stretchfullbody', label: '伸懒腰', re: /伸懒腰|伸个懒腰|伸展|抻|活动活动|舒展/ },
  { verb: 'shoulder', kind: 'activity', family: 'anim_wild_stretchshoulder', label: '揉肩', re: /肩膀|肩颈|揉肩|脖子酸|落枕/ },
  { verb: 'yawn', kind: 'activity', family: 'anim_break_yawn_1', label: '打哈欠', re: /哈欠|打哈|困|睡意|睁不开眼/ },
  { verb: 'tired', kind: 'activity', family: 'anim_wild_tired', label: '累瘫', re: /累|疲惫|没力气|乏|撑不住|精疲力/ },
  { verb: 'breathe', kind: 'activity', family: 'anim_wild_breath', label: '深呼吸', re: /深呼吸|喘口气|呼吸一下|喘一下/ },
  { verb: 'work_pc', kind: 'activity', family: 'anim_work_pc_sub_thinking', label: '敲键盘', re: /写代码|敲代码|编码|调试|debug|程序|电脑|键盘|跑一下|编译/ },
  { verb: 'work_report', kind: 'activity', family: 'anim_work_report_sub_thinking', label: '写报告', re: /写报告|报告|文档|写字|周报/ },
  { verb: 'read_book', kind: 'activity', family: 'anim_work_book_sub_pageflip', label: '看书', re: /看书|读书|翻书|课本|教材|习题/ },
  { verb: 'novel', kind: 'activity', family: 'anim_break_novel_sub_pageflip_next', label: '看小说', re: /小说|故事|翻页|章节/ },
  { verb: 'movie', kind: 'activity', family: 'anim_break_movie_sub_suspense', label: '看电影', re: /电影|影片|看片|追剧/ },
  { verb: 'music', kind: 'activity', family: 'anim_break_music_low', label: '听歌', re: /听歌|音乐|耳机|放首歌/ },
  { verb: 'nod', kind: 'gesture', family: 'anim_story_base001_sub_nod', label: '点头', re: /点头|同意|赞成|就这么定了|按这个来|好耶/ },
  { verb: 'shy', kind: 'gesture', family: 'anim_story_base001_sub_shy', label: '害羞', re: /害羞|不好意思|脸红|别夸|夸我|讨厌/ },
  { verb: 'think', kind: 'gesture', family: 'anim_story_base001_sub_thinking1', label: '想一想', re: /想想|琢磨|思考|纠结|犹豫|怎么办/ },
  { verb: 'laugh', kind: 'gesture', family: 'anim_break_movie_sub_laugh', label: '笑', re: /好笑|哈哈|笑死|搞笑|逗/ }
]

export const CORES = CORE_TABLE

function familyOk(family) {
  if (!family || isOffChair(family)) return false
  return true
}

// 从一句话里认出核心行为。返回按语句先后出现的全部命中（最多留两拍：
// 「先喝口水，然后接着写」= 喝水开场、写代码收尾），第一个就是核心。
export function decideCore(text, cues) {
  const s = String(text || '')
  const hits = []
  for (const c of CORE_TABLE) {
    if (!familyOk(c.family)) continue
    const m = c.re.exec(s)
    if (!m) continue
    hits.push({ ...c, atChar: m.index, said: m[0] })
  }
  // 「写代码写得有点累，先喝口水」——核心是"喝水"，不是先提到的那件事。
  // 句子里带 先/要/得/想 的那一拍才算主旨，否则按出现先后。
  const marked = (h) => /先|让我|帮我|给我|去|来一/.test(s.slice(Math.max(0, h.atChar - 3), h.atChar)) ? -1 : 0
  hits.sort((a, b) => marked(a) - marked(b) || a.atChar - b.atChar)
  if (hits.length) return { core: hits[0], also: hits.slice(1, 2), from: 'text' }
  // 语句里没有可用动词时，退一手：拿模型第一条动作的族当核心（不猜内容）。
  const first = asArray(cues).find((c) => c && c.slot === 'animations' && familyOk(c.id))
  if (!first) return { core: null, also: [], from: 'none' }
  const verb = CORE_TABLE.find((c) => c.family === String(first.id).replace(/_(start|loop|end|single)$/, ''))
  return { core: verb ? { ...verb, said: '' } : { verb: 'cue', kind: classifyClip(first.id) === MOTION_CLASS.GESTURE ? 'gesture' : 'activity', family: first.id, label: String(first.id).replace(/^anim_/, '') }, also: [], from: 'cue' }
}

// 一整套：可选的小反应（起手）→ 核心活动 → 可选的第二拍（收尾）。
// 只给顺序与角色，具体每段多长、循环几次由 chainStartToLoop 按语音窗口决定——
// 两边都算时长就会互相打架（历史 bug）。
export function buildSuite(cues, text, opts = {}) {
  const list = asArray(cues)
  const { core, also, from } = decideCore(text, list)
  if (!core) return { cues: list, core: null, suite: [], from }
  // 语句里没有可用动词时只做诊断、不改结构：那种情况模型给的就是全部信息，
  // 按"第一条当核心"重组会把其余动作吞掉（历史行为不能退）。
  if (from === 'cue') return { cues: list, core, suite: [], from }
  const steps = []
  // 起手：只留一条内容对得上的手势，别让她先做一套才进入正题
  // 起手的小反应只在内容对得上时才留：累瘫了先"调皮一下"再瘫，比不演还怪。
  const REACT_OK = /好|嗯|对|同意|赞成|害羞|不好意思|笑|哈哈|想想|嗯…/
  const pre = list.find((c) => c && c.slot === 'animations' && familyOk(c.id)
    && classifyClip(c.id) === MOTION_CLASS.GESTURE && String(c.id) !== core.family)
  const preOk = pre && REACT_OK.test(String(text || '')) && !/fun|laugh|surprise/.test(String(pre.id))
  if (preOk && core.kind === 'activity') steps.push({ slot: 'animations', id: pre.id, role: 'pre', locked: true })
  steps.push({ slot: 'animations', id: core.family, role: 'core', verb: core.verb, locked: true })
  // 去重：起手已经演过的那条不再当收尾（否则"嗯…我同意"会点两次头）
  if (also.length && also[0].family !== core.family && !steps.some((s) => s.id === also[0].family) && also[0].family !== String(pre && pre.id)) {
    steps.push({ slot: 'animations', id: also[0].family, role: 'after', verb: also[0].verb, locked: true })
  }
  // 手势类核心：她自己那一段就是全套，不追加起手/收尾。
  const cleaned = core.kind === 'gesture'
    ? [{ slot: 'animations', id: core.family, role: 'core', verb: core.verb, locked: true }]
    : steps
  const others = list.filter((c) => c && c.slot !== 'animations')
  const seq = cleaned.map((c, i) => ({ ...c, at: 0, order: i, spanMs: spanOf(c.id) }))
  return { cues: [...seq, ...others], core, suite: seq, from, segs: segsOf(core.family) }
}
// 这一族整套跑完大约多长（start + loop + end 的段时长之和）。
// 用途只有一个：让"下一拍"排在它整段之后。家族级 durationOf 只给循环段长度，
// 拿它算位置会让收尾插进核心的中段（实测：写代码接伸懒腰，伸懒腰被插在中途）。
export function spanOf(family) {
  const segs = segsOf(family)
  let ms = 0
  for (const s of segs) ms += Number(durationOf(String(family) + '_' + s)) || 0
  return ms > 0 ? Math.min(ms, 12000) : 0
}