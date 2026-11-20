/**
 * 资源受限层（Resource-Constrained Direction）。
 *
 * 目标：DS 端能"指挥"游戏，但**只能使用游戏自身的资源**。
 * 做法：游戏端把自身资源清单（动作/场景/音效/语音片段/BGM）上报给大脑，
 *      大脑把它压成 prompt 里的白名单，并对模型返回的每条表演指令做**硬校验**：
 *      不在清单里的 id、越界的时序、超量的指令，一律剪掉，绝不下发到游戏。
 *
 * 于是"只用游戏本身资源"不是靠提示词求模型自觉，而是靠代码保证。
 */

import { classifyClip } from './motion-class.js'

export const EMPTY_MANIFEST = Object.freeze({
  version: 1,
  animations: [],
  chairs: [],
  deskObjects: [],
  pen: [],
  cameras: [],
  scenes: [],
  sfx: [],
  voiceClips: [],
  bgm: [],
})

/** 表演槽位 → manifest 字段（游戏里真实存在的控制器各自成槽） */
export const SLOT_ALIAS = Object.freeze({
  anim: 'animations',
  animation: 'animations',
  animations: 'animations',
  chair: 'chairs',
  chairs: 'chairs',
  desk: 'deskObjects',
  deskobject: 'deskObjects',
  deskObjects: 'deskObjects',
  pen: 'pen',
  camera: 'cameras',
  cameras: 'cameras',
  scene: 'scenes',
  scenes: 'scenes',
  sfx: 'sfx',
  sound: 'sfx',
  voice: 'voiceClips',
  voiceclip: 'voiceClips',
  voiceClips: 'voiceClips',
  bgm: 'bgm',
  music: 'bgm',
})

export const PERFORMANCE_SLOTS = Object.freeze([
  'animations', 'chairs', 'deskObjects', 'pen', 'cameras', 'scenes', 'sfx', 'voiceClips', 'bgm',
])

const MAX_ENTRIES = 512

const asArray = (value) => (Array.isArray(value) ? value : [])
const asString = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback)

function normalizeEntry(entry) {
  if (entry === null || typeof entry !== 'object') return null
  const id = entry.id
  if (typeof id !== 'string' && typeof id !== 'number') return null
  const strId = String(id).trim()
  if (strId === '') return null
  const semantic = asArray(entry.semantic)
    .map((s) => asString(s))
    .filter(Boolean)
    .slice(0, 8)
  return {
    id: strId,
    name: asString(entry.name, strId),
    semantic,
    loop: entry.loop === true,
    durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.round(entry.durationMs)) : null,
    seat: asString(entry.seat) || null,
    text: asString(entry.text) || null,
    lang: asString(entry.lang) || null,
  }
}

/** 校验并规整游戏端上报的清单；脏数据丢弃而不是崩掉。 */
export function normalizeManifest(raw) {
  const manifest = { ...EMPTY_MANIFEST, version: 1 }
  if (raw === null || typeof raw !== 'object') return manifest
  for (const slot of PERFORMANCE_SLOTS) {
    const seen = new Map()
    for (const entry of asArray(raw[slot]).slice(0, MAX_ENTRIES)) {
      const normalized = normalizeEntry(entry)
      if (normalized === null) continue
      if (!seen.has(normalized.id)) seen.set(normalized.id, normalized)
    }
    manifest[slot] = [...seen.values()]
  }
  manifest.generatedAt = asString(raw.generatedAt) || null
  manifest.source = asString(raw.source) || null
  return manifest
}

export function manifestSize(manifest) {
  const counts = {}
  for (const slot of PERFORMANCE_SLOTS) counts[slot] = asArray(manifest?.[slot]).length
  counts.total = PERFORMANCE_SLOTS.reduce((sum, slot) => sum + counts[slot], 0)
  return counts
}

/** 每个槽位的 id 集合，校验用。 */
export function indexManifest(manifest) {
  const index = new Map()
  for (const slot of PERFORMANCE_SLOTS) {
    index.set(slot, new Set(asArray(manifest?.[slot]).map((entry) => String(entry.id))))
  }
  return index
}

/**
 * 压成 prompt 里的一段白名单说明。
 * 只给 id + 语义 + 时长，绝不给全量原始 JSON（token 会炸）。
 */
