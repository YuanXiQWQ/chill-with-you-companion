// 第一步：把"他这一句 + 模型这一轮的回复"翻译成**编排需求**。
//
// 这一层只回答"这一轮她欠世界哪几件事"，不排时间、不拼片段、不碰时长——
// 那是 arrange 的事。分家的理由：以前这几件事混在 buildSuite / planSequence /
// chainStartToLoop / buildCueItem 四处各做一半，谁都能改写谁的结果，出问题时
// 只能靠日志猜是哪一层干的。现在每条需求带 `why`，一眼能看到是哪条规则在起作用。
//
// 需求的种类只有五种：
//   core       这句话的核心行为（喝茶 / 打哈欠 / 敲键盘），一族整段演
//   reaction   对他这句话的反应（点头 / 害羞 / 笑），一两秒，不占主时间
//   companion  他说他在做事，她陪着做自己那份（不算镜像）
//   ambient    模型给的非动作槽（表情 / 语气），原样带下去
//   trip       她要离开椅子——独占，别的一律不做
import { decideCore, mergeSegments, spanOf } from './director.js'
import { subjectOf, isAboutHim } from './subject.js'
import { classifyClip, isOffChair, MOTION_CLASS } from './motion-class.js'
import { decideTrip } from './seat-trip.js'
import { ACTIONS, COMPANION_VERBS, CONTAGIOUS, isHisBody, isContagiousFamily } from './actions.js'
import { applyMode, modeOf } from './director-mode.js'

// 陪伴 / 传染 / 他的身体 三组判断全部来自 actions.js，这里不再手抄第二份。
// （从前 COMPANION_VERBS 和 director 的 SHARED 一字不差，HIS_BODY 也有两份正则。）

// 起手的小反应只在内容对得上时才留：累瘫了先"调皮一下"再瘫，比不演还怪。
const REACT_OK = /好|嗯|对|同意|赞成|害羞|不好意思|笑|哈哈|想想/

const BAD_REACT = /fun|laugh|surprise/

function need(kind, family, extra = {}) {
  return {
    kind,
    who: extra.who || 'her',
    family: String(family || ''),
    verb: extra.verb || '',
    label: extra.label || String(family || '').replace(/^anim_/, ''),
    // 清单里的真名。纯数字 id 只能靠它分类，否则专注态会被当成身体动作删掉。
    name: extra.name || '',
    // 陪伴类（他在做，她陪着做自己那份）就是"她眼下在做的事"，和 core 同级。
    // 早先这里只认 kind === 'core'，陪伴于是落到 tail + prio 10；
    // 而 arrange 又把 companion 当 core 演、并且按 anchor/prio 排序。
    // 两层口径不一致的直接后果：「我想看会儿书，然后伸个懒腰」
    // 被排成先伸懒腰再看书（伸懒腰 prio 90 压过看书的 10），和句子顺序正好相反。
    anchor: extra.anchor || (kind === 'core' || kind === 'companion' ? 'core' : kind === 'reaction' ? 'lead' : 'tail'),
    hold: Number(extra.hold) || 0,
    prio: Number(extra.prio) || (kind === 'core' || kind === 'companion' ? 100 : kind === 'reaction' ? 40 : 10),
    source: extra.source || 'text',
    why: extra.why || '',
  }
}

/**
 * @param {object} input
 * @param {string} input.text        他这一句
 * @param {Array}  input.cues        模型这一轮给的动作（可能已拆成 _start/_loop/_end）
 * @param {number} input.speechMs    这一句语音多长（给 arrange 算窗口用）
 * @param {string} input.phase       'focus' 时只做头部动作
 * @returns {{needs: Array, trip: object|null, dropped: Array, ambient: Array, notes: Array}}
 */
