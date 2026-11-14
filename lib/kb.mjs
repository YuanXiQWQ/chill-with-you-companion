/**
 * 外挂知识库 —— 让聪音"学会"技能与领域知识。
 *
 * 一份知识库 = 一组纯文本文档（md/txt 都行），按库分开，可以整体启停。
 * 每次说话前按当轮用户输入做一次检索，命中的片段拼进 system 上下文，
 * 所以她聊到"怎么冲咖啡""大纲怎么写"能接住，而不用把这些塞进人设里。
 *
 * 检索不用向量：中文按 bigram、英文按单词建倒排索引，BM25 打分。
 * 没有外部依赖、没有 embedding 服务、几千个片段也能在毫秒级出结果。
 *
 * 目录结构：
 *   data/kb/<libId>/library.json      { id, name, note, enabled, docs:[{id,name,chars,...}] }
 *   data/kb/<libId>/docs/<docId>.txt  文档原文
 */

import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

// 本机只有 PowerShell 5.1，写 json 会带 UTF-8 BOM，而 JSON.parse 不剥它：
// 一度"被 PowerShell 碰过的文件"全被当成损坏（角色卡消失、配置回默认、记忆首行丢失）。
const stripBom = (s) => (typeof s === 'string' && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const MAX_DOC_CHARS = 400_000
const MAX_DOCS = 500
const CHUNK_TARGET = 320
const CHUNK_OVERLAP = 40
const BM25_K1 = 1.2
const BM25_B = 0.75

function clampText(v, max) {
  return String(v == null ? '' : v).replace(/\r\n/g, '\n').slice(0, max)
}

function makeId(raw, fallback) {
  const id = String(raw || '').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  // 纯中文标题清洗后经常只剩扩展名（"笔记.md" → "md"），那种直接换随机 id
  if (ID_RE.test(id) && id.length >= 3) return id
  return fallback
}

/** 中英混合分词：中文取 bigram（单字也留一份），英文/数字取整词。 */
const STOP = new Set([
  '的', '了', '是', '在', '和', '有', '就', '不', '也', '这', '那', '我', '你', '他', '她', '它', '们',
  '吗', '呢', '吧', '啊', '么', '什', '怎', '要', '会', '能', '把', '被', '给', '对', '从', '到', '与',
  '什么', '怎么', '多少', '可以', '一个', '我们', '你们', '他们', '因为', '所以', '但是', '如果',
  '现在', '时候', '这个', '那个', '这样', '那样', '的话', '还是', '就是', '没有', '不能', '可能',
  '一个', '一些', '这种', '那种', '以及', '并且', '而且', '然后', '还有', '比较', '非常', '一点',
])

/** 中英混合分词：中文取 bigram（单字也留一份），英文/数字取整词。 */
export function tokenize(text) {
  const out = []
  const s = String(text || '').toLowerCase()
  // 版本号 / 小数整体留下：3.0、4.7 这类写法检索时代号本身就是关键词，
  // 拆成单字符会被长度下限丢掉，于是「3.0 版本」只能靠「版本」二字去撞。
  const vers = s.match(/\d\.\d/g)
  if (vers) for (const v of vers) out.push(v)
  const latin = s.match(/[a-z0-9_]{2,}/g)
  if (latin) for (const w of latin) if (!STOP.has(w)) out.push(w)
  const han = s.match(/[\u4e00-\u9fa5]+/g)
  if (han) {
    for (const run of han) {
      if (run.length === 1) {
        if (!STOP.has(run)) out.push(run)
        continue
      }
      for (let i = 0; i + 1 < run.length; i += 1) {
        const bg = run.slice(i, i + 2)
        if (!STOP.has(bg)) out.push(bg)
      }
    }
  }
  const kana = s.match(/[\u3040-\u30ff]{2,}/g)
  if (kana) {
    for (const run of kana) for (let i = 0; i + 1 < run.length; i += 1) out.push(run.slice(i, i + 2))
  }
  return out
}

/** 超长文本按段落 / 句子切到 CHUNK_TARGET 上下。 */
function splitByLength(text) {
  const out = []
  let buf = ''
  const flush = () => {
    const t = buf.trim()
    if (t) out.push(t)
    buf = ''
  }
  for (let para of String(text).split(/\n{2,}/)) {
    para = para.trim()
    if (!para) continue
    if (para.length > CHUNK_TARGET * 1.4) {
      const sentences = para.split(/(?<=[。！？!?；;\.])\s*/)
      for (const sent of sentences) {
        if (!sent) continue
        if ((buf + sent).length > CHUNK_TARGET) flush()
        buf += sent
      }
      if (buf.length > CHUNK_TARGET) flush()
      continue
    }
    if ((buf + '\n' + para).length > CHUNK_TARGET) {
      flush()
      buf = para
    } else {
      buf = buf ? buf + '\n' + para : para
    }
  }
  flush()
  return out
}

/** 把一篇文档切成块：先按 Markdown 标题分节，节太长再按段落/句子切；块间留一点重叠。 */
/** 从块文本里取最高版本号（4.7 → 4.7）。取不到返回 0。
 *  用于检索时的时效倾斜：写进内容里的版本号越新，同样相关时排得越前。
 *  非版本类资料（没有 x.y 写法）拿到 0，完全不参与加权，行为与原来一致。 */
const VER_RE = /\b([1-9])\.([0-9])\b/g
export function maxVersion(text) {
  let best = 0
  const s = String(text || '')
  VER_RE.lastIndex = 0
  let m
  while ((m = VER_RE.exec(s)) !== null) {
    const v = Number(m[1]) + Number(m[2]) / 10
    if (v > best) best = v
  }
  return best
}

/** 时效权重斜率：每领先 1.0 个版本，分数乘 1 + 0.03。
 *  4.7 相对 3.0 约 ×1.05 —— 只做微倾斜，绝不推翻相关性差距。
 *  真正决定新旧取舍的是下面的并列裁决，不是这个系数。 */
const VER_WEIGHT = 0.03
/** 基准版本：低于它的不加权也不减权。 */
const VER_BASE = 3.0

/** 从文档开头读「核对至：YYYY-MM-DD」。取不到返回空串。
 *  这个日期只说明「内容核对到哪一天」，用来判断要不要重查，不参与检索排序。 */
const VERIFIED_RE = /核对至[：:]\s*(\d{4}-\d{2}-\d{2})/
export function extractVerifiedAt(text) {
  const m = String(text || '').match(VERIFIED_RE)
  return m ? m[1] : ''
}
export function chunkText(text) {  const clean = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  const sections = []
  let cur = ''
  for (const line of clean.split('\n')) {
    if (/^#{1,6}\s/.test(line.trim()) && cur.trim()) {
      sections.push(cur)
      cur = line + '\n'
    } else {
      cur += line + '\n'
    }
  }
  if (cur.trim()) sections.push(cur)

  // 长度不足 120 字的节（常见于只有标题的那一节）并到下一节里，
  // 否则一个纯标题的片段会因为"短"在 BM25 里排到正文前面。
  const chunks = []
  let pending = ''
  for (const sec of sections) {
    const body = sec.trim()
    if (!body) continue
    const merged = pending ? pending + '\n' + body : body
    if (merged.length < 30) {
      pending = merged
      continue
    }
    pending = ''
    if (merged.length <= CHUNK_TARGET * 1.5) chunks.push(merged)
    else chunks.push(...splitByLength(merged))
  }
  if (pending) {
    if (chunks.length) chunks[chunks.length - 1] += '\n' + pending
    else chunks.push(pending)
  }

  if (CHUNK_OVERLAP > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1]
      const tail = prev.slice(Math.max(0, prev.length - CHUNK_OVERLAP))
      if (!chunks[i].startsWith(tail)) chunks[i] = tail + chunks[i]
    }
  }
  return chunks
}

