/**
 * work.mjs — 「观察一个 DSH 对话」
 *
 * 做的事很具体：把控制台对话页里的话，投到玩家自己挑的那条 DSH 对话里，
 * 投之前先把「聪音此刻是谁、记得什么、会什么」这段临时身份贴上去——
 * 于是同一条对话在这几分钟里由聪音接手，答什么、动什么文件都在那边发生，
 * 结果再一条条搬回控制台的对话页。停止观察，那条对话就恢复原样（身份块只活在这几条消息里）。
 *
 * 这个模块必须跑在 Host 里（只有 Host 能拿到 sessionController）：
 *   list()   列出可见会话
 *   prompt() 往指定会话投一条 user 消息
 *   follow() 跟会话事件流，抽 assistant/message
 *   cancel() 停掉它当前那一轮
 *
 * 所有内部实现都在 callback 里：ctx / 拼身份块 / 记日志都由调用方给，模块本身不 import 宿主。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// 本机只有 PowerShell 5.1，写 json 会带 UTF-8 BOM，而 JSON.parse 不剥它：
// 一度"被 PowerShell 碰过的文件"全被当成损坏（角色卡消失、配置回默认、记忆首行丢失）。
const stripBom = (s) => (typeof s === 'string' && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

const MAX_TURNS = 400
const FOLLOW_TIMEOUT_MS = 10 * 60 * 1000
const LATE_ARM_MS = 45 * 1000

function nowIso() {
  return new Date().toISOString()
}

function shortId(id) {
  const s = String(id || '')
  return s.length > 10 ? s.slice(0, 8) : s
}

/** 从事件体里抠纯文本。
 *  user/message 的 data 就是 UserMessage 本身；assistant/message 的 data 是 { turn, step, message, … }。
 *  两种都认，别只认一种——只认一种的话，自己的那条 user/message 永远读成空，就永远等不到开头。
 */
