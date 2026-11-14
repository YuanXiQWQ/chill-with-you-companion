// 记忆层：短时对话窗口 + 长期事实库 + 滚动摘要 + 相关度检索
// 设计参考市面上记忆插件的三个分层（mem0 / Letta / MemGPT 的共同点）：
//   1) recent   —— 最近若干轮原话，进 prompt 保证接话自然
//   2) facts    —— 提炼过的原子事实，带重要度/命中次数/时间，按相关度取回
//   3) summary  —— 更早的相处压缩成一段自述式摘要，替代无限增长的原文
// 落盘全部是 jsonl / json，纯文本，坏了也不会把整个插件带崩。
import { appendFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

// 本机只有 PowerShell 5.1，写 json 会带 UTF-8 BOM，而 JSON.parse 不剥它：
// 一度"被 PowerShell 碰过的文件"全被当成损坏（角色卡消失、配置回默认、记忆首行丢失）。
const stripBom = (s) => (typeof s === 'string' && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

const CJK = /[\u3040-\u30ff\u3400-\u9fff]/
const STOP = new Set([
  '的', '了', '是', '我', '你', '他', '她', '在', '有', '和', '就', '也', '都', '很', '把', '被',
  'the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'it', 'i', 'you', 'we', 'my', 'me',
])

function normSpace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

/** 关键词切分：CJK 用二元组，拉丁用词。用于检索打分与去重。 */
/**
 * 两条事实是不是"同一件事、但结论反了"。
 * 判据很短：词面得像（同一件事），且其中一条带否定/转变的说法（结论变了）。
 * 不追求聪明——判错一条只是少记一件事，判太狠会把正常记忆杀掉，所以阈值定得保守。
 */
function contradicts(a, b) {
  const NEG = /不|没|别|戒了|改成|换成|以前|现在没|不再|算了/
  const ta = tokens(a)
  const tb = tokens(b)
  // 不用 jaccard——中文短句里"同一件事"的两句也才 0.1 上下，任何像样的阈值都够不着。
  // 改成数共享的 bigram（单字太泛，"他""的"到处都是，会把不相干的也算成同一件事）。
  let shared = 0
  for (const x of ta) {
    if (x.length >= 2 && tb.has(x)) shared += 1
  }
  if (shared < 1) return false
  return NEG.test(a) !== NEG.test(b)     // 一个否定一个没否定，才算翻案
}
export function tokens(text) {
  const s = normSpace(text).toLowerCase()
  const out = new Set()
  for (const w of s.match(/[a-z0-9_]{2,}/g) || []) {
    if (!STOP.has(w)) out.add(w)
  }
  const cjk = s.replace(/[^\u3040-\u30ff\u3400-\u9fff]+/g, ' ')
  for (const run of cjk.split(' ')) {
    if (!run) continue
    if (run.length === 1) {
      if (!STOP.has(run)) out.add(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const bg = run.slice(i, i + 2)
      if (!STOP.has(bg)) out.add(bg)
    }
    // 单字也进索引：只建 bigram 的话，查「猫」永远撞不上「橘猫」「猫叫」。
    for (const ch of run) {
      if (!STOP.has(ch)) out.add(ch)
    }
  }
  return out
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}

function overlapScore(q, f) {
  if (!q.size || !f.size) return 0
  let hit = 0
  for (const x of q) if (f.has(x)) hit += 1
  return hit / Math.sqrt(q.size)
}

function makeId(prefix, seed) {
  const t = Date.now().toString(36)
  const r = Math.abs(seed ? hash32(seed) : Math.random() * 1e9).toString(36).slice(0, 5)
  return `${prefix}_${t}_${r}`
}

function hash32(s) {
  let h = 2166136261
  const str = String(s)
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}

async function readJsonl(path) {
  try {
    const text = await readFile(path, 'utf8')
    const rows = []
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        rows.push(JSON.parse(t))
      } catch {
        /* 坏行跳过，不让一条脏数据毁掉整库 */
      }
    }
    return rows
  } catch {
    return []
  }
}

async function writeJsonAtomic(path, value, opts = {}) {
  const tmp = `${path}.tmp`
  // raw=true 时 value 已经是最终文本（JSONL 用），否则按 JSON 序列化
  await writeFile(tmp, opts.raw ? String(value) : JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, path)
}

/**
 * @param {{ dir: string, recentLimit?: number, factLimit?: number }} opts
 */
export function createMemoryStore(opts = {}) {
  // 统一走注入的 log：以前 prune 用 console.warn，侧车日志里出现无前缀的一行，过滤不掉
  const log = typeof opts.log === 'function' ? opts.log : () => {}
  const dir = opts.dir
  const recentLimit = opts.recentLimit || 12
  const factLimit = opts.factLimit || 400
  const forgetAfterDays = opts.forgetAfterDays || 180
  const turnsPath = join(dir, 'turns.jsonl')
  const factsPath = join(dir, 'facts.jsonl')
  const summaryPath = join(dir, 'summary.json')

  // ── 记忆分级 ───────────────────────────────────────────────────────────
  // 离现在越近越完整，越远越只剩骨架。不是硬砍：截断优先落在句末，
  // 留下的仍然是一句能读懂的话。
  //   keep  = 这条记忆在提示词里最多占多少字
  //   label = 给模型看的口径提示，让她知道这是"很久以前的印象"而不是刚发生的事
  const TIERS = [
    { days: 2, keep: 1e9, label: '' },              // 两天内：原样
    { days: 7, keep: 80, label: '' },               // 一周内：初步压缩
    { days: 30, keep: 50, label: '' },              // 一个月：再压一层
    { days: 90, keep: 32, label: '（印象）' },       // 三个月：只剩大意
    { days: 180, keep: 20, label: '（模糊的印象）' }, // 半年内：一句话
  ]

  /** 一条记忆按年龄该留多长。超出 forgetAfterDays 的要不要留，看重要性。 */
  const tierOf = (ageDays, kind) => {
    // 共同经历不受时效影响：三个月前那次吵架，比三天前的寒暄更该记得。
    // 悬着的话题（loop）同理——它要等一个结果，不能因为放了三个月就忘掉。
    if (kind === 'moment' || kind === 'loop') return { days: Infinity, keep: 1e9, label: '' }
    for (const t of TIERS) if (ageDays < t.days) return t
    return { days: Infinity, keep: 20, label: '（模糊的印象）' }
  }

  /** 截断优先落在句末，读起来还是一句完整的话。 */
  const compactText = (text, max) => {
    const s = String(text || '').trim()
    if (s.length <= max) return s
    const cut = s.slice(0, max)
    const marks = ['。', '？', '！', '，', '、', '；']
    let pos = -1
    for (const m of marks) pos = Math.max(pos, cut.lastIndexOf(m))
    if (pos >= max * 0.45) return cut.slice(0, pos + 1) + '…'
    return cut + '…'
  }

  let turns = []      // { role, content, at, emotion?, raw? }
  let facts = []      // { id, text, kind, importance, at, lastUsed, hits, tokens? }
  let summary = { text: '', coveredAt: 0, updatedAt: '' }
  let ready = false

  const indexFact = (f) => {
    const toks = tokens(f.text)
    Object.defineProperty(f, '_tok', { value: toks, writable: true, enumerable: false, configurable: true })
    // A-MEM 那套的轻量版：每条记忆带一串邻居 id，写入时连、检索时顺带想起来
    if (!Array.isArray(f.links)) f.links = []
    return f
  }

  // 必须写 JSONL（每行一条），因为 open() 用 readJsonl 逐行解析。
  // 2026-11-13 修：原来这里写成 JSON 数组（多行缩进），重启后每行都解析失败
  // → 长期事实永远读不回来，facts 始终是 0。
  const saveFacts = async () => {
    // 整条落盘：以前只挑 7 个字段，invalidAt / pinned / links 全丢。
    // 后果是重启后"已被推翻或已闭环"的事实又回到 prompt 里，pinned 的免删保护也失效。
    const rows = facts.map((f) => {
      const copy = { ...f }
      delete copy._tok   // 派生字段，重建即可
      return JSON.stringify(copy)
    })
    await writeJsonAtomic(factsPath, rows.join('\n') + (rows.length ? '\n' : ''), { raw: true })
  }

  const open = async () => {
    if (ready) return api
    await mkdir(dir, { recursive: true })
    turns = await readJsonl(turnsPath)
    facts = (await readJsonl(factsPath)).map(indexFact)
    try {
      const s = JSON.parse(stripBom(await readFile(summaryPath, 'utf8')))
      if (s && typeof s.text === 'string') summary = { text: s.text, coveredAt: s.coveredAt || 0, updatedAt: s.updatedAt || '' }
    } catch {
      /* 没有摘要就从空开始 */
    }
    ready = true
    // 每次载入顺手清一遍：半年以上又不重要的，到这儿就断了。
    try {
      const r = prune()
      if (r.dropped > 0) {
        await saveFacts()
        log('memory: prune', { dropped: r.dropped, kept: r.kept })
      }
    } catch { /* 清理失败不影响读写 */ }
    return api
  }

  const recent = (limit = recentLimit) => turns.slice(-limit)

  /**
   * 写之前先和盘上对账。
   *
   * 内存里的 `turns` 和 `turns.jsonl` 是同一份数据的两个副本。外部删过几行（手工清理、
   * 另一个进程重写）之后，内存里那份还留着，下一条 append 就会顺着内存的状态继续写，
   * 接着一旦触发裁剪就整份重写——被删的行全回来了，等于没删。
   * 对账规则：行数对不上就以盘上为准重建，只在日志里留一句。
   */
  const reconcileTurns = async () => {
    let raw
    try {
      raw = await readFile(turnsPath, 'utf8')
    } catch { return }
    const lines = raw.split('\n').filter((line) => line.trim())
    if (lines.length === turns.length) return
    const parsed = []
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)) } catch { /* 坏行跳过，别让一行坏 JSON 卡住整轮 */ }
    }
    turns = parsed
    log('memory: 历史被外部改过，按盘上的重建', { kept: turns.length })
  }

  const appendTurn = async (row) => {
    const r = { role: row.role === 'assistant' ? 'assistant' : 'user', content: normSpace(row.content), at: row.at || new Date().toISOString() }
    if (r.role === 'assistant' && r.content.length === 0) return null   // 空的她的话不入库：会教坏下一轮的模型
    if (row.emotion) r.emotion = row.emotion
    if (row.raw) r.raw = row.raw
    await reconcileTurns()
    turns.push(r)
    if (turns.length > Math.max(200, recentLimit * 20)) {
      const keep = turns.slice(-recentLimit * 12)
      turns = keep
      try {
        // 原子写：整份重写必须 tmp+rename。直接 writeFile 撞上进程重启就是半份文件，
        // 下次启动按坏 JSON 处理、把整段记忆隔离到 .bad（2026-11-14 真踩到过）。
        await writeJsonAtomic(turnsPath, keep.map((x) => JSON.stringify(x)).join('\n') + '\n', { raw: true })
      } catch { /* 落盘失败不影响内存里的这一轮 */ }
    } else {
      try {
        await appendFile(turnsPath, JSON.stringify(r) + '\n', 'utf8')
      } catch { /* 同上 */ }
    }
    return r
  }

  /**
   * 写入事实（模型自报的 remember 数组或手工记忆）。
   * 去重：与已有事实关键词重合度 >= 0.62 就合并（保留更长的那条，重要度取大，命中次数累加）。
   */
  const addFacts = async (list, meta = {}) => {
    const added = []
    const expired = []
    const fresh = []
    const merged = []
    const skipped = []
    for (const raw of Array.isArray(list) ? list : []) {
      const text = normSpace(raw).replace(/^[-*\s]+/, '').slice(0, 120)
      if (text.length < 2) continue
      const toks = tokens(text)
      if (toks.size === 0) { skipped.push(text); continue }
      let best = null
      let bestScore = 0
      for (const f of facts) {
        const score = jaccard(toks, f._tok || tokens(f.text))
        if (score > bestScore) { bestScore = score; best = f }
      }
      // 先看有没有"同一件事、但说法变了"——用户改主意了。
      // 不删旧记录，只打 invalidAt，历史还在，只是不再进 prompt（Graphiti 的边失效思路）。
      const lost = facts.find((f) => !f.invalidAt && f.text !== text && contradicts(f.text, text))
      if (lost) {
        lost.invalidAt = new Date().toISOString()
        expired.push(lost.text)
      }
      if (best && bestScore >= 0.62) {
        if (text.length > best.text.length) {
          best.text = text
          indexFact(best)
        }
        best.importance = Math.min(1, Math.max(best.importance || 0.5, meta.importance || 0.55) + 0.05)
        best.hits = (best.hits || 0) + 1
        best.lastUsed = new Date().toISOString()
        merged.push(best.text)
        continue
      }
      const fact = indexFact({
        id: makeId('f', text),
        text,
        kind: meta.kind || 'fact',
        importance: Math.min(1, Number(meta.importance) || 0.55),
        at: new Date().toISOString(),
        lastUsed: '',
        hits: 0,
      })
      facts.push(fact)
      added.push(fact.text)
      fresh.push(fact)
    }
    // 建链分两条路：
    // (1) 同一轮里一起说出来的事，本来就相关——「插件」「长轮询」这种词面不像的也能接上。
    // (2) 跨轮的只连词面真的像的。实测中文短句 jaccard 普遍在 0.03~0.10，
    //     「咖啡×怕苦」0.098、「开会×长轮询」0.048，阈值卡 0.09 才分得开，再高一条都连不上。
    // 一轮说两三件事是常态，说六件就是抽取跑偏了。超过三件只连前两条，免得整片串成一张网。
    const batch = fresh.length > 3 ? fresh.slice(0, 2) : fresh
    for (let i = 0; i < batch.length; i += 1) {
      for (let j = i + 1; j < batch.length; j += 1) {
        const a = batch[i]
        const b = batch[j]
        if (!a.links.includes(b.id)) a.links.push(b.id)
        if (!b.links.includes(a.id)) b.links.push(a.id)
      }
    }
    for (const fact of fresh) {
      const near = facts
        .filter((f) => f.id !== fact.id && !fact.links.includes(f.id))
        .map((f) => ({ f, s: jaccard(fact._tok || tokens(fact.text), f._tok || tokens(f.text)) }))
        .filter((x) => x.s >= 0.09 && x.s < 0.62)
        .sort((a, b) => b.s - a.s)
        .slice(0, 2)
      for (const { f } of near) {
        if (fact.links.length >= 4) break
        if (!fact.links.includes(f.id)) fact.links.push(f.id)
        if (!Array.isArray(f.links)) f.links = []
        if (!f.links.includes(fact.id)) f.links.push(fact.id)
      }
    }
    if (facts.length > factLimit) {
      // 重要度 + 命中次数最低的先淘汰，保留最近一百条兜底
      const ranked = [...facts].sort((a, b) => (b.importance + b.hits * 0.05) - (a.importance + a.hits * 0.05))
      facts = ranked.slice(0, factLimit)
    }
    if (added.length || merged.length) await saveFacts()
    return { added, merged, skipped, expired }
  }

  /** 相关度检索：关键词重合 + 时间衰减 + 重要度 + 命中次数。 */
  const search = (query, limit = 6) => {
    const q = tokens(query)
    const now = Date.now()
    // 失效的事实不再参与检索（历史还留着，只是不进 prompt）
    const scored = facts.filter((f) => !f.invalidAt).map((f) => {
      const rel = overlapScore(q, f._tok || tokens(f.text))
      const ageDays = Math.max(0, (now - Date.parse(f.at || 0)) / 86400000) || 0
      const fresh = Math.exp(-ageDays / 45)
      // 共同经历的权重高于普通事实。Generative Agents 里 importance(2.0) 是 recency(0.5) 的四倍，
      // 这里方向一致但没那么极端——陪伴场景下「最近」仍然重要。
      const kindBoost = f.kind === 'moment' ? 1.8 : 1
      const score = (rel * 1.0 + fresh * 0.35 + (f.importance || 0.5) * 0.4 + Math.min(0.2, (f.hits || 0) * 0.02)) * kindBoost
      return { f, score, rel }
    })
    scored.sort((a, b) => b.score - a.score)
    const hits = scored.filter((x) => x.rel > 0).slice(0, limit)
    const picked = (hits.length ? hits : scored.slice(0, Math.min(3, limit))).map((x) => x.f)
    for (const f of picked) {
      f.hits = (f.hits || 0) + 1
      f.lastUsed = new Date().toISOString()
    }
    // 顺带想起来：人提到咖啡，常会连带想起他怕苦那件事。
    // 只在真命中时扩散（走兜底说明本来就没有相关记忆，再扩散就是胡说），
    // 而且扩散出来的不计 hits，免得自己把自己越喂越重。
    if (hits.length) {
      const seen = new Set(picked.map((f) => f.id))
      const extra = []
      for (const f of picked) {
        for (const id of (f.links || [])) {
          if (seen.has(id) || extra.length >= 2) continue
          const g = facts.find((x) => x.id === id)
          if (!g || g === f || g.invalidAt) continue   // 失效的别顺着链爬回来
          seen.add(id)
          extra.push(g)
        }
        if (extra.length >= 2) break
      }
      picked.push(...extra)
    }
    if (picked.length) saveFacts().catch(() => {})
    return picked
  }

  /**
   * 悬着的话题：他提过、还没结果的事。主动搭话时优先问这个——
   * 人不会反复问「你在忙吗」，但会记得「你上次说的那个后来怎么样了」。
   * 被问过三次还没结果的，说明他不打算聊了，自动退场。
   */
  const openLoops = (limit = 2) => facts
    .filter((f) => f.kind === 'loop' && !f.invalidAt && Number(f.hits || 0) < 3)
    .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0))
    .slice(0, limit)

  /** 有结果了就关掉，别再问第二次。 */
  const closeLoop = async (id) => {
    const f = facts.find((x) => x.id === id)
    if (!f || f.kind !== 'loop') return false
    f.invalidAt = new Date().toISOString()
    await saveFacts()
    return true
  }

  const forget = async (id) => {
    const before = facts.length
    facts = facts.filter((f) => f.id !== id)
    if (facts.length !== before) await saveFacts()
    return facts.length !== before
  }

  const setSummary = async (text, coveredAt) => {
    summary = { text: normSpace(text), coveredAt: coveredAt || Date.now(), updatedAt: new Date().toISOString() }
    await writeJsonAtomic(summaryPath, summary)
    return summary
  }

  /** 供 prompt 使用：把检索到的事实 + 摘要拼成两段，带字符预算。 */
  const buildMemoryBlock = (query, { k = 6, maxChars = 700 } = {}) => {
    const picked = search(query, k)
    const lines = []
    let used = 0
    for (const f of picked) {
      const ageDays = Math.max(0, (Date.now() - Date.parse(f.at || 0)) / 86400000)
      const tier = tierOf(ageDays, f.kind)
      // 印象深的、被反复用到的，多给一点地方——它本来就更值得记
      const bonus = f.importance >= 0.8 ? 1.8 : (f.hits >= 3 ? 1.3 : 1)
      const text = compactText(f.text, Math.round(tier.keep * bonus))
      const line = `- ${tier.label}${text}`
      if (used + line.length > maxChars) break
      lines.push(line)
      used += line.length
    }
    return { facts: lines.join('\n'), summary: summary.text || '', picked }
  }

  /**
   * 按年龄清一遍：半年以上、又不是特别重要的，直接扔。
   * 重要的（importance ≥ 0.8 或标记 pinned）留着，但也只留压缩过的一句。
   */
  const prune = () => {
    const now = Date.now()
    const kept = []
    const dropped = []
    for (const f of facts) {
      const ageDays = Math.max(0, (now - Date.parse(f.at || 0)) / 86400000)
      // 共同经历和悬着的话题不设保质期——它们是「你们之间」，不是「资料」
      if (f.kind === 'moment' || f.kind === 'loop') {
        kept.push(f)
        continue
      }
      const precious = f.pinned === true || Number(f.importance) >= 0.8 || Number(f.hits) >= 5
      if (ageDays >= forgetAfterDays && !precious) {
        dropped.push(f)
        continue
      }
      if (ageDays >= forgetAfterDays && precious) {
        // 留下来的也要瘦身：长期记忆不该是原文
        f.text = compactText(f.text, 40)
        indexFact(f)
      }
      kept.push(f)
    }
    facts = kept
    return { dropped: dropped.length, kept: kept.length }
  }

  const stats = () => ({
    turns: turns.length,
    facts: facts.length,
    summaryChars: (summary.text || '').length,
    coveredAt: summary.coveredAt || 0,
    updatedAt: summary.updatedAt || '',
  })

  const allFacts = () => [...facts].sort((a, b) => (b.importance + b.hits * 0.05) - (a.importance + a.hits * 0.05))

  const chatHistory = (limit = 60) => turns
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .slice(-limit)
    .map((t) => ({ role: t.role, text: t.content, at: t.at, emotion: t.emotion || '' }))

  /** 需要压缩时把「窗口之外」的原文交给调用方去总结。 */
  const pendingForSummary = () => {
    const covered = summary.coveredAt || 0
    const fresh = turns.filter((t) => Date.parse(t.at || 0) > covered)
    const keep = recentLimit
    return fresh.length > keep + 8 ? fresh.slice(0, fresh.length - keep) : []
  }

  const api = {
    open, recent, appendTurn, addFacts, search, forget, prune, openLoops, closeLoop,
    setSummary, buildMemoryBlock, stats, allFacts, chatHistory, pendingForSummary,
    tierOf, compactText,
    get summaryText() { return summary.text || '' },
  }
  return api
}

export default createMemoryStore
