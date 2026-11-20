// 第二步：需求 → 编排。
//
// 输入是 needs.js 判出来的"她欠世界哪几件事"，输出是她**真正要做的动作序列**：
// 一族一条、按 lead → core → tail 排序、每条带上"排在哪、演多久、要不要按住"。
//
// 这里刻意不做时间轴推演：队列里排的是"下一条什么时候开始"，而一条动作自己
// 从 0 开始演多久是游戏端的事（它按 start→loop→end 的段长自己走）。
// 两层都算时长就会互相打架——历史上"收尾插进核心中段"就是这个原因。
import { toNative } from './anim-type.js'
import { auditNeeds, spanOf } from './needs.js'

const ORDER = { lead: 0, core: 1, tail: 2 }

/**
 * @param {Array}  needs   extractNeeds 的产出
 * @param {object} opts
 * @param {object} opts.trip         decideTrip 的产出（要她起身的那件事）
 * @param {boolean} opts.tripGo      这一轮到底放不放行（冷却 / 正在演 / 专注都会拦）
 * @param {number} opts.awaySpanMs   离座窗口（只用于 trip cue 的时长字段）
 * @param {number} opts.speechMs     这一句语音多长
 * @param {Array}  opts.ambient      非动作槽（表情等），原样带下去
 * @returns {{cues: Array, notes: Array}}
 */
export function arrange(needs, opts = {}) {
  const speechMs = Math.max(0, Number(opts.speechMs) || 0)
  const ambient = Array.isArray(opts.ambient) ? opts.ambient : []
  const notes = []
  const trip = opts.trip || null

  // 离座独占：她不在椅子上，别的动作没有落点。
  if (trip && opts.tripGo) {
    return {
      cues: [{
        slot: 'trip',
        id: String(trip.plan || 'Sofa'),
        at: 0,
        durationMs: Math.max(0, Number(opts.awaySpanMs) || 0),
        label: trip.label || '',
        locked: true,
        why: trip.said ? `这句话要她起身：${trip.said}` : '这一轮要她离座',
      }],
      notes: ['离座独占：本轮不插动作'],
    }
  }
  if (trip && !opts.tripGo) {
    notes.push('这句话要她起身，但冷却 / 她正在演 / 专注模式拦下了，本轮照常编排')
  }

  const list = auditNeeds(needs)
    .sort((a, b) => (ORDER[a.anchor] ?? 1) - (ORDER[b.anchor] ?? 1) || (Number(b.prio) || 0) - (Number(a.prio) || 0))

  const cues = []
  let cursor = 0
  for (const n of list) {
    const span = spanOf(n.family) || 1200
    // 一族整段演完要多久是它自己的事；语音比它长时按住循环段，而不是把它拉慢。
    // 拉慢会撞上游戏端的缓慢上限（MaxSlowdown），看起来就是"动作变成慢镜头"。
    const hold = n.anchor === 'core' && speechMs > span ? Math.min(speechMs - span, 20000) : 0
    cues.push({
      slot: 'animations',
      id: n.family,
      at: Math.round(cursor),
      durationMs: Math.round(span),
      holdMs: Math.round(hold),
      // 原生优先：有对应 AnimationType 就交给游戏自己的状态机演，
      // 过渡质量由 Unity 保证；id 仍带上，DLL 采样兜底时还能用。
      ...(toNative(n.verb) || {}),
      role: n.kind === 'companion' ? 'core' : n.kind,
      verb: n.verb || '',
      locked: true,
      why: n.why || '',
    })
    // 下一拍要等这一拍真的让出 L0 才能开始。
    // 只加 span 会让按住段（hold）被下一拍从中间切断——L0 只有一层，
    // 后一条 cue 一进来前一条的循环就被顶掉，观感是动作演到一半突然跳走。
    // 实测「先喝口水，然后接着写代码」：语音 8 秒时喝水按住到 8 秒，
    // 但写代码被排在 2.3 秒，等于喝水只演了四分之一。
    cursor += span + hold
  }

  for (const c of ambient) {
    if (c && c.slot) cues.push(Object.assign({ at: Number(c.at) || 0 }, c))
  }

  if (!cues.length && notes.length === 0) notes.push('没有要演的东西')
  return { cues, notes }
}

/** 给日志用：一句话说清这一轮排了什么，出问题时不用去翻四层。 */
export function describeArrangement(cues) {
  const anims = (Array.isArray(cues) ? cues : []).filter((c) => c && c.slot === 'animations')
  if (!anims.length) {
    const trip = (Array.isArray(cues) ? cues : []).find((c) => c && c.slot === 'trip')
    return trip ? '离座 ' + trip.id : '（无动作）'
  }
  return anims.map((c) => (c.verb || String(c.id).replace(/^anim_/, '')) + '(' + c.durationMs + 'ms' + (c.holdMs ? '+按' + c.holdMs + 'ms' : '') + ')').join(' → ')
}