/**
 * 动作属于哪个部位。
 *
 * 用 `_` 拆开的整段 token 比对，不做子串匹配——`suspense` 里有 pen、
 * `lookpenguin` 里也有 pen，子串匹配会把它们都判成手部动作。
 *
 * 用途：一句话里两个头部动作叠加，头就会抖。其余部位目前不硬管。
 */
const HEAD_TOKENS = new Set(["nod","shakehead","thinking","thinking1","look","lookaround","lookpenguin","glance","sigh","wakeup","introduce","camera","glasses","deep"])
export function partOf(id) {
  const tk = String(id || '').replace(/^anim_/, '').replace(/_(start|loop|end)$/, '').split('_')
  const last = tk[tk.length - 1] || ''
  if (HEAD_TOKENS.has(last)) return 'head'
  for (const k of ['nod', 'shakehead', 'look', 'glance', 'thinking', 'glasses', 'sigh', 'deep']) {
    if (last.startsWith(k)) return 'head'
  }
  return 'other'
}

const CLASS_TAG = { gesture: 'g', prop: 'p', posture: 'P', locomotion: 'l', idle: 'i', unknown: 'u' }
const classTagOf = (id) => CLASS_TAG[classifyClip(id)] || 'u'

export function summarizeForPrompt(manifest, options = {}) {
  const budget = Number.isFinite(options.budget) ? options.budget : 1200
  const perSlot = Number.isFinite(options.perSlot) ? options.perSlot : 40
  const lines = []
  const label = {
    animations: 'anim（身体动作）',
    chairs: 'chair（椅子/坐姿控制器）',
    deskObjects: 'desk（桌面物件）',
    pen: 'pen（笔）',
    cameras: 'camera（镜头）',
    scenes: 'scene（场景）',
    sfx: 'sfx（音效）',
    voiceClips: 'voice（游戏自带语音片段）',
    bgm: 'bgm（音乐）',
  }
  // 表演动作排在前面：模型对清单的偏好几乎就是顺序偏好。
  // 352 条里前 40 条原本全是 work_pc / break_movie 这类场景循环，
  // 真正的 shy / jump / dropshoulders / presshands 全被挤出预算，
  // 结果它每一轮只会点头（2026-11-13 修）。
  // 有 _start 的动作就有进入过渡，能平滑接进接出；再带 _loop 的还能一直保持到说完。
  // 单段表情只有 1.5–2 秒，二十个字念四五秒，演完就僵住不动——所以带 start 的排最前。
  const startOf = (id) => {
    const hit = String(id || '').match(/^(.*)_start$/)
    return hit ? hit[1] : ''
  }
  const isTriple = (e) => Boolean(startOf(e?.id))   // 名字沿用，含义是「有过渡段」
    // break_tea_sub_maker 是完整泡咖啡流程（start 8667ms、整组 17.7 秒），
  // 不是「边说边做」的动作，别让模型挑到它。
  const isPerf = (e) => !/work_pc|break_movie|break_tea_sub_maker/.test(String(e?.id || ''))
  // _end 是动作的退出段，播完自动回 base，列出来只会让它多选一次没用的东西。
  const isEnd = (e) => /_end$/.test(String(e.id))
  for (const slot of PERFORMANCE_SLOTS) {
    const all = asArray(manifest?.[slot])
    if (all.length === 0) continue
    const entries = slot === 'animations'
      ? [
          // 场景类（work_pc 用电脑 / break_movie 看电影）排在最后：她平时是在工位说话，
          // 选到「看电影时笑」这种动作会跟场景打架。三段式仍优先于单段。
          ...all.filter((e) => isPerf(e) && isTriple(e)),
          ...all.filter((e) => isPerf(e) && !isTriple(e)),
          ...all.filter((e) => !isPerf(e) && isTriple(e)),
          ...all.filter((e) => !isPerf(e) && !isTriple(e)),
        ].filter((e) => !isEnd(e))
      : all
    const parts = []
    for (const entry of entries.slice(0, perSlot)) {
      const tags = entry.semantic.length > 0 ? entry.semantic.join('/') : entry.name
      const dur = isTriple(entry)
        ? 'full'
        : entry.loop ? 'loop' : entry.durationMs !== null ? `${(entry.durationMs / 1000).toFixed(1)}s` : ''
      parts.push([entry.id, tags, slot === 'animations' ? classTagOf(entry.id) : '', dur].filter(Boolean).join(':'))
    }
    const more = entries.length > perSlot ? ` …（另有 ${entries.length - perSlot} 条未列出，不要凭空编造 id）` : ''
    lines.push(`- ${label[slot]} = ${parts.join(' | ')}${more}`)
  }
  if (lines.length === 0) return ''
  // 类别图例不参与截断：清单常被 budget 切短，图例必须始终在（否则模型不知道 g/p/P/l 是什么）
  const legend = '- 动作类别缩写：g=手势（反应类） p=道具（喝/吃/写/敲键盘/翻书） P=姿态（起身/躺下/伸懒腰/打哈欠） l=位移（走/离座/过去） i=待机循环 u=未分类'
  let text = lines.join('\n')
  if (text.length > budget) text = text.slice(0, budget) + '\n…（清单过长已截断，只能用上面出现过的 id）'
  text = text + '\n' + legend
  return text
}