/** 首次启动时装上的默认能力包：让她开箱就能干点活，而不只是个聊天的。 */
const DEFAULT_PACKS = [
  {
    id: 'assistant',
    name: '工作助手',
    note: '默认能力包：把事情拆开、给结论、必要时才问',
    role: '工作上的事能直接上手：先说结论和能执行的步骤，再补一句为什么；写东西就给能用的版本；查资料就写清出处与不确定的地方。需求含糊时先按最合理的假设做一版，再问一句要不要调方向。不堆客套话，不把简单的事说复杂。',
    enabled: true,
  },
]

export function createKb({ dir, log = () => {} }) {
  let libs = null          // [{ id, name, note, role, enabled, docs:[{id,name,chars,addedAt}], chars }]
  let settings = null      // { mode: 'work' | 'chat' }
  let seeded = false
  let index = null         // { chunks:[{libId,libName,docId,docName,text,len,tf:Map}], df:Map, avgdl, N }
  let building = null

  const libDir = (id) => join(dir, id)
  const libFile = (id) => join(libDir(id), 'library.json')
  const docsDir = (id) => join(libDir(id), 'docs')
  const docFile = (libId, docId) => join(docsDir(libId), docId + '.txt')

  async function loadLibs() {
    if (libs) return libs
    libs = []
    let names = []
    try { names = await readdir(dir) } catch { names = [] }
    for (const name of names) {
      try {
        const raw = JSON.parse(stripBom(await readFile(libFile(name), 'utf8')))
        if (!raw || !raw.id) continue
        libs.push({
          id: raw.id,
          name: clampText(raw.name, 60) || raw.id,
          note: clampText(raw.note, 200),
          role: clampText(raw.role, 900),
          enabled: raw.enabled !== false,
          createdAt: raw.createdAt || '',
          docs: Array.isArray(raw.docs) ? raw.docs.map((d) => ({
            id: String(d.id || ''), name: clampText(d.name, 120), chars: Number(d.chars) || 0, addedAt: d.addedAt || '',
        verifiedAt: String(d.verifiedAt || ''),
        updatedAt: String(d.updatedAt || d.addedAt || ''),
          })).filter((d) => d.id) : [],
        })
      } catch { /* 坏库当不存在 */ }
    }
    libs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    if (!libs.length && !seeded) {
      seeded = true
      for (const d of DEFAULT_PACKS) {
        const lib = {
          id: d.id, name: d.name, note: d.note || '', role: d.role || '',
          enabled: d.enabled !== false, createdAt: new Date().toISOString(), docs: [],
        }
        try {
          await persistLib(lib)
          libs.push(lib)
        } catch (error) {
          log('kb: 默认包写入失败', String(error?.message || error))
        }
      }
      if (libs.length) log('kb: 已初始化默认能力包', { count: libs.length })
    }
    return libs
  }

  async function persistLib(lib) {
    await mkdir(docsDir(lib.id), { recursive: true })
    await writeFile(libFile(lib.id), JSON.stringify(lib, null, 2) + '\n', 'utf8')
  }

  async function buildIndex(force) {
    if (index && !force) return index
    if (building) return building
    building = (async () => {
      const list = await loadLibs()
      const chunks = []
      for (const lib of list) {
        if (!lib.enabled) continue
        for (const doc of lib.docs) {
          let text = ''
          try { text = await readFile(docFile(lib.id, doc.id), 'utf8') } catch { continue }
          for (const piece of chunkText(text)) {
            const tf = new Map()
            const tokens = tokenize(piece)
            for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
            chunks.push({ libId: lib.id, libName: lib.name, docId: doc.id, docName: doc.name, text: piece, len: tokens.length || 1, tf, ver: maxVersion(piece) })
          }
        }
      }
      const df = new Map()
      for (const c of chunks) for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1)
      const total = chunks.reduce((n, c) => n + c.len, 0)
      index = { chunks, df, N: chunks.length, avgdl: chunks.length ? total / chunks.length : 1 }
      log('kb: 索引完成', { chunks: chunks.length, libs: list.filter((l) => l.enabled).length })
      building = null
      return index
    })()
    // 失败也要清 building：否则它会一直是这个已 reject 的 promise，
    // 之后每次 list() / search() 都直接抛，知识库整页报错直到重启进程。
    building.catch(() => { building = null })
    return building
  }

  async function list() {
    const list = await loadLibs()
    const idx = await buildIndex()
    return {
      libraries: list.map((lib) => {
        const chars = lib.docs.reduce((n, d) => n + (d.chars || 0), 0)
        return {
          id: lib.id, name: lib.name, note: lib.note, role: lib.role || '', enabled: lib.enabled,
          docs: lib.docs.map((d) => Object.assign({}, d, {
            ageDays: (d.updatedAt || d.addedAt) ? Math.max(0, Math.floor((Date.now() - Date.parse(d.updatedAt || d.addedAt)) / 86400000)) : null,
          })), chars,
          chunks: idx.chunks.filter((c) => c.libId === lib.id).length,
        }
      }),
      stats: { chunks: idx.chunks.length, libraries: list.length },
      inUse: list.filter((l) => l.enabled && String(l.role || '').trim()).map((l) => ({ id: l.id, name: l.name })),
      mode: await getMode(),
    }
  }

  async function create(input = {}) {
    const list = await loadLibs()
    const fallback = 'kb-' + Date.now().toString(36)
    const id = makeId(input.id || input.name, fallback)
    if (!ID_RE.test(id)) return { error: 'id 只能用 a-z 0-9 _ -（2–32 字符）' }
    if (list.some((l) => l.id === id)) return { error: '这个 id 已经有知识库了' }
    if (list.length >= 40) return { error: '最多 40 个知识库' }
    const lib = {
      id,
      name: clampText(input.name, 60).trim() || id,
      note: clampText(input.note, 200).trim(),
      role: clampText(input.role, 900).trim(),
      enabled: true,
      createdAt: new Date().toISOString(),
      docs: [],
    }
    await persistLib(lib)
    libs.push(lib)
    index = null
    log('kb: 新建库', { id, name: lib.name })
    return { ok: true, library: { ...lib } }
  }

  async function remove(id) {
    const list = await loadLibs()
    if (!list.some((l) => l.id === id)) return { error: '没有这个知识库' }
    libs = list.filter((l) => l.id !== id)
    await rm(libDir(id), { recursive: true, force: true })
    index = null
    log('kb: 删除库', { id })
    return { ok: true }
  }

  async function loadSettings() {
    if (settings) return settings
    try {
      settings = JSON.parse(stripBom(await readFile(join(dir, 'settings.json'), 'utf8')))
    } catch {
      settings = { mode: 'work' }
    }
    if (settings.mode !== 'work' && settings.mode !== 'chat') settings.mode = 'work'
    return settings
  }

  /** 'work' 先给结论和步骤，'chat' 就是平常那样陪他说话。 */
  async function getMode() {
    return (await loadSettings()).mode
  }

  async function setMode(mode) {
    const s = await loadSettings()
    s.mode = mode === 'chat' ? 'chat' : 'work'
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.json'), JSON.stringify(s, null, 2) + '\n', 'utf8')
    log('kb: 模式切换', s.mode)
    return s.mode
  }

  /** 整个能力包导出成一份 json，方便换机器 / 分享给别的用户。 */
  async function exportPack(id) {
    const list = await loadLibs()
    const lib = list.find((l) => l.id === id)
    if (!lib) return { error: '没有这个能力包' }
    const docs = []
    for (const d of lib.docs) {
      try {
        docs.push({ name: d.name, text: await readFile(docFile(id, d.id), 'utf8') })
      } catch { /* 缺文件就跳过 */ }
    }
    return {
      ok: true,
      pack: {
        format: 'chill-kb-pack/1',
        id: lib.id,
        name: lib.name,
        note: lib.note,
        role: lib.role || '',
        docs,
        exportedAt: new Date().toISOString(),
      },
    }
  }

  async function importPack(payload = {}) {
    if (!payload || typeof payload !== 'object') return { error: '包格式不对' }
    const name = clampText(payload.name, 60).trim()
    if (!name) return { error: '包里没有名字' }
    const id = makeId(payload.id || name, 'kb-' + Date.now().toString(36))
    const created = await create({ id, name, note: payload.note, role: payload.role })
    if (created.error) return created
    let added = 0
    const docs = Array.isArray(payload.docs) ? payload.docs : []
    for (const d of docs) {
      if (!d || !String(d.text || '').trim()) continue
      const r = await addDoc(created.library.id, { name: d.name, text: d.text })
      if (r.ok) added += 1
    }
    return { ok: true, library: created.library, docs: added }
  }

  async function update(id, patch = {}) {
    const list = await loadLibs()
    const lib = list.find((l) => l.id === id)
    if (!lib) return { error: '没有这个知识库' }
    if (patch.name != null) lib.name = clampText(patch.name, 60).trim() || lib.name
    if (patch.note != null) lib.note = clampText(patch.note, 200).trim()
    if (patch.role != null) lib.role = clampText(patch.role, 900).trim()
    if (typeof patch.enabled === 'boolean') lib.enabled = patch.enabled
    await persistLib(lib)
    index = null
    log('kb: 更新库', { id, enabled: lib.enabled, roleChars: (lib.role || '').length })
    return { ok: true, library: { ...lib } }
  }

  async function toggle(id, enabled) {
    const list = await loadLibs()
    const lib = list.find((l) => l.id === id)
    if (!lib) return { error: '没有这个知识库' }
    lib.enabled = enabled == null ? !lib.enabled : Boolean(enabled)
    await persistLib(lib)
    index = null
    log('kb: 启停', { id, enabled: lib.enabled })
    return { ok: true, enabled: lib.enabled }
  }

  async function addDoc(libId, input = {}) {
    const list = await loadLibs()
    const lib = list.find((l) => l.id === libId)
    if (!lib) return { error: '没有这个知识库' }
    if (lib.docs.length >= MAX_DOCS) return { error: '每个库最多 ' + MAX_DOCS + ' 篇' }
    const text = clampText(input.text, MAX_DOC_CHARS).trim()
    if (!text) return { error: '内容是空的' }
    const name = clampText(input.name, 120).trim() || ('文档 ' + (lib.docs.length + 1))
    const fallback = 'doc-' + Date.now().toString(36)
    let id = makeId(input.docId || name, fallback)
    if (lib.docs.some((d) => d.id === id)) id = fallback + '-' + Math.random().toString(36).slice(2, 5)
    // 时间口径：updatedAt 取源文件的最后修改时间（调用方传 mtime），没传才退回当前时间。
// 手写的「核对至」只作正文线索，判断新鲜度一律看 updatedAt。
    const stamp = input.mtime ? new Date(input.mtime) : new Date()
    const doc = {
      id, name, chars: text.length,
      addedAt: new Date().toISOString(),
      updatedAt: isNaN(stamp.getTime()) ? new Date().toISOString() : stamp.toISOString(),
      verifiedAt: extractVerifiedAt(text),
    }
    await mkdir(docsDir(libId), { recursive: true })
    await writeFile(docFile(libId, id), text, 'utf8')
    lib.docs.push(doc)
    await persistLib(lib)
    index = null
    log('kb: 收文档', { lib: libId, doc: id, chars: doc.chars })
    return { ok: true, doc, chunkCount: chunkText(text).length }
  }

  async function removeDoc(libId, docId) {
    const list = await loadLibs()
    const lib = list.find((l) => l.id === libId)
    if (!lib) return { error: '没有这个知识库' }
    const before = lib.docs.length
    lib.docs = lib.docs.filter((d) => d.id !== docId)
    if (lib.docs.length === before) return { error: '没有这篇文档' }
    await rm(docFile(libId, docId), { force: true })
    await persistLib(lib)
    index = null
    return { ok: true }
  }

  async function getDoc(libId, docId) {
    const list = await loadLibs()
    const lib = list.find((l) => l.id === libId)
    if (!lib) return null
    const doc = lib.docs.find((d) => d.id === docId)
    if (!doc) return null
    try { return { lib, doc, text: await readFile(docFile(libId, docId), 'utf8') } } catch { return null }
  }

  async function search(query, { k = 5 } = {}) {
    const idx = await buildIndex()
    const tokens = tokenize(query)
    if (!tokens.length || !idx.chunks.length) return []
    const uniq = [...new Set(tokens)]
    const scored = []
    for (const chunk of idx.chunks) {
      let score = 0
      for (const t of uniq) {
        const tf = chunk.tf.get(t)
        if (!tf) continue
        const df = idx.df.get(t) || 1
        const idf = Math.log(1 + (idx.N - df + 0.5) / (df + 0.5))
        const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.len / idx.avgdl))
        score += idf * ((tf * (BM25_K1 + 1)) / denom)
      }
      if (score <= 0) continue
      // 文档标题里出现查询词，额外加分
      const headHits = uniq.filter((t) => tokenize(chunk.docName).includes(t)).length
      if (headHits) score *= 1 + 0.15 * headHits
      // 时效倾斜：内容里写明的版本越新，权重越高。版本号只在正文里出现，
      // 所以旧版本文档不会被淘汰，只是新版本内容在同等相关时先说话。
      if (chunk.ver > VER_BASE) score *= 1 + VER_WEIGHT * (chunk.ver - VER_BASE)
      scored.push({ score, chunk })
    }
    if (!scored.length) return []
    // 时效裁决：先按相关度排；分差落在 3% 以内视为并列，并列时版本更新的先说话。
    // 这样「旧文档里写得准」不会被新文档里写得泛的内容顶掉，但真要打平时新的赢。
    scored.sort((a, b) => {
      const gap = b.score - a.score
      if (Math.abs(gap) > Math.max(b.score, a.score) * 0.03) return gap
      return (b.chunk.ver || 0) - (a.chunk.ver || 0)
    })
    // BM25 的分数尺度：单个 bigram 命中大约 0.4–0.9，多词命中 1.5 以上。
    // 绝对下限 0.8 用来挡掉「的 / 问题」这类偶然碰撞，相对下限挡掉远弱的噪声。
    const top = scored[0].score
    const cut = Math.max(0.25, top * 0.12)
    const kept = scored.filter((s) => s.score >= cut)
    if (!kept.length) return []
    return kept.slice(0, Math.max(1, k)).map((s) => ({
      libId: s.chunk.libId, libName: s.chunk.libName,
      docId: s.chunk.docId, docName: s.chunk.docName,
      score: Math.round(s.score * 100) / 100,
      text: s.chunk.text,
    }))
  }

  /**
   * 常驻能力段：把各库的 role 拼成"你已经掌握的领域"，每一轮都进 system。
   * 检索（block）负责长尾细节，这里负责"她会不会这个领域"这件事本身。
   */
  async function capabilityBlock({ maxChars = 1500 } = {}) {
    const list = await loadLibs()
    const items = list.filter((l) => l.enabled && String(l.role || '').trim())
    if (!items.length) return ''
    const lines = []
    let used = 0
    for (const lib of items) {
      const body = String(lib.role).replace(/\s*\n\s*/g, ' ').trim()
      if (!body) continue
      if (used + body.length > maxChars && lines.length) break
      lines.push('- ' + lib.name + '：' + body)
      used += body.length
    }
    return lines.join('\n')
  }

  /** 拼成喂给模型的资料块；没有命中就返回空串。 */
  async function block(query, { k = 4, maxChars = 1400 } = {}) {
    const hits = await search(query, { k })
    if (!hits.length) return ''
    const parts = []
    let used = 0
    for (const hit of hits) {
      const head = '【资料·' + hit.libName + ' / ' + hit.docName + '】'
      const body = hit.text.replace(/\s*\n\s*/g, ' ').trim()
      if (used + body.length > maxChars && parts.length) break
      parts.push(head + '\n' + (body.length > maxChars ? body.slice(0, maxChars) : body))
      used += body.length
    }
    return parts.join('\n\n')
  }

  return {
    dir, list, create, update, remove, toggle, addDoc, removeDoc, getDoc,
    search, block, capabilityBlock, exportPack, importPack, getMode, setMode,
    tokenize, chunkText,
  }
}