function messageText(data) {
  if (!data || typeof data !== 'object') return ''
  const message = data.message && Array.isArray(data.message.content) ? data.message : data
  const content = message && message.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/** 把 DSH 的原始报错翻成人话，别让 routing 之类的术语甩到玩家脸上。 */
function sendErrorText(error) {
  const raw = String(error?.message || error || '')
  if (/owned by subagent routing|subagent/i.test(raw)) return '这条是子代理的会话，没法观察；换一条普通对话'
  if (/not-found/i.test(raw)) return '这条对话找不到了（可能已删除）'
  if (/agent-busy|writer-held/i.test(raw)) return '这条对话正忙，等它这一轮跑完再发'
  if (/cancelled/i.test(raw)) return '投递被取消了'
  return raw
}

/** 会话显示名：projections.title → cwd 尾名 → 短 id。 */
function sessionTitle(item) {
  const values = (item && item.projections && item.projections.values) || {}
  for (const key of ['title', 'sessionTitle', 'name']) {
    const v = values[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  if (typeof item?.title === 'string' && item.title.trim()) return item.title.trim()
  if (typeof item?.cwd === 'string' && item.cwd.trim()) {
    const seg = item.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
    if (seg) return seg + ' · ' + shortId(item.sessionId)
  }
  return '会话 ' + shortId(item && item.sessionId)
}

export function createWork({ dir, getController, observe, log = () => {} }) {
  const settingsPath = join(dir, 'settings.json')
  const turnsPath = join(dir, 'turns.json')

  let turns = []
  let seq = 0
  let loaded = false
  let current = null          // { ac, sessionId, startedAt, answers }
  let lastError = ''
  let binder = { sessionId: '', title: '' }
  let watcher = null          // { ac, sessionId, lastSpokeAt, lastSaid, retries }
  let watchTurn = null        // 正在收集的这一轮
  let watchAcc = null         // 攒满一批活才开口的累积器（settleTurn 用，汇报完即重置）
  // 「停止观察」之后不许再自动接上。state() 每次轮询都会检查 binder 并把 watcher 拉起来，
  // 没有这道闸门的话，解除只是把 watcher 掐掉一瞬，下一次轮询就又活了——面板上就是"停不掉"。
  let holdWatch = false

  function ctrl() {
    try {
      return getController() || null
    } catch {
      return null
    }
  }

  async function load() {
    if (loaded) return
    loaded = true
    try {
      const parsed = JSON.parse(stripBom(await readFile(settingsPath, 'utf8')))
      if (parsed && typeof parsed === 'object') {
        binder = { sessionId: String(parsed.sessionId || ''), title: String(parsed.title || '') }
      }
    } catch { /* 没存过 */ }
    try {
      const parsed = JSON.parse(stripBom(await readFile(turnsPath, 'utf8')))
      if (Array.isArray(parsed)) {
        turns = parsed.slice(-MAX_TURNS)
        seq = turns.reduce((m, t) => Math.max(m, Number(t.n) || 0), 0)
      }
    } catch { /* 没流水 */ }
  }

  async function saveSettings() {
    await mkdir(dir, { recursive: true })
    await writeFile(settingsPath, JSON.stringify(binder, null, 2), 'utf8')
  }

  let saveTimer = null
  function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      mkdir(dir, { recursive: true })
        .then(() => writeFile(turnsPath, JSON.stringify(turns.slice(-MAX_TURNS)), 'utf8'))
        .catch(() => {})
    }, 400)
    if (saveTimer && typeof saveTimer.unref === 'function') saveTimer.unref()
  }

  function push(kind, text, extra) {
    const item = Object.assign({ n: ++seq, at: nowIso(), kind, text: String(text || '') }, extra || {})
    turns.push(item)
    if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS)
    scheduleSave()
    return item
  }

  // ── 会话列表 ──────────────────────────────────────────────────────────
  async function sessions() {
    const c = ctrl()
    if (!c) return { available: false, items: [], error: '这个 Harness 没交出会话服务' }
    try {
      const value = await c.list({}, new AbortController().signal)
      // 子代理的会话不能观察（投递会被 routing 挡掉），别让它们出现在下拉里。
      const items = ((value && value.items) || [])
        .filter((item) => !(item.origin === 'subagent' || item.parentSessionId))
        .map((item) => ({
          sessionId: String(item.sessionId),
          title: sessionTitle(item),
          running: Boolean(item.running),
          blank: Boolean(item.blank),
          updatedAt: Number(item.updatedAt) || 0,
          cwd: item.cwd || '',
          origin: item.origin || '',
          agentAvailable: Boolean(item.agentAvailable),
          bound: String(item.sessionId) === binder.sessionId,
        }))
      items.sort((a, b) => b.updatedAt - a.updatedAt)
      return { available: true, items }
    } catch (error) {
      log('work: list sessions failed', { error: String(error?.message || error) })
      return { available: false, items: [], error: '列会话失败：' + String(error?.message || error) }
    }
  }

  // ── 绑定 / 解绑 ───────────────────────────────────────────────────────
  async function bind(sessionId, title) {
    await load()
    const id = String(sessionId || '').trim()
    if (!id) return { error: '要选一条对话' }
    binder = { sessionId: id, title: String(title || '').trim() || '会话 ' + shortId(id) }
    holdWatch = false
    await saveSettings()
    push('bind', '观察：' + binder.title, { sessionId: id })
    startWatch(id)
    return { ok: true, bound: binder }
  }

  /**
   * 停止观察：只解除当前选定的这一条。
   * 不碰在跑的投递、不清流水、不动其它状态——就是不再盯着它。
   * 需要"整个放平"的场合走 releaseAll()。
   */
  async function unbind() {
    await load()
    const target = String((watcher && watcher.sessionId) || binder.sessionId || '')
    const title = binder.title
    if (!target) {
      stopWatch()
      return { ok: true, released: [], bound: null, watching: false }
    }
    binder = { sessionId: '', title: '' }
    holdWatch = true           // 同样不许被 state() 的轮询自动接上
    await saveSettings()
    stopWatch()
    push('unbind', '停止观察：' + (title || shortId(target)), { sessionIds: [target] })
    return { ok: true, released: [target], bound: null, watching: false }
  }

  /**
   * 一次性掐断所有正在观察的对话。
   * 不是「当前这一条」——是把观察这套东西整个放平：
   *   1. 正在跑的那次投递（current）中止
   *   2. 事件流 watcher 的 AbortController + 抬眼的 idleTimer 都收掉
   *   3. watchTurn / watchAcc / snap 这些攒了一半的状态清空，免得下次接上时带着旧快照
   *   4. binder 清空并落盘——否则重启侧车后 state() 会拿它把观察重新拉起来
   *   5. holdWatch 立起来：轮询再怎么问，也不再自动接上
   * 返回被解除的会话 id 列表，调用方能知道到底放了谁。
   */
  async function releaseAll(reason = '解除全部观察') {
    await load()
    const released = []
    const seen = (id) => {
      const v = String(id || '')
      if (v && released.indexOf(v) < 0) released.push(v)
    }

    if (current) {
      seen(current.sessionId)
      try { current.ac.abort() } catch { /* ignore */ }
      current = null
    }
    if (watchTurn) { watchTurn = null }
    if (watchAcc) { watchAcc = null }
    if (watcher) {
      seen(watcher.sessionId)
      if (watcher.idleTimer) {
        try { clearInterval(watcher.idleTimer) } catch { /* ignore */ }
      }
      try { watcher.ac.abort() } catch { /* ignore */ }
      watcher = null
    }
    seen(binder.sessionId)
    binder = { sessionId: '', title: '' }
    holdWatch = true
    lastError = ''
    await saveSettings()
    if (released.length) push('unbind', reason, { sessionIds: released.slice() })
    return { ok: true, released, watching: false, bound: null }
  }

  function busy() {
    return current
      ? { running: true, sessionId: current.sessionId, sinceMs: Date.now() - current.startedAt, answers: current.answers }
      : { running: false }
  }

  /** 跟一次会话事件流，把这一轮的回答搬进流水。expect = 我们刚投进去的那段话的开头。 */
  async function followOnce(c, sessionId, ac, expect) {
    const head = String(expect || '').slice(0, 24)
    const startedAt = Date.now()
    let baseSeq = 0            // snapshot 的 cursor：这之前的都是历史，不算这次的
    let armed = false
    let answers = 0
    let sawUser = 0
    let turns = 0
    let guard = 0
    const timer = setTimeout(() => {
      try { ac.abort() } catch { /* ignore */ }
    }, FOLLOW_TIMEOUT_MS)
    if (timer && typeof timer.unref === 'function') timer.unref()

    try {
      const stream = await c.follow({ address: { kind: 'session', sessionId }, maxMessages: 24 }, ac.signal)
      for await (const frame of stream) {
        if (ac.signal.aborted) break
        if (!frame) continue
        if (frame.type === 'snapshot') {
          baseSeq = Number(frame.cursor) || 0
          continue
        }
        if (frame.type !== 'event') continue
        const ev = frame.event
        if (!ev || !ev.type) continue
        const seq = Number(ev.seq) || 0

        if (ev.type === 'user/message') {
          // snapshot 之后新到的 user/message 只可能是我们投的：认 seq 就够了。
          // 文本只用来核对（DSH 有时会给 user 消息加包装，这时别死等，照收）。
          if (seq > baseSeq) {
            sawUser += 1
            if (!armed) {
              armed = true
              const text = messageText(ev.data)
              if (head && text && text.indexOf(head) < 0) {
                push('warn', '投进去的消息被改写过，按实际内容继续跟', { sessionId })
              }
            }
          }
          continue
        }

        // 兜底：身份块被改写、或那条会话自己又插了别的 user 消息时，别死等；
        // 过了 LATE_ARM_MS 还没认出来，就按「新事件都算」继续收。
        if (!armed) {
          if (seq > baseSeq && Date.now() - startedAt > LATE_ARM_MS) armed = true
          else continue
        }

        if (ev.type === 'turn/start') {
          turns += 1
          push('tick', '那边开始处理了', { sessionId })
          continue
        }
        if (ev.type === 'assistant/message') {
          const text = messageText(ev.data)
          if (text) {
            answers += 1
            if (current) current.answers = answers
            push('answer', text, { sessionId, interrupted: Boolean(ev.data && ev.data.interrupted) })
          }
          continue
        }
        if (ev.type === 'tool/call') {
          if (++guard <= 40) push('tool', String((ev.data && ev.data.name) || '工具'), { sessionId })
          continue
        }
        if (ev.type === 'turn/end') {
          const reason = (ev.data && ev.data.reason) || {}
          if (reason.kind === 'error') {
            const fail = reason.error && reason.error.message
            push('error', '那边这一轮没成：' + (fail || 'error'), { sessionId })
          } else if (reason.kind === 'aborted' && answers === 0) {
            push('error', '那边这一轮被停掉了，没出话', { sessionId })
          }
          if (answers > 0) break
          continue
        }
      }
    } finally {
      clearTimeout(timer)
      if (answers === 0 && !ac.signal.aborted) {
        push('warn', '这一轮没收到回答（新 user 事件 ' + sawUser + ' 条 / turn ' + turns + ' 个）', { sessionId })
      }
    }
  }

  // ── 旁观：开始观察之后一直盯着那条会话，每干完一轮看一次 ─────────────────────
  // 不注入、不改写、不投递：只读事件流。要不要出声，交给聪音自己的链路判断。
  function stopWatch() {
    if (!watcher) return
    if (watcher.idleTimer) {
      try { clearInterval(watcher.idleTimer) } catch { /* ignore */ }
    }
    try { watcher.ac.abort() } catch { /* ignore */ }
    watcher = null
    watchTurn = null
  }

  function newWatchTurn() {
    return { asked: '', answers: [], tools: [], toolCalls: 0, error: '', startedAt: Date.now(), endedAt: 0 }
  }

  // 只在"攒够了一批活"时才惊动她，而且只说一句概况：小步碎步全部在本地掐掉，不花模型调用。
  const HEAVY = {
    minToolCalls: 8,      // 累计调了多少次工具
    minToolKinds: 4,      // 动了几种工具
    minRounds: 4,         // 攒了几轮
    minSpanMinutes: 5,    // 这段累积跨了多久
    cooldownMinutes: 5,   // 两次开口之间至少隔这么久
  }

  function newAcc() {
    return { turns: 0, toolCalls: 0, tools: [], errors: 0, startedAt: Date.now(), lastAsked: '', lastAnswer: '' }
  }

  function newSnap() {
    return {
      phase: 'idle', since: Date.now(), updatedAt: Date.now(),
      turns: 0, toolCalls: 0, tools: [], lastAsked: '', lastAnswer: '', errors: 0,
    }
  }

  /** 那边现在到哪一步了：给她一份随事件更新的进度快照，让她知道，而不是每轮重新听写。 */
  function touchSnap(patch) {
    if (!watcher) return
    if (!watcher.snap) watcher.snap = newSnap()
    const snap = watcher.snap
    if (patch.phase) {
      if (patch.phase !== snap.phase) snap.since = Date.now()
      snap.phase = patch.phase
    }
    if (patch.tools) {
      for (const name of patch.tools) {
        if (snap.tools.length < 8 && snap.tools.indexOf(name) < 0) snap.tools.push(name)
      }
    }
    if (typeof patch.addTurns === 'number') snap.turns += patch.addTurns
    if (typeof patch.turns === 'number') snap.turns = patch.turns
    if (typeof patch.addToolCalls === 'number') snap.toolCalls += patch.addToolCalls
    if (typeof patch.toolCalls === 'number') snap.toolCalls = patch.toolCalls
    if (typeof patch.addErrors === 'number') snap.errors += patch.addErrors
    if (typeof patch.errors === 'number') snap.errors = patch.errors
    if (patch.lastAsked) snap.lastAsked = String(patch.lastAsked).slice(0, 160)
    if (patch.lastAnswer) snap.lastAnswer = String(patch.lastAnswer).slice(0, 200)
    snap.updatedAt = Date.now()
  }

  /** 自然语言化的「他那边在干什么」，喂给她自己的上下文。没在观察时给空串。 */
  function ambientText() {
    if (!watcher || !binder.sessionId) return ''
    const snap = watcher.snap || newSnap()
    const minutes = Math.round(((Date.now() - snap.since) / 60000) * 10) / 10
    const parts = []
    if (snap.phase === 'running') {
      parts.push('他正在「' + binder.title + '」那边干活，这一轮已经跑了 ' + Math.max(1, Math.round(minutes)) + ' 分钟，还没完。')
    } else if (snap.phase === 'error') {
      parts.push('他在「' + binder.title + '」那边出了岔子，刚停下来。')
    } else if (snap.turns > 0) {
      parts.push('他刚在「' + binder.title + '」那边忙完一批活，前后大概 ' + Math.max(1, Math.round(minutes)) + ' 分钟。')
    } else {
      return ''
    }
    if (snap.turns > 0) parts.push('一共过了 ' + snap.turns + ' 轮。')
    if (snap.tools.length) parts.push('动过 ' + snap.tools.slice(0, 5).join('、') + '。')
    if (snap.errors > 0) parts.push('中间出过 ' + snap.errors + ' 次错。')
    // 只给他「在弄什么」的一句由头，不回放那边的原话：
    // 拿她的嘴去复述别人的句子，听起来就是两个人在念同一份日志；
    // 而且一旦观察对象就是「正在和她说话的那条会话」，原文会变成自我指涉的闭环。
    if (snap.lastAsked) parts.push('他最近在弄的是「' + String(snap.lastAsked).replace(/\s+/g, ' ').slice(0, 40) + '」。')
    parts.push('（这是你抬眼看见的，不是他亲口说的。他要是问起、或者话正好挨到这儿，就自然接一句；他要是没提，你也犯不上主动报。）')
    return parts.join('')
  }

  /** 每一轮结束只更新累积摘要（本地操作，零成本）；攒够了才请她说一句概况。 */
  async function settleTurn(turn) {
    if (!turn || !watcher) return
    if (!watchAcc) watchAcc = newAcc()
    const said = turn.answers.join('\n').trim()

    watchAcc.turns += 1
    watchAcc.toolCalls += turn.toolCalls || 0
    for (const toolName of turn.tools) {
      if (watchAcc.tools.length < 8 && watchAcc.tools.indexOf(toolName) < 0) watchAcc.tools.push(toolName)
    }
    if (turn.error) watchAcc.errors += 1
    if (turn.asked) watchAcc.lastAsked = turn.asked.slice(0, 160)
    if (said) watchAcc.lastAnswer = said.slice(0, 200)

    // 进度快照：不管开不开口，她都得知道那边到哪一步了
    touchSnap({
      phase: turn.error ? 'error' : 'idle',
      tools: turn.tools,
      addToolCalls: turn.toolCalls || 0,
      addTurns: 1,
      addErrors: turn.error ? 1 : 0,
      lastAsked: turn.asked,
      lastAnswer: said,
    })

    const spanMinutes = (Date.now() - watchAcc.startedAt) / 60000
    const quietMinutes = (Date.now() - (watcher.lastSpokeAt || Date.now())) / 60000
    if (quietMinutes < HEAVY.cooldownMinutes) return

    const big = watchAcc.errors > 0 ||
      watchAcc.toolCalls >= HEAVY.minToolCalls ||
      watchAcc.turns >= HEAVY.minRounds ||
      watchAcc.tools.length >= HEAVY.minToolKinds ||
      spanMinutes >= HEAVY.minSpanMinutes
    if (!big) return
    if (typeof observe !== 'function') return

    const brief = {
      rounds: watchAcc.turns,
      minutes: Math.round(spanMinutes * 10) / 10,
      tools: watchAcc.tools.slice(),
      errors: watchAcc.errors,
      lastAsked: watchAcc.lastAsked,
      lastAnswer: watchAcc.lastAnswer,
    }
    const sessionId = watcher.sessionId
    watchAcc = newAcc()   // 汇报完重新攒，别把同一批活说两遍
    try {
      const result = await observe(Object.assign({
        title: binder.title,
        quietMinutes: Math.round(quietMinutes * 10) / 10,
        lastSaid: watcher.lastSaid,
      }, brief))
      if (!result || !result.ok || !result.speak) return
      if (watcher) {
        watcher.lastSpokeAt = Date.now()
        watcher.lastSaid = String(result.subtitle || '')
      }
      push('care', String(result.subtitle || ''), {
        sessionId,
        emotion: result.emotion || '',
        audioUrl: result.audioUrl || '',
      })
    } catch (error) {
      log('work: observe failed', { error: String(error?.message || error) })
    }
  }

  /**
   * settleTurn 前半段的累积代码不在 try 里，一旦抛出去就是 unhandledRejection ——
   * 宿主把未处理拒绝当致命错误，整个 dsh 会直接退出。所以这条即发即忘的路径必须自带 catch。
   */
  function settleLater(turn) {
    settleTurn(turn).catch((error) => log('work: settleTurn failed', { error: String(error?.message || error) }))
  }

  function startWatch(sessionId) {
    stopWatch()
    const c = ctrl()
    if (!c || !sessionId) return
    const ac = new AbortController()
    // 刚开始观察时算"四分钟前说过话"，免得一上来就播报
    watcher = {
      ac, sessionId,
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      lastSpokeAt: Date.now() - 4 * 60 * 1000,
      lastSaid: '', retries: 0, looking: false,
      snap: newSnap(),
    }
    // 她自己会抬眼：静默久了主动去读一眼那条会话（冷读，不激活 agent）
    watcher.idleTimer = setInterval(() => { void idleLook(ac) }, 60 * 1000)
    if (watcher.idleTimer.unref) watcher.idleTimer.unref()
    push('watch', '开始看着这条对话', { sessionId })
    void watchLoop(c, sessionId, ac)
  }

  async function watchLoop(c, sessionId, ac) {
    while (!ac.signal.aborted) {
      try {
        const stream = await c.follow({ address: { kind: 'session', sessionId }, maxMessages: 12 }, ac.signal)
        watchTurn = newWatchTurn()
        for await (const frame of stream) {
          if (ac.signal.aborted) break
          if (watcher) watcher.lastEventAt = Date.now()
          if (!frame || frame.type !== 'event') continue
          const ev = frame.event
          if (!ev || !ev.type) continue

          if (ev.type === 'turn/start') {
            touchSnap({ phase: 'running' })
            if (watchTurn && watchTurn.answers.length) {
              watchTurn.endedAt = Date.now()
              const done = watchTurn
              watchTurn = newWatchTurn()
              settleLater(done)
            } else {
              watchTurn = newWatchTurn()
            }
            continue
          }
          if (ev.type === 'user/message') {
            const text = messageText(ev.data)
            if (text && watchTurn) watchTurn.asked = text.slice(0, 300)
            continue
          }
          if (ev.type === 'tool/call') {
            const toolName = String((ev.data && ev.data.name) || '')
            if (watchTurn) {
              watchTurn.toolCalls += 1
              if (toolName && watchTurn.tools.length < 20 && watchTurn.tools.indexOf(toolName) < 0) {
                watchTurn.tools.push(toolName)
              }
            }
            continue
          }
          if (ev.type === 'assistant/message') {
            const text = messageText(ev.data)
            if (text && watchTurn) watchTurn.answers.push(text)
            continue
          }
          if (ev.type === 'turn/end') {
            if (!watchTurn) continue
            watchTurn.endedAt = Date.now()
            const reason = (ev.data && ev.data.reason) || {}
            if (reason.kind === 'error') {
              watchTurn.error = String((reason.error && reason.error.message) || 'error').slice(0, 200)
            } else if (reason.kind === 'aborted' && !watchTurn.answers.length) {
              watchTurn.error = '这一轮被停掉了'
            }
            const done = watchTurn
            watchTurn = newWatchTurn()
            settleLater(done)
            continue
          }
        }
      } catch (error) {
        if (ac.signal.aborted) break
        log('work: watch stream failed', { error: String(error?.message || error) })
      }
      if (ac.signal.aborted) break
      if (!watcher || watcher.sessionId !== sessionId) break
      if (++watcher.retries > 30) {
        push('warn', '那条对话的观察断了，重新选一次', { sessionId })
        // 直接置 null 会漏掉 idleTimer（60 秒抬眼定时器），而 stopWatch() 因为 watcher 已空就早退，
        // 每重连一次泄漏一个定时器。走 stopWatch() 关干净，再用 holdWatch 挡住自动重连。
        stopWatch()
        holdWatch = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }

  // ── 主动了解：不等那边推，她自己抬眼去读一眼 ───────────────────────────
  // inspect() 是冷读，不激活那条会话的 agent，所以看多少眼都不会干扰他干活。
  const IDLE_LOOK_MS = 15 * 60 * 1000   // 静默这么久，她才自己去看

  function summarizeEvents(events) {
    const asked = []
    const answers = []
    const tools = []
    let toolCalls = 0
    let lastEnd = null
    const tail = events.length > 6000 ? events.slice(-6000) : events
    for (const ev of tail) {
      const type = ev && ev.type
      if (type === 'user/message') {
        const text = messageText(ev.data)
        if (text) asked.push(text)
      } else if (type === 'assistant/message') {
        const text = messageText(ev.data)
        if (text) answers.push(text)
      } else if (type === 'tool/call') {
        toolCalls += 1
        const name = String((ev.data && ev.data.name) || '')
        if (name && tools.length < 8 && tools.indexOf(name) < 0) tools.push(name)
      } else if (type === 'turn/end') {
        lastEnd = (ev.data && ev.data.reason) || null
      }
    }
    return {
      turns: answers.length,
      toolCalls,
      tools,
      lastAsked: String(asked[asked.length - 1] || '').slice(0, 160),
      lastAnswer: String(answers[answers.length - 1] || '').slice(0, 220),
      lastEnd,
    }
  }

  async function lookNow(sessionId) {
    const c = ctrl()
    if (!c || !sessionId || typeof c.inspect !== 'function') return null
    try {
      const ins = await c.inspect(sessionId, new AbortController().signal)
      return summarizeEvents((ins && ins.events) || [])
    } catch (error) {
      log('work: inspect failed', { error: String(error?.message || error) })
      return null
    }
  }

  /** 静默太久时，她自己去看一眼，然后决定要不要开口。force = 手点「看一眼」，跳过静默阈值。 */
  async function idleLook(ac, force) {
    if (ac.signal.aborted || !watcher || watcher.looking) return
    const idleMs = Date.now() - (watcher.lastEventAt || watcher.startedAt || Date.now())
    if (!force && idleMs < IDLE_LOOK_MS) return
    if (!force && Date.now() - (watcher.lastSpokeAt || 0) < HEAVY.cooldownMinutes * 60000) return
    if (typeof observe !== 'function') return

    watcher.looking = true
    const sessionId = watcher.sessionId
    try {
      const summary = await lookNow(sessionId)
      if (!summary) return
      // 用读到的实况校准快照：她看的是真的，不是推演出来的
      touchSnap({
        tools: summary.tools,
        turns: summary.turns,
        toolCalls: summary.toolCalls,
        lastAsked: summary.lastAsked,
        lastAnswer: summary.lastAnswer,
        phase: summary.lastEnd && summary.lastEnd.kind === 'error' ? 'error' : undefined,
      })
      const quietMinutes = (Date.now() - (watcher.lastSpokeAt || Date.now())) / 60000
      const result = await observe({
        title: binder.title,
        rounds: summary.turns,
        minutes: Math.round((idleMs / 60000) * 10) / 10,
        tools: summary.tools,
        errors: summary.lastEnd && summary.lastEnd.kind === 'error' ? 1 : 0,
        lastAsked: summary.lastAsked,
        lastAnswer: summary.lastAnswer,
        quietMinutes: Math.round(quietMinutes * 10) / 10,
        lastSaid: watcher.lastSaid,
        idle: true,
      })
      if (!result || !result.ok || !result.speak) return
      if (watcher) {
        watcher.lastSpokeAt = Date.now()
        watcher.lastSaid = String(result.subtitle || '')
        watcher.lastEventAt = Date.now()   // 看过了，重新计时
      }
      push('care', String(result.subtitle || ''), {
        sessionId,
        emotion: result.emotion || '',
        audioUrl: result.audioUrl || '',
        idle: true,
      })
    } catch (error) {
      log('work: idle look failed', { error: String(error?.message || error) })
    } finally {
      if (watcher) watcher.looking = false
    }
  }

  /** 面板上「让她看一眼」：手动触发一次主动了解。 */
  async function look() {
    await load()
    const sessionId = binder.sessionId
    if (!sessionId) return { error: '还没选要观察的对话' }
    const summary = await lookNow(sessionId)
    if (!summary) return { error: '读不到那条对话' }
    if (watcher) {
      watcher.lastEventAt = Date.now()
      await idleLook(watcher.ac, true)
    }
    return { ok: true, summary, watching: Boolean(watcher) }
  }

  async function send(text) {
    await load()
    const body = String(text || '').trim()
    if (!body) return { error: '空的内容' }
    const c = ctrl()
    if (!c) return { error: '这个 Harness 没交出会话服务，没法观察' }
    if (!binder.sessionId) return { error: '还没选要观察的对话' }
    if (current) return { error: '上一个任务还在跑，先等它结束或者点停止' }

    // 不再往那边塞人设：人设一注入就会干扰它本来干活的判断。
    // 这边只是把你说的话原样投过去。
    const wrapped = body

    const sessionId = binder.sessionId
    const ac = new AbortController()
    current = { ac, sessionId, startedAt: Date.now(), answers: 0 }
    lastError = ''
    push('prompt', body, { sessionId, injected: wrapped.length - body.length })

    const requestId = 'chill-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    try {
      await c.prompt({
        requestId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: wrapped }],
      }, ac.signal)
    } catch (error) {
      current = null
      lastError = sendErrorText(error)
      push('error', '投递失败：' + lastError, { sessionId })
      return { error: lastError }
    }

    ;(async () => {
      try {
        await followOnce(c, sessionId, ac, body)
      } catch (error) {
        const msg = String(error?.message || error)
        if (!ac.signal.aborted) {
          lastError = msg
          push('error', '跟流出错：' + msg, { sessionId })
        }
      } finally {
        current = null
        push('done', '这一轮结束', { sessionId })
      }
    })().catch(() => {})

    return { ok: true, sessionId, injected: wrapped.length - body.length }
  }

  async function cancel() {
    const c = ctrl()
    const target = (current && current.sessionId) || binder.sessionId
    if (!c || !target) return { error: '没有在跑的对话' }
    try {
      c.cancel({ sessionId: target })
    } catch (error) {
      return { error: String(error?.message || error) }
    }
    if (current) {
      try { current.ac.abort() } catch { /* ignore */ }
      current = null
    }
    push('cancel', '已请求停止', { sessionId: target })
    return { ok: true }
  }

  async function state({ since = 0, withSessions = false } = {}) {
    await load()
    // 绑定还在、观察掉了（重启过 / 断流放弃）：顺手接上，面板一开就继续看着。
    // 但用户显式点过「全部解除」之后不再自动接——那道闸门就是 holdWatch。
    if (binder.sessionId && !watcher && !holdWatch) startWatch(binder.sessionId)
    const out = {
      ok: true,
      available: Boolean(ctrl()),
      bound: binder.sessionId ? { sessionId: binder.sessionId, title: binder.title } : null,
      busy: busy(),
      watching: Boolean(watcher),
      seq,
      turns: turns.filter((t) => Number(t.n) > Number(since || 0)).slice(-120),
      lastError,
    }
    if (withSessions) {
      const list = await sessions()
      out.sessions = list.items
      out.sessionsAvailable = list.available
      out.sessionsError = list.error || ''
      // 绑着的那条已经不在了（删了 / 是子代理会话被过滤掉）：别让界面还挂个"观察中"
      if (binder.sessionId && list.available) {
        out.boundStale = !list.items.some((item) => item.sessionId === binder.sessionId)
      }
    }
    return out
  }

  return { dir, state, sessions, bind, unbind, releaseAll, send, cancel, busy, look, ambientText, stopWatch }
}