export function extractNeeds(input = {}) {
  const text = String(input.text || '')
  const cues = mergeSegments(Array.isArray(input.cues) ? input.cues : [])
  const animCues = cues.filter((c) => c && c.slot === 'animations' && c.id)
  const ambient = cues.filter((c) => c && c.slot !== 'animations')
  // id -> 清单名。纯数字 id 交给分类器只会得到 unknown，专注态就会被当成
  // "要动身体"删掉；有了名字才能正确判断它其实是个小反应。
  const nameByFam = new Map()
  for (const c of animCues) {
    const f = String(c.id).replace(/_(start|loop|end)$/, '')
    if (f && c.name) nameByFam.set(f, String(c.name))
  }
  const hisOnly = isAboutHim(text)

  const needs = []
  const dropped = []
  const notes = []
  const drop = (n, why) => dropped.push(Object.assign({}, n, { why }))

  // ── 离座：先判，因为它独占整轮 ──────────────────────────────────
  // 这里只回答"这句话是不是要她起身"，冷却与空闲由上层决定要不要真的执行
  // （都不通过时这一轮照常编排，不是把动作全丢掉）。
  const trip = decideTrip(text)

  // ── 核心行为：由语句决定，不从模型手里接 ────────────────────────
  // includeHis：把"他说他自己"的动词也报出来，谁来做是这一层的事。
  const decided = decideCore(text, animCues, { includeHis: true })
  const core = decided.core
  if (core) {
    // from='cue' 时核心是从模型给的第一条动作倒推的，没有 atChar 可以定位主语。
    // 那时候用整句兜底：整句都在说他（有"我"没"你"），就按"他的身体"处理。
    // from='cue'：核心是模型直接给的动作，不是从这句话里判出来的行为。
    // 主语规则是用来否决"他说自己累/困"这类文本推断的；模型已经替我们决定了她要演什么，
    // 再用整句主语去否决，就会出现"模型给了动作，她反而一动不动"。
    const fromModel = decided.from === 'cue'
    const subj = fromModel
      ? 'none'
      : (core.subject || (core.atChar == null ? (hisOnly ? 'me' : 'none') : subjectOf(text, core.atChar)))
    const shared = COMPANION_VERBS.has(core.verb)
    const contagious = CONTAGIOUS.has(core.verb)
    if (core.noMotion) {
      // 她的睡意是游戏按"连续专注时长"自己累积出来的，到点了游戏自己送她进 BreakSleep。
      // 我们去切这个状态不但多余，还得先强行置 ActivateSleepFlg——那是在改游戏的状态位。
      // 所以这类动词只表示"我听懂你在说睡觉"，不产生任何动作。
      drop({ kind: 'core', family: core.family, verb: core.verb },
        '睡觉由游戏按连续专注时长自己触发，我们不主动切态')
    } else if (core.kind === 'activity' && !shared && !contagious && subj === 'me') {
      // 他自己的身体状态不锁成她的动作（累瘫 / 趴睡 / 揉肩）。
      drop({ kind: 'core', family: core.family, verb: core.verb }, '他说的是他自己，这一类不传染')
    } else {
      const kind = shared && subj === 'me' ? 'companion' : 'core'
      const why = shared && subj === 'me'
        ? `他在做这件事（${core.said || core.label}），她陪着做自己那份`
        : contagious && subj === 'me'
          ? `他说「${core.said || core.label}」，这种反应会传染，她也跟着`
          : `句子里有「${core.said || core.label}」，判成${core.kind === 'activity' ? '一件事' : '一个反应'}`
      needs.push(need(kind, core.family, {
        verb: core.verb,
        label: core.label,
        name: nameByFam.get(String(core.family)) || '',
        why,
      }))
      // 第二拍：「先喝口水，然后接着写」—— 喝水开场、写代码收尾
      const also = decided.also && decided.also[0]
      if (also && also.family !== core.family && !isOffChair(also.family) && !also.noMotion) {
        needs.push(need('core', also.family, {
          verb: also.verb,
          label: also.label,
          name: nameByFam.get(String(also.family)) || '',
          anchor: 'tail',
          prio: 90,
          why: `同一句里还有「${also.said || also.label}」，排在后面收尾`,
        }))
      }
    }
  }

  // ── 模型给的动作：过筛，留下的当反应或补充 ──────────────────────
  for (const c of animCues) {
    const fam = String(c.id).replace(/_(start|loop|end)$/, '')
    if (!fam) continue
    if (isOffChair(fam)) {
      drop({ kind: 'reaction', family: fam }, '离座类不进编排，她始终坐在椅子上')
      continue
    }
    const isBody = isHisBody(fam)
    if (isBody && hisOnly && !isContagiousFamily(fam)) {
      drop({ kind: 'reaction', family: fam }, '他在说自己的身体，这一类不传染，不跟着做')
      continue
    }
    if (core && fam === String(core.family)) {
      drop({ kind: 'reaction', family: fam }, '和主戏是同一族，已经排过了')
      continue
    }
    if (needs.some((n) => n.family === fam)) {
      drop({ kind: 'reaction', family: fam }, '这一族已经排过')
      continue
    }
    // 有清单名就按名字分类：纯数字 id 分类器认不出，会被误判成身体动作。
    const cls = classifyClip(c.name || fam)
    if (cls === MOTION_CLASS.GESTURE) {
      // 手势是对他说的话的反应，永远允许；但不是主角时只当起手。
      const asLead = !core && !BAD_REACT.test(fam)
      const okLead = core && core.kind === 'activity' && REACT_OK.test(text) && !BAD_REACT.test(fam)
      if (core && !okLead) {
        // 有主戏时，内容对不上的手势不再抢开头
        drop({ kind: 'reaction', family: fam }, '有主戏要演，这条手势不抢开头')
        continue
      }
      needs.push(need('reaction', fam, {
        name: c.name || '',
        anchor: asLead || okLead ? 'lead' : 'tail',
        source: 'model',
        why: core ? '内容对得上，先接一个小反应再进正题' : '模型给的反应动作，没有核心要演',
      }))
      continue
    }
    // 其余模型动作：没有核心时它就是主角，有核心时最多当收尾。
    if (!core) {
      needs.push(need('core', fam, {
        name: c.name || '',
        anchor: 'core',
        prio: 60,
        source: 'model',
        why: '句子里没判出核心行为，模型给的就是全部信息',
      }))
    } else {
      drop({ kind: 'reaction', family: fam }, '已经有主戏，这条不插队')
    }
  }

  // 按模式整理：正常态不限；专注/休息只放上身能演的，演不了的换替代；
  // 她已经睡了就一拍都不排（游戏按连续专注时长送她进去的，不能吵醒）。
  // 模式是**规划时的输入**，不是演完再剪——早先那样做，预算全花在不能演的素材上，
  // 实测十条里空六条。
  const mode = input.mode || modeOf(input)
  applyMode(needs, mode, {
    note: (m) => notes.push(m),
    drop: (d) => dropped.push(d),
  })
  return { needs, trip, dropped, ambient, notes, core, mode: mode.name }
}

/** 排完的最后一道自查：一族只能出现一次，离座类不许混进来。 */
export function auditNeeds(needs) {
  const seen = new Set()
  const out = []
  for (const n of Array.isArray(needs) ? needs : []) {
    if (!n || !n.family) continue
    if (isOffChair(n.family)) continue
    const key = n.family
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

export { COMPANION_VERBS, spanOf }