/**
 * 硬校验模型给出的表演指令。
 * 返回 {cues, dropped}：cues 是能安全下发到游戏的，dropped 说明每条为什么被剪。
 */
export function sanitizePerformance(list, manifest, options = {}) {
  const maxCues = Number.isFinite(options.maxCues) ? options.maxCues : 6
  const maxAtMs = Number.isFinite(options.maxAtMs) ? options.maxAtMs : 60000
  const index = indexManifest(manifest)
  // 数字 id 对分类器没有任何信息量（classifyClip('1001') 只能得到 unknown），
  // 而 unknown 在专注态会被当成"要动身体"直接删掉——模型明明给了动作，她却不演。
  // 这里把清单里的名字带上，下游按名字分类，id 仍原样下发给游戏端。
  const nameOf = new Map()
  for (const slot of PERFORMANCE_SLOTS) {
    for (const entry of asArray(manifest?.[slot])) {
      if (entry && entry.id !== undefined && entry.name) {
        nameOf.set(slot + '|' + String(entry.id), String(entry.name))
      }
    }
  }
  const cues = []
  const dropped = []
  const seen = new Set()

  const source = asArray(list)
  for (let i = 0; i < source.length; i += 1) {
    const raw = source[i]
    if (raw === null || typeof raw !== 'object') {
      dropped.push({ index: i, reason: 'not-an-object' })
      continue
    }
    const slotKey = asString(raw.slot).toLowerCase()
    const slot = SLOT_ALIAS[slotKey]
    if (!slot) {
      dropped.push({ index: i, reason: `unknown-slot:${slotKey || 'empty'}` })
      continue
    }
    const id = String(raw.id ?? '').trim()
    if (id === '') {
      dropped.push({ index: i, reason: 'missing-id' })
      continue
    }
    if (!index.get(slot).has(id)) {
      dropped.push({ index: i, reason: `id-not-in-game-assets:${slot}:${id}` })
      continue
    }
    // at 允许两种写法：0–1 的小数＝说到几成（模型不用猜毫秒），大于 1 的当毫秒。
    // 这里原样保留，换算在 buildCueItem 拿到真实语音时长之后做。
    const at = Number.isFinite(raw.at) ? raw.at : 0
    if (at < 0 || at > maxAtMs) {
      dropped.push({ index: i, reason: `at-out-of-range:${at}` })
      continue
    }
    const key = `${slot}|${id}|${at}`
    if (seen.has(key)) {
      dropped.push({ index: i, reason: 'duplicate' })
      continue
    }
    seen.add(key)
    cues.push({
      slot,
      id,
      at,
      name: nameOf.get(slot + '|' + id) || null,
      durationMs: Number.isFinite(raw.durationMs) ? Math.max(0, Math.round(raw.durationMs)) : null,
      text: asString(raw.text) || null,
      // 模型自己写的一句理由，只用来诊断"编排是不是真的跟着台词走"。
      why: asString(raw.why) || null,
    })
  }

  cues.sort((a, b) => a.at - b.at)
  if (cues.length > maxCues) {
    for (const extra of cues.splice(maxCues)) {
      dropped.push({ index: -1, reason: `over-budget:${extra.slot}:${extra.id}`, cue: extra })
    }
  }
  return { cues, dropped }
}

/** 模型没给表演指令时的兜底：用情绪 → 动作映射表产出一条。 */
export function emotionFallbackCues(emotion, actionMap, manifest) {
  const id = actionMap?.[emotion]
  if (id === undefined || id === null) return []
  const known = indexManifest(manifest).get('animations')
  if (known.size > 0 && !known.has(String(id))) return []
  return [{ slot: 'animations', id: String(id), at: 0, durationMs: null, text: null }]
}
