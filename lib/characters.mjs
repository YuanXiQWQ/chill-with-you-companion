/**
 * 角色卡（character card）存储与激活。
 *
 * 为什么要有这一层：0.5.0 之前「人设」只是 `persona.md` 一个纯文本文件，
 * 「剧情」散在记忆库 facts 里，声音/动作映射又写死在配置里——换角色等于改代码。
 * 现在一个角色 = 一张卡：
 *
 *   data/characters/<id>.json
 *   data/characters/_active.json    { "id": "satone" }
 *
 * 卡片里同时装：人设正文（persona）+ 剧情与设定（lore）+ 声音（voice）
 * + 可选的情绪动作覆盖（actionMap / emotionSet）。一个东西只管一个角色，
 * 加第二个角色 = 复制一张卡 + activate，不需要动 brain.mjs。
 *
 * lore 条目：
 *   { id, title, tags[], always, text }
 *   always=true 的条目每轮都进提示词（世界观硬设定，控制在 1200 字内）；
 *   其余按当轮话题做 bigram 匹配取 top-k（剧情碎片，聊到才提）。
 */
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// 本机只有 PowerShell 5.1，写 json 会带 UTF-8 BOM，而 JSON.parse 不剥它：
// 一度"被 PowerShell 碰过的文件"全被当成损坏（角色卡消失、配置回默认、记忆首行丢失）。
const stripBom = (s) => (typeof s === 'string' && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const ACTIVE_FILE = '_active.json'
export const CARD_SCHEMA = 1

const clampText = (s, max) => String(s == null ? '' : s).replace(/\r\n/g, '\n').slice(0, max)

/** 中文按 2-gram、英文数字按词切：够用且不引依赖。 */
function grams(text) {
  const s = String(text || '').toLowerCase()
  const out = new Set()
  for (const w of s.match(/[a-z0-9]{2,}/g) || []) out.add(w)
  const cjk = s.replace(/[^\u3400-\u4dbf\u4e00-\u9fff]/g, '')
  for (let i = 0; i + 1 < cjk.length; i += 1) out.add(cjk.slice(i, i + 2))
  return out
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0
  let hit = 0
  for (const g of a) if (b.has(g)) hit += 1
  return hit / Math.sqrt(a.size * b.size)
}

function normalizeLore(raw, index) {
  const item = raw && typeof raw === 'object' ? raw : { text: raw }
  const text = clampText(item.text, 1200).trim()
  if (!text) return null
  return {
    id: String(item.id || `lore-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `lore-${index + 1}`,
    title: clampText(item.title, 60).trim(),
    tags: Array.isArray(item.tags) ? item.tags.map((t) => String(t).slice(0, 20)).slice(0, 6) : [],
    always: Boolean(item.always),
    text,
  }
}

function normalizeCard(raw, fallbackId) {
  // 文件名是唯一真相：卡内 id 跟文件名不一致时（手改、复制卡），
  // 以前会把 activeId 写成卡内的 id，_active.json 指向不存在的文件，人设静默退回默认，
  // 面板却报"已切换角色"。
  const id = String(fallbackId || raw?.id || '').trim()
  const card = {
    schema: CARD_SCHEMA,
    id,
    name: clampText(raw?.name, 40).trim() || id,
    nameJa: clampText(raw?.nameJa, 40).trim(),
    alias: Array.isArray(raw?.alias) ? raw.alias.map((a) => String(a).slice(0, 24)).slice(0, 8) : [],
    tagline: clampText(raw?.tagline, 120).trim(),
    accent: /^#[0-9a-fA-F]{3,8}$/.test(String(raw?.accent || '')) ? String(raw.accent) : '#7c8cff',
    avatar: clampText(raw?.avatar, 200).trim(),
    voice: raw?.voice && typeof raw.voice === 'object' ? {
      refAudio: clampText(raw.voice.refAudio, 400).trim(),
      promptLang: clampText(raw.voice.promptLang, 8).trim() || 'ja',
      textLang: clampText(raw.voice.textLang, 8).trim() || 'ja',
      speedFactor: Number(raw.voice.speedFactor) || 1.0,
    } : null,
    emotionSet: raw?.emotionSet === 'base8' ? 'base8' : 'extended',
    actionMap: raw?.actionMap && typeof raw.actionMap === 'object' ? raw.actionMap : null,
    persona: clampText(raw?.persona, 12000).trim(),
    lore: (Array.isArray(raw?.lore) ? raw.lore : []).map(normalizeLore).filter(Boolean).slice(0, 80),
    builtin: Boolean(raw?.builtin),
    version: Number(raw?.version) || 1,
    updatedAt: String(raw?.updatedAt || ''),
  }
  return card
}

/** 给面板看的摘要（不含正文，避免一次拉几十 KB）。 */
function summaryOf(card) {
  return {
    id: card.id,
    name: card.name,
    nameJa: card.nameJa,
    tagline: card.tagline,
    accent: card.accent,
    avatar: card.avatar,
    builtin: card.builtin,
    personaChars: card.persona.length,
    loreCount: card.lore.length,
    alwaysCount: card.lore.filter((l) => l.always).length,
    voiceLangs: card.voice ? `${card.voice.promptLang}/${card.voice.textLang}` : '',
    updatedAt: card.updatedAt,
  }
}

/**
 * @param {{
 *   dir: string,
 *   log?: (...a:any[])=>void,
 *   defaultId?: string,
 *   seedPersona?: string,
 *   seedLore?: Array<object>,
 *   seedName?: string,
 * }} opts
 */
export function createCharacters(opts = {}) {
  const dir = opts.dir
  const log = opts.log || (() => {})
  const defaultId = String(opts.defaultId || 'satone')
  const cache = new Map()   // id -> { mtimeMs, card }
  let activeId = ''

  const cardPath = (id) => join(dir, `${id}.json`)
  const activePath = join(dir, ACTIVE_FILE)

  const writeJson = async (path, value) => {
    const tmp = `${path}.tmp`
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
    await rename(tmp, path)
  }

  const readCard = async (id) => {
    if (!ID_RE.test(String(id || ''))) return null
    try {
      const info = await stat(cardPath(id))
      const hit = cache.get(id)
      if (hit && hit.mtimeMs === info.mtimeMs) return hit.card
      const raw = JSON.parse(stripBom(await readFile(cardPath(id), 'utf8')))
      const card = normalizeCard(raw, id)
      cache.set(id, { mtimeMs: info.mtimeMs, card })
      return card
    } catch {
      return null
    }
  }

  /** seedPersona 允许是函数（首次启动现读 persona.md），别把函数体当正文写进卡里。 */
  const seedPersonaText = async () => {
    const v = typeof opts.seedPersona === 'function' ? await opts.seedPersona() : opts.seedPersona
    const text = String(v || '').trim()
    return text || '你是聪音，安静、温和、说话很短。'
  }

  const ensureDefaults = async () => {
    await mkdir(dir, { recursive: true })
    let ids = []
    try {
      ids = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== ACTIVE_FILE).map((f) => f.slice(0, -5))
    } catch {
      ids = []
    }
    if (ids.length === 0) {
      const seed = normalizeCard({
        id: defaultId,
        name: opts.seedName || '聪音',
        nameJa: 'さとね',
        tagline: '理工科三年级，在写科幻小说，偶尔抬头看你一眼。',
        accent: '#e05a5a',
        persona: await seedPersonaText(),
        lore: opts.seedLore || [],
        builtin: true,
        updatedAt: new Date().toISOString(),
      }, defaultId)
      await writeJson(cardPath(seed.id), seed)
      log('seeded default character card', { id: seed.id, chars: seed.persona.length })
    }
    if (!activeId) {
      try {
        const raw = JSON.parse(stripBom(await readFile(activePath, 'utf8')))
        const id = String(raw?.id || '')
        if (ID_RE.test(id) && (await readCard(id))) activeId = id
      } catch { /* 还没有 _active.json */ }
      if (!activeId) {
        const fallback = (await readCard(defaultId)) ? defaultId : (ids[0] || defaultId)
        activeId = fallback
        await writeJson(activePath, { id: activeId })
      }
    }
    return activeId
  }

  const list = async () => {
    await ensureDefaults()
    let ids = []
    try {
      ids = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== ACTIVE_FILE).map((f) => f.slice(0, -5))
    } catch { ids = [] }
    const cards = []
    for (const id of ids.sort()) {
      const card = await readCard(id)
      if (card) cards.push(Object.assign(summaryOf(card), { active: id === activeId }))
    }
    return { active: activeId, list: cards }
  }

  const get = async (id) => readCard(id)

  const active = async () => {
    await ensureDefaults()
    return (await readCard(activeId)) || null
  }

  const persona = async () => {
    const card = await active()
    if (card && card.persona) return card.persona
    return seedPersonaText()
  }

  const activate = async (id) => {
    const card = await readCard(id)
    if (!card) return null
    activeId = card.id
    await writeJson(activePath, { id: activeId })
    log('character activated', { id: activeId })
    return card
  }

  const save = async (id, patch = {}) => {
    const current = await readCard(id)
    if (!current) return null
    const next = normalizeCard(Object.assign({}, current, patch, {
      id,
      updatedAt: new Date().toISOString(),
      version: (current.version || 1) + 1,
    }), id)
    await writeJson(cardPath(id), next)
    cache.delete(id)
    return next
  }

  const create = async (input = {}) => {
    const raw = String(input.id || '').trim().toLowerCase()
    // 非法字符直接报错，不静默替换成 '-'：用户输入 "BAD ID!" 时更该看到提示，
    // 而不是得到一个叫 bad-id- 的怪卡片。
    if (!/^[a-z0-9_-]+$/.test(raw)) return { error: 'id 只能用 a-z 0-9 _ -，2–32 个字符' }
    const id = raw.slice(0, 32)
    if (!ID_RE.test(id)) return { error: 'id 只能用 a-z 0-9 _ -，2–32 个字符' }
    if (await readCard(id)) return { error: '这个 id 已经存在' }
    const card = normalizeCard({
      id,
      name: input.name || id,
      tagline: input.tagline || '（新角色，先写人设）',
      avatar: input.avatar || ('avatars/' + id + '.png'),
      accent: input.accent || '#7c8cff',
      persona: input.persona || '你是「' + (input.name || id) + '」。先在这里写清楚：你是谁、在哪、怎么说话。',
      lore: [],
      builtin: false,
      updatedAt: new Date().toISOString(),
    }, id)
    await writeJson(cardPath(id), card)
    cache.delete(id)
    log('character created', { id })
    return { card }
  }

  /**
   * 给提示词用的 lore 块：
   * always 条目全上（世界观硬设定），其余按当轮话题匹配取 top-k。
   */
  const loreBlock = async (text, { k = 4, maxChars = 1400, alwaysMax = 1200 } = {}) => {
    const card = await active()
    if (!card || !card.lore.length) return ''
    const always = card.lore.filter((l) => l.always)
    const rest = card.lore.filter((l) => !l.always)
    const lines = []
    let used = 0
    for (const item of always) {
      const line = (item.title ? `【${item.title}】` : '') + item.text
      if (used + line.length > alwaysMax) break
      lines.push(line)
      used += line.length
    }
    const q = grams(text)
    const scored = rest
      .map((item) => ({ item, score: overlap(q, grams(item.title + ' ' + item.text)) }))
      .filter((x) => x.score >= 0.06)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, k))
    for (const { item } of scored) {
      const line = (item.title ? `【${item.title}】` : '') + item.text
      if (used + line.length > maxChars) break
      lines.push(line)
      used += line.length
    }
    return lines.join('\n')
  }

  const stats = async () => {
    const data = await list()
    return {
      active: data.active,
      count: data.list.length,
      ids: data.list.map((c) => c.id),
    }
  }

  return { dir, ensureDefaults, list, get, active, persona, activate, save, create, loreBlock, stats }
}
