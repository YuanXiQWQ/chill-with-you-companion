/**
 * dsh-chill-with-you-companion — 聪音的"大脑"，跑在 DSH Host 里。
 *
 * 职责边界（重要）：
 *   本插件只负责「想」与「说」：人设、记忆、状态机、DeepSeek 调用、输出规范化、TTS 合成与缓存。
 *   本插件不碰游戏：不注入进程、不改存档、不播动画。
 *   游戏侧（表演端）只负责「演」：按本插件下发的动作指令播动画、显示字幕、播放 audioUrl。
 *
 * 对表演端暴露两类入口：
 *   POST /chill/v1/chat/completions   OpenAI 兼容（现成 AIChat 插件可直接指过来，零改造）
 *   POST /chill/v1/act                原生指令（带 actions[]/state/meta，供自研表演端使用）
 */
import { readFileSync, writeFileSync, rmSync, existsSync, appendFileSync, openSync, closeSync, mkdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, stat, appendFile, rename } from 'node:fs/promises'
import { mouthFrames, wavDuration } from './lib/lipsync.mjs'
import { createLlm } from './lib/llm.mjs'
import { createStateFile } from './lib/state-file.mjs'
import { createModelClient } from './lib/model-client.mjs'
import { registerPanelRoutes } from './routes/panel.mjs'
import { registerVoiceAdminRoutes } from './routes/admin-voice.mjs'
import { registerAdminRoutes } from './routes/admin.mjs'
import { registerPersonaRoutes } from './routes/persona.mjs'
import { registerMoodRoutes } from './routes/mood.mjs'
import { registerAudioRoutes } from './routes/audio.mjs'
import { registerAvatarRoutes } from './routes/avatar.mjs'
import { registerCharacterRoutes } from './routes/characters.mjs'
import { registerAssetRoutes } from './routes/assets.mjs'
import { registerVoiceRoutes } from './routes/voices.mjs'
import { registerKbRoutes } from './routes/kb.mjs'
import net from 'node:net'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyEvent,
  applyHeartbeat,
  buildAct,
  buildMessages,
  cacheKey,
  DEFAULT_ACTION_MAP,
  DEFAULT_STATE,
  encodeForJsonClient,
  encodeForLegacyClient,
  extractJsonObject,
  parseModelOutput,
  isQuestion,
  topicDrift,
  topicScore,
  emotionTier,
  MOTIFS,
} from './lib/core.js'
import { createMemoryStore } from './lib/memory-store.mjs'
import { createCharacters } from './lib/characters.mjs'
import { createVoices } from './lib/voices.mjs'
import { createKb } from './lib/kb.mjs'
import {
  EMPTY_MANIFEST,
  emotionFallbackCues,
  indexManifest,
  manifestSize,
  normalizeManifest,
  partOf,
  sanitizePerformance,
  summarizeForPrompt,
} from './lib/assets.js'

import { resolveConfig } from './lib/config.mjs'
import { createAuth, readBinary, readBody, sendJson, sendText } from './lib/http.mjs'
import { createFeed } from './lib/feed.mjs'
import { createGame } from './lib/game.mjs'
import { createVoice } from './lib/voice.mjs'
import { createCapabilities } from './lib/capabilities.mjs'

const VERSION = '0.10.1'

const execFileAsync = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))

export const name = 'dsh-chill-with-you-companion'
export const inject = ['webServer']

// 配置集中在 lib/config.mjs（DEFAULTS / resolveConfig / readFlag）。

// sendJson / sendText / readBody 在 lib/http.mjs。

function nowIso() {
  return new Date().toISOString()
}

export function apply(ctx, rawConfig = {}) {
  // 显式传插件目录：不传时 config.mjs 回落到 process.cwd()，
  // 手动 node serve.mjs、或用计划任务/服务拉起时全部路径都会指到启动目录。
  const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
  const cfg = resolveConfig(rawConfig, PLUGIN_DIR)
  const log = (...args) => ctx.logger?.info?.('[dsh-chill-with-you-companion]', ...args)

  // state.json 的读写与对账在 lib/state-file.mjs：那里的 state 就是下面这个对象本身，
  // 后面所有 state.xxx 与 saveState() 看到的是同一份，不用改调用点。
  const stateFile = createStateFile({
    path: join(cfg.dataDir, 'state.json'),
    defaults: DEFAULT_STATE,
    log,
    ensureDir: () => ensureDirs(),
  })
  const state = stateFile.state
  let memory = []
  let persona = ''
  let personaMtime = 0
  const memoryPath = join(cfg.dataDir, 'memory.jsonl')
  // 分层记忆：recent 原文窗口 + facts 长期事实 + summary 滚动摘要
  const mem = createMemoryStore({
    dir: join(cfg.dataDir, 'memory'),
    recentLimit: Math.max(6, cfg.memoryTurns || 12),
    forgetAfterDays: Number(cfg.forgetAfterDays) || 180,
  })
  const audioDir = join(cfg.dataDir, 'audio')
  const voices = createVoices({ dir: join(cfg.dataDir, 'voices'), refDir: join(HERE, 'ref'), log })
  const kb = createKb({ dir: join(cfg.dataDir, 'kb'), log })
  const assetsPath = join(cfg.dataDir, 'assets.json')
  // 游戏自报的资源清单：DS 只能从这里面挑，代码负责剪掉越界指令。
  let manifest = EMPTY_MANIFEST

  const ensureDirs = async () => {
    await mkdir(cfg.dataDir, { recursive: true })
    await mkdir(audioDir, { recursive: true })
  }

  // 角色卡：人设 + 剧情 + 声音 + 动作覆盖都装在 data/characters/<id>.json 里。
  // 换角色 = 激活另一张卡，不改代码。
  const chars = createCharacters({
    dir: join(cfg.dataDir, 'characters'),
    log,
    defaultId: 'satone',
    seedName: '聪音',
    seedPersona: async () => {
      try { return await readFile(cfg.personaPath, 'utf8') } catch { return '' }
    },
  })

  const loadPersona = async () => {
    try {
      const card = await chars.active()
      if (card && card.persona) {
        if (card.persona !== persona) log('character card loaded', { id: card.id, chars: card.persona.length })
        persona = card.persona
        return persona
      }
    } catch (error) {
      log('character card load failed, falling back to persona.md', { error: String(error?.message || error) })
    }
    try {
      const info = await stat(cfg.personaPath)
      if (info.mtimeMs !== personaMtime || !persona) {
        persona = await readFile(cfg.personaPath, 'utf8')
        personaMtime = info.mtimeMs
        log('persona.md loaded', { chars: persona.length })
      }
    } catch {
      if (!persona) persona = '你是聪音，安静、温和、说话很短。'
    }
    return persona
  }

  const loadMemory = async () => {
    try {
      await mem.open()
      memory = mem.recent(cfg.memoryTurns)
      log('memory opened', mem.stats())
    } catch (error) {
      log('memory open failed', { error: String(error?.message || error) })
      memory = []
    }
  }

  const loadState = stateFile.load
  const saveState = stateFile.save

  const appendTurn = async (userText, result, opts = {}) => {
    const said = String(result?.subtitle_text || result?.voice_text || '').trim()
    try {
      await ensureDirs()
      // 旁观轮次没有「用户发言」：硬塞一条假的会在 promptMemory 里变成
      // `user: （看了一眼他的进度）`，模型会以为他真的说过这句。
      // 记忆里只有她说的那一句，才诚实。
      if (!opts.skipUser) await mem.appendTurn({ role: 'user', content: userText })
      await mem.appendTurn({ role: 'assistant', content: said, emotion: result?.emotion || '', raw: JSON.stringify(result) })
      memory = mem.recent(cfg.memoryTurns)
      // 时间感：记下"这次说话是什么时候、聊的什么"，下一轮她才知道隔了多久。
      // 放在 appendTurn 里而不是 runTurn 开头——放开头的话本轮 prompt 读到的就是"刚刚"，
      // gap 永远是 0，"上次说话是三天前"永远说不出来。
      if (String(userText || '').trim()) {
        state.lastTalkAt = Date.now()
        state.lastTopic = String(userText).trim().replace(/\s+/g, ' ').slice(0, 40)
        await saveState()
      }
    } catch (error) {
      log('memory append failed', { error: String(error?.message || error) })
    }
    // 扩展点：写完记忆再广播，钩子可以读最新记忆做别的事（导出、统计、外部存档）
    caps.emit('turn', { userText, result, memory: mem.stats() })
  }

  // 滚动摘要：窗口外的原文压成一段自述，后台跑，不阻塞这一轮
  let compacting = false
  const compactMemory = async () => {
    if (compacting) return
    const pending = mem.pendingForSummary()
    if (pending.length < 8) return
    compacting = true
    try {
      const transcript = pending.map((m) => (m.role === 'assistant' ? '聪音：' : '他：') + m.content).join('\n')
      const out = await callModel([
        {
          role: 'system',
          content: '你是记忆整理器。只输出一个 json 对象：{"summary":"..."}。摘要用第三人称中文，保留关系进展、约定、他的偏好与习惯、一起发生过的事；200 字以内，不要评论，不要 markdown。她的长期设定（写小说、研究方向、和父母的关系）是背景，不是进展——不要写成「仍然卡在…」「反复重写…」这种当前状态，也不要把同一件反复说的事累计成好几遍。',
        },
        {
          role: 'user',
          content: '已有摘要：' + (mem.summaryText || '（空）') + '\n新的对话：\n' + transcript + '\n请输出合并后的摘要。',
        },
      ])
      const obj = extractJsonObject(String(out.content || ''))
      const text = obj && typeof obj.summary === 'string' ? obj.summary.trim() : ''
      if (text) {
        await mem.setSummary(text, Date.parse(pending[pending.length - 1].at || '') || Date.now())
        log('memory summary updated', { chars: text.length, covered: pending.length })
      }
    } catch (error) {
      log('memory compact failed', { error: String(error?.message || error) })
    } finally {
      compacting = false
    }
  }

  // ---- 模型供应商：默认借 DSH 的 key，控制台里可切换 / 增删 ----
  const llm = createLlm({
    dataDir: cfg.dataDir,
    cfg,
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
    join,
    log,
  })

  // 每次调用记一行用量。DeepSeek 的 prefix cache 命中价是全价的一成，
  // 所以 hit/miss 分开记才有意义——只看 prompt_tokens 分不出钱花在哪儿。
  const USAGE_LOG = join(cfg.dataDir, 'usage.log')
  const recordUsage = (usage, ms, model) => {
    if (!usage) return
    const row = {
      t: new Date().toISOString(),
      model,
      ms,
      prompt: Number(usage.prompt_tokens) || 0,
      hit: Number(usage.prompt_cache_hit_tokens) || 0,
      miss: Number(usage.prompt_cache_miss_tokens) || 0,
      out: Number(usage.completion_tokens) || 0,
    }
    try { appendFileSync(USAGE_LOG, JSON.stringify(row) + '\n') } catch { /* 记账失败不该影响对话 */ }
  }

  /** 模型调用：交给 lib/model-client.mjs（重试 + 跨 provider 降级都在里面，依赖注入）。 */
  const model = createModelClient({ cfg, llm, log, recordUsage })
  const callModel = model.call
  /** TTS：调本地 GPT-SoVITS，按内容哈希缓存 wav，返回可被游戏直接播放的 URL。 */
  let lastTtsError = ''
// 她自己的开口节拍：隔一阵子没人说话，她会自己搭一句（走完整人设链路，不是汇报）
let lastTurnAt = Date.now()
let sparkTimer = null
// 系统给的背景一律用第三人称「他」写（旁白视角），但聪音说话必须用「你」。
// 不点明这一句，她会照着上下文的措辞跟着说「他」，一下子就出戏了。
const PERSPECTIVE = '（下面背景里提到的「他」，指的就是你现在面对的这个人。你叫他キミ，中文写「你」——不要跟着用「他」。）'
  // 语音引擎自己死后不会有任何报错上来（进程直接没了）：合成一失败就叫一次看门狗，
  // 45 秒内不重复拉，避免连续几轮把人叫起来三次。本轮仍只出字幕，下一轮就有声音。
  const noteTtsFailure = (voiceText, elapsedMs, reason) => {
    try {
      appendFileSync(join(cfg.dataDir, 'tts.log'), '[' + new Date().toISOString().slice(11, 23) + '] len=' + voiceText.length + ' ms=' + elapsedMs + ' ' + reason + ' | ' + voiceText.slice(0, 60).replace(/\s+/g, ' ') + '\n')
    } catch { /* 写日志失败不影响主流程 */ }
  }

  /**
   * 冷启动预热：GPT-SoVITS 加载完模型后的第一次请求要把说话人嵌入、参考音频都走一遍，
   * 常常 20 秒以上——之前"有的语句没合成"里最新那条就是这么丢的。
   * 这里在引擎刚上线时先用一句极短的话把它焐热，真台词就不必替冷启动买单。
   */
  /**
   * 起语音任务。关键点：wscript 活着但 python 已经死了的时候，任务状态仍是 Running，
   * 此时 schtasks /run 会被直接拒掉（"任务已在运行"），表现为点了启动毫无反应。
   * 所以先 /end 清掉僵死实例，再重试 /run，直到端口真的起来。
   */

  const synthesize = async (voiceText, langOverride) => {
    if (!cfg.tts.enabled || !voiceText) return null
    const vs = await voices.activeVoice()
    const key = cacheKey({
      text: voiceText,
      lang: langOverride || vs.textLang || cfg.tts.textLang,
      ref: vs.path || vs.file,
      prompt: vs.promptText,
      promptLang: vs.promptLang,
      speed: vs.speedFactor,
      url: cfg.tts.url,
    })
    const file = join(audioDir, `${key}.wav`)
    try {
      const cached = await stat(file)
      if (cached.size > 0) {
        let duration = 0
        try { duration = wavDuration(await readFile(file)) } catch { duration = 0 }
        lastTtsError = ''
        return { audioUrl: `/chill/v1/audio?name=${key}.wav`, cached: true, duration }
      }
    } catch {
      // 未缓存，继续合成
    }
    const query = new URLSearchParams({
      text: voiceText,
      text_lang: langOverride || vs.textLang || cfg.tts.textLang,
      ref_audio_path: vs.path || vs.file,
      prompt_text: vs.promptText,
      prompt_lang: vs.promptLang,
      speed_factor: String(vs.speedFactor),
    })
    // 合成可能被游戏抢显存拖慢：超时/中断就再试一次，别因为一次抖动把这一句直接判成"没声音"
    const attempts = Math.max(1, Number(cfg.tts.retries ?? 1) + 1)
    let buffer = null
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAt = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), cfg.tts.timeoutMs)
      try {
        const response = await fetch(`${cfg.tts.url.replace(/\/$/, '')}/tts?${query}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`tts ${response.status}`)
        const data = Buffer.from(await response.arrayBuffer())
        if (data.length < 1024) throw new Error(`tts returned ${data.length} bytes`)
        buffer = data
        lastError = null
        break
      } catch (error) {
        lastError = error
        noteTtsFailure(voiceText, Date.now() - startedAt, 'attempt ' + attempt + '/' + attempts + ' ' + String(error?.message || error))
      } finally {
        clearTimeout(timer)
      }
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 600))
    }
    if (!buffer) {
      const reason = String(lastError?.message || lastError || 'unknown')
      log('tts failed, degrade to subtitle-only', { error: reason, attempts })
      lastTtsError = reason
      healVoiceEngine()
      return null
    }
    await ensureDirs()
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp'
    await writeFile(tmp, buffer)
    await rename(tmp, file)
    lastTtsError = ''
    return { audioUrl: `/chill/v1/audio?name=${key}.wav`, cached: false, bytes: buffer.length, duration: wavDuration(buffer) }
  }

  // 表演端（ChillPerformer）支持扩展情绪集，所以这里不跟随配置里的 base8：
  // base8 是给 AIChat 那种固定 8 标签客户端用的兼容值。
  const EMOTION_SET = 'extended'

  const authorized = createAuth(cfg)

  /** 一轮完整对话：读人设 → 拼上下文 → 调模型 → 规范化 → 校验表演 → 合成语音。 */
  // 动作克制闸门：只给"值得动一下"的情绪配动作，且有冷却与概率，其余留给游戏自身的动作。
let lastGestureTurn = -99

/**
 * 动作闸门。2026-11-13 重写：原来是一张"白名单 + 固定概率"，结果是
 * 模型说十句只有一句动手，情绪看起来是死的。现在按情绪分档决定：
 *   strong 情绪（害羞/笑/欢呼/沮丧…）几乎必动 —— 这是"灵动"的主要来源
 *   soft 情绪按 gestureChance（默认 0.45）轻带一下
 *   still 情绪不动手（低落时乱挥手反而破坏氛围）
 * 冷却只对 soft 生效，且默认 1 轮；strong 情绪无视冷却。
 */
function gateCues(cues, emotion, cfg, actionMap) {
  if (!cues || cues.length === 0) return cues
  const mode = String(cfg.motionMode || 'gentle')
  if (mode === 'off') return []
  // turnCount 在本轮结束才 +1，这里 +1 才是"当前第几轮"
  const turn = Number(state.turnCount || 0) + 1
  let allowAnim = true
  if (mode === 'gentle') {
    const tier = emotionTier(emotion)
    if (tier === 'still') {
      // 低落/喝水这类情绪：动作收着，但别把 sfx/scene 一起砍掉
      allowAnim = false
    } else if (tier === 'soft') {
      const cooldown = cfg.gestureCooldownTurns == null ? 1 : Number(cfg.gestureCooldownTurns)
      if (turn - lastGestureTurn < cooldown) allowAnim = false
      else {
        // 用 ?? 而不是 ||：配 0（永不随机出手）必须真的生效
        const chance = cfg.gestureChance == null ? 0.7 : Number(cfg.gestureChance)
        if (Math.random() > chance) allowAnim = false
      }
    }
  }
  if (allowAnim) lastGestureTurn = turn
  // 只限制"动作"的数量，sfx/scene 不该被动作预算顺手砍掉
  const cap = Math.max(1, cfg.maxCues == null ? 1 : Number(cfg.maxCues))
  // soft 档没抽中时不是"完全静止"，而是降级成点头/偏头这类头部微动：
  // 说话时有细微反应，比一动不动更像活着，也不会夸张。
  const headOnly = (cfg.microHeadCues || ['anim_story_base001_sub_nod', 'anim_story_base001_sub_thinking1_start'])
  const kept = []
  let anims = 0
  let usedHead = false
  for (const cue of cues) {
    if (cue && cue.slot === 'animations') {
      if (!allowAnim) {
        // 情绪签名动作不算"夸张"：低落就该垂着（sub_sad），害羞就该躲开（sub_shy）。
        // 把这类也砍成点头，等于每种情绪都演同一张脸。
        const wantId = String(actionMap?.[emotion] || '')
        if (wantId && cue.id === wantId) { kept.push(cue); continue }
        if (emotionTier(emotion) === 'soft' && !usedHead) {
          const id = headOnly[turn % headOnly.length]
          if (id) { kept.push(Object.assign({}, cue, { id })); usedHead = true }
        }
        continue
      }
      if (anims >= cap) continue
      anims += 1
    }
    kept.push(cue)
  }
  return kept
}

// Host 会定期推来「他那边在干什么」：让聪音知道进度，而不是每轮重新听写一遍。
// 只进她自己的对话上下文，绝不写进被观察的那条会话。
let ambient = ''
let ambientAt = 0
const ambientBlock = () => {
  if (!ambient) return ''
  if (Date.now() - ambientAt > 30 * 60 * 1000) return ''   // 半小时没更新就算过期
  return '## 你旁边的近况（你刚抬眼看到的，不是他亲口说的）\n'
    + ambient
    + '\n（他在问你的时候，这些就是你该知道的事——别反过来问他"你在弄什么"，那会显得你根本没在看。）'
}

let turnChain = Promise.resolve()
// 有没有一轮正在跑。/observe 靠它避免在两个真人回合之间插话。
let turnActive = false
const serializedTurn = (userText, options) => {
  const run = turnChain.then(() => {
    turnActive = true
    return runTurn(userText, options).finally(() => { turnActive = false })
  })
  // 每一轮（包括她自己的）都重置开口节拍
  const after = () => { lastTurnAt = Date.now(); scheduleSpark() }
  turnChain = run.then(after, after)
  return run
}

// 用户最后一次真的开口的时间。她自己的主动搭话会刷 lastTurnAt，不能用来判断「他多久没说话」。
let lastUserAt = Date.now()
// 她连着说了几次他都没回。用来把间隔拉长，避免自说自话。
let sparkStreak = 0

// ── 她自己开口 ───────────────────────────────────────────────────────────
// 不是被工作触发的汇报，是自己想说话：隔一阵子搭一句，走完整人设链路（会写进聊天历史）。
// 频率跟着番茄钟阶段走：专注时几乎不打扰，休息时话密，平常居中。
const SPARK_GAP = {
  focus: { min: 20, max: 32 },   // 他在专注：稀一点，但别消失，一句就完
  break: { min: 8, max: 14 },    // 他在休息：话密，催他动一动
  idle: { min: 13, max: 18 },    // 没在计时：大约一刻钟搭一句
}
const gapFor = (phase) => SPARK_GAP[phase === 'focus' || phase === 'break' ? phase : 'idle']

// 静默超过这么久，开口的性质就变了：不是随口搭话，是真的在意。
const QUIET_LONG = 30 * 60 * 1000

const CARES = [
  '他很久没出声了，你有点在意。问一句他在忙什么——轻轻的，别像查岗。',
  '安静了挺久。你抬头看了眼他的方向，想问一句还顺不顺，语气像随口一提。',
  '好一阵子没动静。你想说句关心的话，别说"要不要休息"这种空话，说具体的——水、脖子、眼睛。',
  '很久没说话了。你其实有点担心他是不是卡住了，问一句，他不想说就算了。',
  '他好像一直没动。你放下笔，想跟他搭一句，说的可以是自己的事，让他有个由头回话。',
]

const SPARKS = {
  focus: [
    '他番茄钟在走，正专心。你自己也在忙自己的，随口一句就完——别提问，别让他分心。',
    '屋里很安静，他在专注。你想让他知道你还在，一句极短的，说完接着忙自己的。',
  ],
  break: [
    '他刚跑完一个番茄钟，正在歇。你想说一句自己的状态——肩膀僵、想站起来走两步、或者纯粹觉得这屋里有点静。说他该干什么的话别说。',
    '他在休息。你想搭句话，说的要是你自己的事：窗外那条街、刚听到的动静、教授发的通知。别问他进度，也别点评他刚干完的活。',
    '歇了一会儿了。你有点想跟他多聊两句，你起个头就好——聊点跟工作无关的，或者抱怨一句自己的事。',
  ],
  idle: [
    '他没出声。你自己想搭句话——说说手边正在忙的那件事，或者突然想起的一件小事。别问"在吗"。',
    '安静了一会儿。你在琢磨一件跟他手头无关的小事，随口说出来。',
    '你抬头看了他一眼。有件你其实有点在意的事，想问一句，别客套。',
    '你刚把一件事做到一半又推翻重来。想跟他说一句你自己都还没想清楚的话。',
    '你刚给自己倒了杯咖啡。想跟他说一句没什么用、但你就是想说的话。',
  ],
}
const sparksOf = (phase) => SPARKS[phase === 'focus' || phase === 'break' ? phase : 'idle']

function scheduleSpark() {
  if (sparkTimer) {
    clearTimeout(sparkTimer)
    sparkTimer = null
  }
  if (!llm.resolve().apiKey) return
  const g = gapFor(state.phase)
  const span = Math.max(1, g.max - g.min)
  const gapMs = (g.min + Math.random() * span) * 60 * 1000
  // 她连着开口几次他都没理，就别一直说：间隔按次数拉长，不刷屏也不消失。
  const mult = sparkStreak >= 4 ? 2.6 : (sparkStreak >= 2 ? 1.7 : 1)
  const wait = Math.max(60 * 1000, gapMs * mult - (Date.now() - lastTurnAt))
  sparkTimer = setTimeout(() => { void spark() }, wait)
  if (sparkTimer.unref) sparkTimer.unref()
}

/**
 * 每次真正下发一条 cue 都往 data/cue.log 记一行。
 *
 * 为什么单独记：`turns.jsonl` 存的只是**模型原始输出**，兜底补的动作、
 * gateCues 过滤、情绪签名替换、三段展开全在它之后，所以真出演出问题时
 * 光看那里判断不了「到底演了什么」。这个文件记的是**最后送出去的那一份**。
 */
const CUE_LOG = join(cfg.dataDir, 'cue.log')
const CUE_TEST_LOG = join(cfg.dataDir, 'cue.test.log')
const CUE_LOG_MAX_BYTES = 200 * 1024
let cuePushes = 0
// /play 的去重闸门：记住最后一条的内容指纹与时间
let lastCue = { sig: '', at: 0, seq: 0 }

function logCue(item, seq) {
  try {
    const cues = (Array.isArray(item?.performance) ? item.performance : []).map((c) => ({
      s: c?.slot || '',
      id: String(c?.id || '').replace(/^anim_/, ''),
      at: Number(c?.at) || 0,
      d: Number(c?.durationMs) || 0,
      w: c?.why || '',
    }))
    const row = {
      // 本地时间。原来用 toISOString().slice(11,23) 是 UTC，和本机差 8 小时，
      // 翻日志时「05:42」其实是下午 1 点，对不上自己是什么时候玩的。
      t: localClock(),
      seq,
      src: item?.source || '',
      q: String(item?.question || '').slice(0, 40),
      scope: item?.motionScope || '',
      chars: String(item?.subtitle || '').length,
      sub: String(item?.subtitle || '').slice(0, 40),
      dur: Number(item?.durationMs) || 0,
      // 记一下音频尾巴：区分真实演出和自己造的测试音（/b/、/x/ 这种前缀）全靠它
      audio: String(item?.audioUrl || '').slice(-18),
      cues,
    }
    // 测试面板和联调脚本的演出另存一份：查问题时要能看见她当时演了什么，
    // 但混进 cue.log 会埋掉真实演出。分开写，各自独立裁剪。
    appendFileSync(item?.sandbox ? CUE_TEST_LOG : CUE_LOG, JSON.stringify(row) + '\n')
  } catch { /* 记日志失败不能影响演出 */ }
}

/** HH:mm:ss.SSS，本地时间。 */
function localClock() {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3)
}

/** 长跑了几天就砍掉旧的一半，别让日志无限涨。 */
function pruneCueLog() {
  for (const path of [CUE_LOG, CUE_TEST_LOG]) {
    try {
      if (!existsSync(path)) continue
      if (readFileSync(path, 'utf8').length < CUE_LOG_MAX_BYTES) continue
      const lines = readFileSync(path, 'utf8').trimEnd().split('\n')
      writeFileSync(path, lines.slice(-200).join('\n') + '\n')
    } catch { /* 同上 */ }
  }
}

/**
 * 这次调用是不是自动化/联调（而不是真人在面板里说话）。
 *
 * 只靠调用方「记得传 sandbox:true」不可靠——2026-11-14 就因为漏传，一句测试输入
 * 被当成真实对话写进了聪音的长期记忆。这里再加一道自动判定：
 *
 *   面板在 127.0.0.1:10722，侧车在 10723，所以真人操作必然是跨源请求，浏览器一定带 Origin。
 *   裸 fetch / curl / 脚本不带 Origin，一律按测试处理。
 *
 * 显式传 sandbox:false 可以覆盖，留给「验证真实链路」的场合。
 */
function isAutomation(req, json) {
  if (json?.sandbox === false) return false
  if (json?.sandbox === true) return true
  const origin = String(req?.headers?.origin || '')
  const referer = String(req?.headers?.referer || '')
  // 用 URL 解析代替写死的正则：origin / referer 可能带路径、也可能不带端口。
  // 写死 127.0.0.1:10722 时，dsh web 换个端口，真人对话就被判成自动化——
  // 不写记忆、演出只进 cue.test.log，而且不报错。
  const panelPort = String(cfg.panelPort || process.env.DSH_WEB_PORT || 10722)
  const isPanel = (u) => {
    try {
      const url = new URL(String(u || ''))
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return false
      return !url.port || url.port === panelPort
    } catch { return false }
  }
  if (isPanel(origin)) return false
  if (isPanel(referer)) return false
  // 快捷浮窗的页面是侧车自己发的（Origin 就是 10723），天生不等于面板端口，
  // 会被上面判成自动化——结果就是「快捷框说的话永远进不了控制台记录」。
  // 页面自己带 x-chill-quick: 1 认领身份；别的裸脚本照样按测试处理。
  if (String(req?.headers?.['x-chill-quick'] || '') === '1') return false
  return true
}
/** 下发一条 cue 的统一入口：push 进队列 + 记一行 + 更新去重指纹。 */
function pushCue(item) {
  const seq = feed.push(item)
  // 测试面板和联调脚本的演出不进 cue.log（会埋掉真实演出），
  // 但也不能不留痕——查问题时得能看见她当时演了什么。logCue 内部按 sandbox 分流到 cue.test.log。
  logCue(item, seq)
  // 指纹记在这里而不是各调用点，否则 /act 推完不更新它，紧接着的 /play 就拦不住
  lastCue = {
    sig: String(item?.audioUrl || '') + '|' + String(item?.subtitle || '').slice(0, 40),
    at: Date.now(),
    seq,
  }
  // 记住这一轮用了什么动作，下一轮 prompt 里列给模型，免得它连着用同一个姿势
  try {
    const seen = new Set()
    for (const c of Array.isArray(item?.performance) ? item.performance : []) {
      const base = String(c?.id || '').replace(/^anim_/, '').replace(/_(start|loop|end)$/, '')
      if (base) seen.add(base)
    }
    if (seen.size) {
      const prev = Array.isArray(state.recentActions) ? state.recentActions : []
      state.recentActions = [...new Set([...prev, ...seen])].slice(-5)
    }
  } catch { /* 记动作失败不影响演出 */ }
  cuePushes += 1
  if (cuePushes % 50 === 0) pruneCueLog()
  return seq
}

/** 把一轮结果推给游戏并返回摘要。spark / 番茄钟播报共用。 */
function emitTurn({ parsed, audio, cues, mouth }, source) {
  const subtitle = String(parsed.subtitle_text || '').trim()
  if (!subtitle) return null
  const item = buildCueItem({
    subtitle,
    audioUrl: (audio && audio.audioUrl) || '',
    performance: cues || [],
    mouthFps: cfg.mouthFps || 0,
    source,
    durationMs: audio && audio.duration > 0 ? audio.duration * 1000 : 0,
  })
  Object.assign(item, flatMouth(mouth))
  const seq = pushCue(item)
  caps.emit('cue', item)
  log(source + ': 她开口', { subtitle: subtitle.slice(0, 30), seq })
  return { subtitle, emotion: parsed.emotion, voiceText: parsed.voice_text, audioUrl: item.audioUrl, seq }
}

/** 番茄钟到点 / 提前停下：她顺口说一句。 */
async function pomoSay(kind, info) {
  if (!llm.resolve().apiKey) return null
  const minutes = Math.max(1, Math.round(Number(info && info.minutes) || 0))
  const remainMin = Math.max(1, Math.round(((info && info.remainMs) || 0) / 60000))
  let scene
  if (kind === 'break') scene = '他那个番茄钟刚好走完了，一共 ' + minutes + ' 分钟，人刚停下来。你手边的事也正好卡着，想说一句你自己的状态——累了、眼睛干了、想动一动。'
  else if (kind === 'stopped') scene = '他把番茄钟提前停了，还剩 ' + remainMin + ' 分钟没走完，就已经 ' + minutes + ' 分钟了。你抬了下眼，想说一句——别追问他为什么停。'
  else return null
  try {
    const result = await serializedTurn(
      '（旁白，不是他说的：' + scene + '别用祈使句指挥他该做什么，也别问"还撑得住吗"这种话——你说的是你自己。）',
      { storeAs: '（番茄钟）' },
    )
    return emitTurn(result, 'pomodoro')
  } catch (error) {
    log('pomodoro say failed', { error: String(error?.message || error) })
    return null
  }
}

async function spark(force) {
  sparkTimer = null
  try {
    if (!llm.resolve().apiKey) return null
    // 静默时长决定要不要说、说什么：不到点的门槛拦在前面，太长就换成关心
    const quietMs = Date.now() - lastUserAt
    if (!force && quietMs < gapFor(state.phase).min * 60 * 1000) return null
    const pool = quietMs >= QUIET_LONG ? CARES : sparksOf(state.phase)
    let line = pool[Math.floor(Math.random() * pool.length)]
    // 悬着的话题优先：他提过但没说完的事，比任何模板都更像「认识一个人」。
    // 人不会反复问「你在忙吗」，但会记得「你上次说的那个后来怎么样了」。
    const loops = mem.openLoops(1)
    if (loops.length && Math.random() < 0.6) {
      line = `你忽然想起他之前提过一件事，还没下文：「${loops[0].text}」。想问一句后来怎么样了——`
        + '语气轻一点，别像在查进度，也别连着问第二遍。'
    } else if (ambientBlock()) {
      // 观察着的时候，她知道他那边在做什么——顺着那件事搭话，别问「在忙吗」这种等于没看的话
      line += '（你抬眼看过他那边，知道他在弄什么。想搭话就顺着那件具体的事说一句——'
        + '别问「在忙吗」「忙完了吗」，那显得你刚才根本没看。）'
    }
    const result = await serializedTurn(
      '（旁白，不是他说的：' + line + '）',
      { spark: true, storeAs: '（她自己开口）' },
    )
    sparkStreak += 1
    return emitTurn(result, 'spark')
  } catch (error) {
    log('spark failed', { error: String(error?.message || error) })
    return null
  } finally {
    if (!sparkTimer) scheduleSpark()
  }
}

const runTurn = async (userText, options = {}) => {
    const tStart = Date.now()
    if (!options.spark) { lastUserAt = Date.now(); sparkStreak = 0 }
    const [currentPersona] = await Promise.all([loadPersona()])
    const assetBrief = summarizeForPrompt(manifest, { budget: cfg.assetBudget, perSlot: cfg.assetPerSlot })
    const memBlock = mem.buildMemoryBlock(String(userText ?? ''), { k: 6, maxChars: 600 })
    // 角色卡里的剧情/设定：always 条目每轮都进，其余按话题匹配
    const loreText = await chars.loreBlock(String(userText ?? ''), { k: 4, maxChars: 1400, alwaysMax: 1200 })
    let kbMode = 'chat'
    try {
      kbMode = await kb.getMode()
    } catch { /* 读不到就按 chat */ }
    let kbSkills = ''
    try {
      kbSkills = await kb.capabilityBlock()
    } catch (error) {
      log('kb: 能力段失败', String(error?.message || error))
    }
    // 沙箱：控制台测试页用。不写历史、不提炼事实、不动状态，纯算一轮。
    const sandbox = options.sandbox === true
  // sandbox 默认连历史一起清空，好让结果可复现；但要验证「历史进 prompt」
  // 这条链路时（server.smoke 的用例）得能读到历史，又不想写记忆——用这个开关。
  const withHistory = options.withHistory === true
    let kbBody = ''
    let kbHits = []
    try {
      kbBody = await kb.block(String(userText ?? ''), { k: 5, maxChars: 2600 })
      if (sandbox) {
        kbHits = (await kb.search(String(userText ?? ''), { k: 5 })).map((h) => h.libName + ' / ' + h.docName + ' (' + Number(h.score || 0).toFixed(1) + ')')
      }
    } catch (error) {
      log('kb: 检索失败', String(error?.message || error))
    }
    const card = await chars.active()
    const turnActionMap = card && card.actionMap ? { ...cfg.actionMap, ...card.actionMap } : cfg.actionMap
    // 历史里混进过"她没说话/说了中文"的坏轮次，会把模型带成同样的风格：喂 prompt 前滤掉
    // 只剔除真正坏掉的轮次（空回复 / 兜底道歉句）；她的正常回复存的是中文字幕，必须留着——
    // 之前按"有没有假名"过滤，把她的回复全删了，历史只剩一串我的提问，模型于是总在答上一句。
    const BROKEN_SAY = /^(\s*|ごめん、うまく言えなかった。もう一度言ってくれる？)$/
    // （番茄钟）/（她自己开口）/（她自己开口）这类是内部触发标记，写进历史是为了记住
    // "她这句话被什么触发的"，但她不是用户说的话。原样喂回去模型会当成用户在提问，
    // 于是一边回答一个不存在的"番茄钟"，一边把话题拽回工作。
    const TRIGGER_MARK = /^（[^）]{1,14}）$/
    const asPromptTurn = (m) => {
      if (!m) return m
      if (m.role === 'user') {
        const ut = String(m.content || '').trim()
        return TRIGGER_MARK.test(ut) ? { role: 'user', content: '（这一句是你自己开口说的，他没有提问。）' } : m
      }
      if (m.role !== 'assistant') return m
      const text = String(m.content || '').trim()
      if (!text || BROKEN_SAY.test(text)) return null
      if (text.startsWith('{')) {
        // 只凭首字符 '{' 就信任会把"被截断的半截 JSON"写进历史，之后每轮污染 prompt
        try {
          const obj = JSON.parse(text)
          const v = obj && typeof obj.voice_text === 'string' ? obj.voice_text.trim() : ''
          if (v) return m
        } catch { /* 落到底下的重打包分支 */ }
        return null
      }
      let raw = {}
      try { raw = JSON.parse(m.raw || '{}') } catch { raw = {} }
      const voice = String(raw.voice_text || '')
      if (!voice) return null
      return { role: 'assistant', content: JSON.stringify({ emotion: raw.emotion || 'Agree', voice_text: voice, subtitle_text: text, performance: [] }) }
    }
    const promptMemory = memory.map(asPromptTurn).filter(Boolean)
    // 窗外的景：和画面保持一致，她说"天黑了"才不是在瞎编。
    // 启动早期 game 可能还没建好，拿不到就不提。
    let windowViewNow = ''
    try { windowViewNow = String(game.snapshot()?.windowView || '') } catch { /* 早期没有心跳 */ }
    const messages = buildMessages({
      persona: currentPersona,
      memory: (sandbox && !withHistory) ? [] : promptMemory,
      state,
      userText,
      emotionSet: EMOTION_SET,
      assetBrief,
      factsText: [PERSPECTIVE, memBlock.facts].filter(Boolean).join('\n'),
      nearbyText: ambientBlock(),
      loreText,
      kbText: [kbSkills, kbBody].filter(Boolean).join('\n\n'),
        mode: kbMode,
      summaryText: memBlock.summary,
      actionMap: turnActionMap,
      windowView: windowViewNow,
    })
    let model = await callModel(messages)
    const parseOpts = {
      emotionSet: EMOTION_SET,
      fallbackEmotion: cfg.fallbackEmotion,
      maxSubtitle: cfg.maxSubtitle,
      maxVoice: cfg.maxVoice,
      textLang: cfg.tts.textLang,
    }
    let parsed = parseModelOutput(model.content, parseOpts)
    // 语种护栏：字幕栏必须是中文。假名占多数说明模型把日文台词塞进了字幕（或吐了残片），
    // 这种回合在游戏里会显示成日文，直接当"没说出来"重来。
    const subtitleLooksJapanese = (s) => {
      const text = String(s || '').trim()
      if (!text) return false
      const kana = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length
      const han = (text.match(/[\u4e00-\u9fff]/g) || []).length
      const latin = (text.match(/[A-Za-z]/g) || []).length
      return kana > 0 && kana >= han && kana >= latin
    }
    if (subtitleLooksJapanese(parsed.subtitle_text) && String(parsed.voice_text || '').trim()) {
      log('subtitle-in-japanese, retrying', { subtitle: String(parsed.subtitle_text).slice(0, 30) })
      parsed.subtitle_text = ''
      parsed.warnings = (parsed.warnings || []).concat('subtitle-not-chinese')
    }
    // 空输出自救：模型偶尔只吐空白（尤其在历史里有空回合时），带提示重试两次
    for (let attempt = 0; attempt < 2 && !String(parsed.subtitle_text || '').trim(); attempt += 1) {
      log('empty-say, retrying', { attempt: attempt + 1, raw: String(model.content || '').slice(0, 40) })
      // 空输出的诱因是上下文太长：换一份精简上下文重来，仍然要 JSON 契约
      const shortMessages = buildMessages({
        persona: await loadPersona(),
        memory: memory.slice(-2),
        state,
        userText,
        emotionSet: EMOTION_SET,
        assetBrief,
        factsText: '',
        summaryText: '',
      })
      const retryMessages = shortMessages.concat([
        { role: 'user', content: '（系统提示）上一轮你什么都没说。请按契约只输出一个 json 对象，voice_text 必须是日文假名台词。' },
      ])
      model = await callModel(retryMessages)
      parsed = parseModelOutput(model.content, parseOpts)
      if (String(parsed.subtitle_text || '').trim()) break
    }
    if (!String(parsed.subtitle_text || '').trim()) {
      // 两次都空：给一句体面的兜底，别让游戏和聊天框留白
      parsed.subtitle_text = '抱歉，刚没接上话。你再说一次好吗？'
      parsed.voice_text = parsed.voice_text || 'ごめん、うまく言えなかった。もう一度言ってくれる？'
      parsed.warnings = (parsed.warnings || []).concat('empty-say-fallback')
      log('empty-say fallback used')
    }
    // 答偏自救：他问的是问题、回复却完全没接话题
    if (isQuestion(userText) && topicDrift(userText, parsed.subtitle_text)) {
      log('off-topic reply, retrying', { user: String(userText).slice(0, 30), reply: String(parsed.subtitle_text).slice(0, 30) })
      try {
        const retryMessages = buildMessages({
          persona: await loadPersona(),
          memory: promptMemory.slice(-6),
          state,
          userText,
          emotionSet: EMOTION_SET,
          assetBrief,
          factsText: '',
          summaryText: '',
        }).concat([
          { role: 'user', content: '（系统提示）他刚说的是「' + String(userText).slice(0, 40) + '」，你上一句答偏了，没接住他的问题。请正面回他那句话，一句话，仍然是 json 契约。' },
        ])
        const second = await callModel(retryMessages)
        const alt = parseModelOutput(second.content, parseOpts)
        if (String(alt.subtitle_text || '').trim() && topicScore(userText, alt.subtitle_text) >= topicScore(userText, parsed.subtitle_text)) {
          parsed = alt
          model = second
          log('off-topic retry accepted')
        } else {
          log('off-topic retry rejected, escalating to minimal context')
          // 二次仍答偏：退到最小上下文（只有他这一句），彻底甩开被污染的对话历史
          const minimal = buildMessages({
            persona: await loadPersona(),
            memory: [],
            state,
            userText,
            emotionSet: EMOTION_SET,
            assetBrief: '',
            factsText: '',
            summaryText: '',
          }).concat([
            { role: 'user', content: '（系统提示）他这一句是：「' + String(userText).slice(0, 40) + '」。只回答这一件事，一句话，不要提报告、番茄钟、天气或任何别的话题。' },
          ])
          const third = await callModel(minimal)
          const alt3 = parseModelOutput(third.content, parseOpts)
          if (String(alt3.subtitle_text || '').trim() && topicScore(userText, alt3.subtitle_text) > topicScore(userText, parsed.subtitle_text)) {
            parsed = alt3
            model = third
            log('minimal-context retry accepted')
          } else {
            log('minimal-context retry rejected')
          }
        }
      } catch (error) {
        log('off-topic retry failed', { error: String(error?.message || error) })
      }
    }
    // 资源白名单校验：清单为空时退回"情绪 → 单动作"，保持与 v2 行为一致。
    let cues = null
    let dropped = []
    if (manifestSize(manifest).total > 0) {
      // maxCues 是"动作克制"的预算，不该把 sfx/scene 一起挤掉：给非动作槽留出余量，
      // 动作数量在 gateCues 里单独卡
      const animBudget = Math.max(1, Number(cfg.maxCues) || 1)
      const result = sanitizePerformance(parsed.performance, manifest, {
        maxCues: animBudget + 3,
        maxAtMs: cfg.maxAtMs,
      })
      cues = result.cues
      dropped = result.dropped
      const fromModel = Array.isArray(parsed.performance) && parsed.performance.length > 0
      const hasAnim = cues.some((c) => c && c.slot === 'animations')
      // 没有动作就按情绪补一个：光有字幕没人动，看起来就是"死的"
      if (!hasAnim) {
        const fb = emotionFallbackCues(parsed.emotion, turnActionMap, manifest)
        if (fb.length) cues = [...fb, ...cues]
      }
      // 表演克制只作用于"我们自己补的动作"：模型明确按清单给了动作就照它演，
      // 否则同一句话会随机有/没有动作，测试与体感都不稳定
      if (!hasAnim) cues = gateCues(cues, parsed.emotion, cfg, turnActionMap)
      // 模型会从清单里挑，但挑的往往是最保守的 nod——情绪明明要求它垂着肩膀。
      // 情绪自己有签名动作时以情绪为准；模型挑的是别的真动作就尊重它。
      {
        const headSet = new Set(['anim_story_base001_sub_nod', 'anim_story_base001_sub_thinking1_start'])
        const wantId = turnActionMap ? String(turnActionMap[parsed.emotion] || '') : ''
        const animIdx = indexManifest(manifest).get('animations')
        if (wantId && animIdx && animIdx.has(wantId) && !headSet.has(wantId)) {
          cues = cues.map((c) => {
            if (!c || c.slot !== 'animations') return c
            if (!headSet.has(c.id)) return c
            return Object.assign({}, c, { id: wantId })
          })
        }
      }
      // 番茄钟/专注态：原来这里把所有动画无条件换成点头，可游戏绝大部分时间都在
      // focus/break 里，于是她永远只会点头——编什么情绪都白搭（2026-11-13 修）。
      // 现在只降级"没有情绪签名"的动作；shy / frustration / jump 这类照演，
      // 它们本来就是坐着做的小动作，不会打断专注。
      if (state.phase === 'focus' || state.phase === 'break') {
        // 只替换"动作"，不要把 sfx/scene 强转成动画；并且必须在清单里存在才能下发
        const animIds = indexManifest(manifest).get('animations')
        const headOnly = ['anim_story_base001_sub_nod', 'anim_story_base001_sub_thinking1_start']
          .filter((id) => animIds && animIds.has(id))
        // 情绪签名动作白名单：这些是按这张脸做的子动作，留着比点头更有戏
        const signature = new Set(
          Object.values(turnActionMap || {})
            .map((id) => String(id || ''))
            .filter((id) => /sub_(shy|frustration|joy|fun|guts|sad|deep|presshands|dropshoulders|jump|shakehead|laugh|confidence|thinking)/.test(id)),
        )
        let ai = 0
        if (cues.length > 0) {
          cues = cues.map((c) => {
            if (!c || c.slot !== 'animations') return c
            if (signature.has(c.id)) return c
            if (headOnly.length === 0) return c
            const id = headOnly[ai % headOnly.length]
            ai += 1
            return Object.assign({}, c, { id })
          })
          if (headOnly.length > 0 && !cues.some((c) => c && c.slot === 'animations')) {
            cues = cues.concat([{ slot: 'animations', id: headOnly[0], at: 0 }])
          }
        } else if (headOnly.length > 0) {
          cues = [{ slot: 'animations', id: headOnly[0], at: 0 }]
        }
      }
    }
    // 沙箱轮次完全不落地：历史、事实、摘要、状态一律不碰
    if (!sandbox) {
      state.turnCount += 1
      state.lastEventAt = Date.now()
      // 母题疲劳：把这轮落在哪几个母题上推进滑动窗口，只留最近 6 轮。
      const saidNow = String(parsed.subtitle_text || parsed.voice_text || '')
      const hitNow = Object.keys(MOTIFS).filter((key) => MOTIFS[key].re.test(saidNow))
      const prevWin = Array.isArray(state.motifWindow) ? state.motifWindow : []
      state.motifWindow = prevWin.concat([hitNow]).slice(-6)
      const prevSubs = Array.isArray(state.recentSubs) ? state.recentSubs : []
      if (saidNow.trim()) state.recentSubs = prevSubs.concat([saidNow.trim().slice(0, 30)]).slice(-4)
      // 聊天记录一律留存（「不记」只是不提炼事实、不改状态）
      await appendTurn(options.storeAs || userText, parsed)
      if (options.skipMemory !== true) {
        const remembered = await mem.addFacts(parsed.remember, { kind: 'fact' })
        if (remembered.added.length) log('remembered', { facts: remembered.added })
        // 共同经历：一条一条进，因为每条有自己的分量（weight 1-10 → importance 0-1）
        for (const mo of Array.isArray(parsed.moments) ? parsed.moments : []) {
          const r = await mem.addFacts([mo.text], { kind: 'moment', importance: mo.weight / 10 })
          if (r.added.length) log('moment', { text: mo.text, weight: mo.weight })
        }
        // 悬着的话题：等他下次提起，或者她主动问
        const loops = await mem.addFacts(parsed.open, { kind: 'loop' })
        if (loops.added.length) log('open loops', { items: loops.added })
        void compactMemory()
      }
      await saveState()
    }
    const speechLang = (value) => {
      const s = String(value || '')
      if (/[\u3040-\u30ff]/.test(s)) return 'ja'
      if (/[\u4e00-\u9fff]/.test(s)) return 'zh'
      return cfg.tts.textLang
    }
    // 模型偶尔把台词写成中文：照样念出来（换语言标记），别整句变成没声音
    const ttsStart = Date.now()
    // TTS 里有 activeVoice / writeFile / rename：任一步抛异常整轮就变 502，
    // 而上面已经把回复写进记忆——记忆里她说过，游戏里没演。失败一律降级字幕。
    let audio = null
    if (parsed.voice_text && !parsed.ttsSkip) {
      try {
        audio = await synthesize(parsed.voice_text, speechLang(parsed.voice_text))
      } catch (error) {
        log('tts failed, degrade to subtitle-only', { error: String(error?.message || error) })
        audio = null
      }
    }
    // TTS 失败与"没打算念"要区分开：失败时明确让游戏别等声音
    if (!audio && parsed.voice_text && !parsed.ttsSkip) parsed.ttsSkip = true
    const ttsMs = Date.now() - ttsStart
    // 口型：优先用模型给的假名读音，其次用台词本身；时长取 wav 真实长度
    const mouthText = parsed.voice_kana || parsed.voice_text
    const mouth = audio && mouthText
      ? mouthFrames(mouthText, { duration: audio.duration > 0 ? audio.duration + 0.06 : 0, fps: cfg.mouthFps || 30 })
      : null
    // 动作排布：按这句音频的真实时长把动作铺开，而不是全挤在 0ms
  if (cues && cues.length > 0 && audio && audio.duration > 0) {
    const durMs = Math.max(700, audio.duration * 1000)
    if (cues.length === 1) cues[0].at = 0
    else {
      const span = Math.min(durMs * 0.85, 5200)
      cues.forEach((c, i) => { c.at = Math.round((i / (cues.length - 1)) * span) })
    }
  }
  return {
    parsed, model, audio, cues, dropped, mouth,
    timings: { modelMs: Date.now() - tStart - ttsMs, ttsMs, totalMs: Date.now() - tStart, cached: Boolean(audio?.cached) },
      ttsError: lastTtsError,
    debugInfo: {
      promptCount: (sandbox && !withHistory) ? 0 : promptMemory.length,
      sandbox,
      kb: { skills: kbSkills.length, body: kbBody.length, hits: kbHits },
      historyRoles: promptMemory.slice(-8).map((m) => m.role),
      messagesTail: messages.slice(-5).map((m) => ({ role: m.role, head: String(m.content || '').slice(0, 36) })),
    },
  }
  }

  // ── 路由 ────────────────────────────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/chill/v1/health',
    handler: async (req, res) => {
      const [currentPersona] = await Promise.all([loadPersona()])
      // 先算成布尔再用：下面 keySource 只拿布尔做判断，绝不把 key 本身拼进响应
      const hasApiKey = Boolean(llm.resolve().apiKey)
      sendJson(res, 200, {
        ok: true,
        plugin: name,
        model: llm.resolve().model,
        thinking: cfg.thinking,
        emotionSet: EMOTION_SET,
        memoryTurns: memory.length,
        memory: mem.stats(),
        personaChars: currentPersona.length,
        characterId: (await chars.active())?.id || '',
        characterName: (await chars.active())?.name || '',
        tts: {
      enabled: cfg.tts.enabled,
      url: cfg.tts.url,
      textLang: (await voices.activeVoice()).textLang || cfg.tts.textLang,
      voiceId: (await voices.activeVoice()).id,
      voiceName: (await voices.activeVoice()).name,
      voiceCount: (await voices.list()).items.length,
    },
        assets: manifestSize(manifest),
        state,
        game: game.snapshot(),
        gameAgeMs: game.age(),
        gameOnline: game.online(),
        // 大脑端自己的队列水位（和游戏端那个队列各自独立、互不同步）：
        // depth 是还没被拉走的条数，waiters 是挂着长轮询的游戏端连接数
        queue: feed.stats(),
        hasApiKey,
        // 只报「key 从哪来」，不报值：宿主借来的凭据会在 env 里标 CHILL_KEY_SOURCE
        keySource: String(process.env.CHILL_KEY_SOURCE || '') || (hasApiKey ? 'credentials-file-or-env' : 'none'),
        at: nowIso(),
      })
    },
  }), 'dsh-chill-with-you-companion: GET /chill/v1/health')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/chill/v1/chat/completions',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const { json } = await readBody(req)
        const messages = Array.isArray(json?.messages) ? json.messages : []
        const userText = messages.filter((m) => m?.role === 'user').map((m) => String(m.content ?? '')).pop() ?? ''
        // 直调 runTurn 会绕开串行链：和游戏端 /act 并发时两边同时改记忆与状态
        const { parsed, model } = await serializedTurn(userText)
        const wantsJson = json?.response_format?.type === 'json_object'
        const content = wantsJson ? encodeForJsonClient(parsed) : encodeForLegacyClient(parsed)
        sendJson(res, 200, {
          id: `chill-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model.model,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          chill: { emotion: parsed.emotion, warnings: parsed.warnings, latencyMs: model.latencyMs },
          usage: model.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        })
      } catch (error) {
        log('chat/completions failed', { error: String(error?.message || error) })
        sendJson(res, 502, { error: { message: String(error?.message || error), type: 'chill_brain_error' } })
      }
    },
  }), 'dsh-chill-with-you-companion: POST /chill/v1/chat/completions')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/chill/v1/act',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const { json } = await readBody(req)
        const userText = String(json?.text ?? json?.userText ?? '').trim()
        const auto = isAutomation(req, json)
        const { parsed, model, audio, cues, dropped, mouth, debugInfo, timings, ttsError } = await serializedTurn(userText, { skipMemory: json?.remember === false, sandbox: auto, withHistory: json?.withHistory === true })
        // /act 是控制台和调试看的，必须和游戏端吃到的同形：
        // 否则调试时看到 at=4386、游戏里实际在 1685，两边差一截，排起来没完。
        const actDurMs = Math.round(Number(audio?.duration) * 1000) || 0
        const actChars = String(parsed.subtitle_text || '').length
        const actCues = cues === null ? null : chainStartToLoop(normalizeCueTiming(
          (cues || []).map((c) => ({
            slot: String(c?.slot || 'animations'),
            id: String(c?.id || ''),
            at: Number(c?.at) || 0,
            durationMs: Number(c?.durationMs) || animDurationMs(String(c?.id || '')),
            text: c?.text || null,
            why: c?.why || null,
          })),
          actDurMs,
          actChars,
        ), actDurMs, actChars)
        const act = buildAct(parsed, {
          turnId: `t-${Date.now()}`,
          textLang: cfg.tts.textLang,
          audioUrl: audio?.audioUrl ?? null,
          state,
          model: model.model,
          latencyMs: model.latencyMs,
          usage: model.usage,
          // 卡片可以覆盖动作表；这里给 buildAct 的是"生效中的表"
          actionMap: Object.assign({}, cfg.actionMap, (await chars.active())?.actionMap || {}),
          cues: actCues,
          droppedCues: dropped.length,
        })
        // 扁平字段：JsonUtility 对「对象数组」解析不可靠，游戏端只读这三个平行数组
        act.slots = (act.performance || []).map((c) => String(c.slot))
        act.ids = (act.performance || []).map((c) => String(c.id))
        act.ats = (act.performance || []).map((c) => Number(c.at) || 0)
        act.subtitleText = act.subtitle?.text || ''
        act.audioUrl = act.voice?.audioUrl || ''
        Object.assign(act, flatMouth(mouth))
        act.remember = Array.isArray(parsed.remember) ? parsed.remember : []
        act.timings = timings
        if (ttsError) act.ttsError = ttsError
        if (json?.debug === true) act.debug = debugInfo
        act.motionScope = scopeFor(actCues, state.phase)
        // 从面板或悬浮框回她一句，游戏那边也要跟着演——否则她只在面板上说话、游戏里没反应。
        try {
          const item = buildCueItem({
            subtitle: act.subtitleText || '',
            audioUrl: act.audioUrl || '',
            performance: act.performance || [],
            mouthFps: cfg.mouthFps || 0,
            source: 'reply',
            durationMs: audio && audio.duration > 0 ? audio.duration * 1000 : 0,
          })
          Object.assign(item, flatMouth(mouth))
          // 联调轮次：不进 cue.log（会埋掉真实演出），但进 cue.test.log，
          // 连「问了什么」一起记——查问题时光看她答的，看不出是哪句输入触发的。
          // 真实轮次也带上问题：日志里只有她答的话，翻起来看不出是接哪一句
          item.question = userText
          if (debugInfo?.sandbox) item.sandbox = true
          act.seq = pushCue(item)
          caps.emit('cue', item)
        } catch (error) {
          log('act push failed', { error: String(error?.message || error) })
        }
        // /act 自己已经把这条演掉了，把 seq 交回去，前端不用再推一次
        sendJson(res, 200, act)
      } catch (error) {
        log('act failed', { error: String(error?.message || error) })
        sendJson(res, 502, { error: { message: String(error?.message || error) } })
      }
    },
  }), 'dsh-chill-with-you-companion: POST /chill/v1/act')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/chill/v1/event',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const { json } = await readBody(req)
        const next = applyEvent(state, json)
        Object.assign(state, next)
        await saveState()
        sendJson(res, 200, { ok: true, state })
      } catch (error) {
        sendJson(res, 400, { error: { message: String(error?.message || error) } })
      }
    },
  }), 'dsh-chill-with-you-companion: POST /chill/v1/event')

  // 游戏端每 2s 上报一次真实状态，状态 tab 直接读它
  // ---- 游戏桥接：进程探测 / 拉起 / 心跳，逻辑在 lib/game.mjs ----
  const game = createGame({
    image: 'Chill With You.exe',
    uri: 'steam://rungameid/3548580',
    log,
    execFileAsync,
  })
  const gameRunning = game.probe
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/chill/v1/game',
    handler: async (req, res) => {
      if (req.method === 'POST') {
        if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
        try {
          const { json } = await readBody(req)
          game.touch(json)
          // 番茄钟：从心跳的 focus / timer 推出阶段，边沿变化时让她说一句
          const beat = applyHeartbeat(state, json, Date.now())
          Object.assign(state, beat.state)
          await saveState()
          for (const ev of beat.events) {
            if (ev.type === 'break') void pomoSay('break', ev)
            else if (ev.type === 'focus_end' && ev.stoppedEarly) void pomoSay('stopped', ev)
          }
          return sendJson(res, 200, { ok: true, phase: state.phase, pomo: state.pomo })
        } catch (error) {
          return sendJson(res, 400, { error: { message: String(error?.message || error) } })
        }
      }
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const age = game.age()
      return sendJson(res, 200, { ok: true, game: game.snapshot(), ageMs: age, online: game.online() })
    },
  }), 'dsh-chill-with-you-companion: /chill/v1/game')

  // 对话记录 + 记忆：控制台聊天框直接读这两条
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/chill/v1/chat',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit')) || 60))
      sendJson(res, 200, {
        ok: true,
        turns: mem.chatHistory(limit),
        summary: mem.summaryText,
        memory: mem.stats(),
        state,
        at: nowIso(),
      })
    },
  }), 'dsh-chill-with-you-companion: GET /chill/v1/chat')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/chill/v1/memory',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      if (req.method === 'GET') {
        return sendJson(res, 200, {
          ok: true,
          facts: mem.allFacts().map((f) => ({ id: f.id, text: f.text, kind: f.kind, importance: f.importance, at: f.at, hits: f.hits })),
          summary: mem.summaryText,
          stats: mem.stats(),
        })
      }
      try {
        const { json } = await readBody(req)
        if (json && typeof json.forget === 'string') {
          const removed = await mem.forget(json.forget)
          return sendJson(res, 200, { ok: true, removed, stats: mem.stats() })
        }
        const text = String((json && (json.text || json.remember)) || '').trim()
        const list = Array.isArray(text) ? text : [text]
        const result = await mem.addFacts(list, { kind: (json && json.kind) || 'fact', importance: 0.8 })
        return sendJson(res, 200, { ok: true, ...result, stats: mem.stats() })
      } catch (error) {
        return sendJson(res, 400, { error: { message: String(error?.message || error) } })
      }
    },
  }), 'dsh-chill-with-you-companion: /chill/v1/memory')

  // ── 语音引擎开关（控制台按钮用）───────────────────────────────────────────
  // 引擎本体不随插件分发（模型加 python 环境几个 G），插件只负责：发现缺什么、
  // 告诉用户怎么补、补好之后自己拉起来。拉起走 spawn，不依赖计划任务；
  // detached + unref 让它脱离本进程的作业树，Harness 重启不会顺手带走。
  // ---- 语音引擎：生命周期交给 lib/voice.mjs，这里只做装配 ----
  const VOICE_PORT = Number((String(cfg.tts?.url || '').match(/:(\d+)/) || [])[1]) || 9880
  const VOICE_TASK = 'ChillGSVServer'
  const voice = createVoice({
    port: VOICE_PORT,
    task: VOICE_TASK,
    watchdogTask: 'ChillGSVWatchdog',
    launcher: cfg.tts?.launcher || 'auto',
    engine: cfg.tts?.engine || {},
    refAudioPath: cfg.tts?.refAudio || '',
    wantPath: join(cfg.dataDir, 'voice.want'),
    dataDir: cfg.dataDir,
    log,
    net,
    execFileAsync,
    spawn,
    existsSync,
    writeFileSync,
    rmSync,
    appendFileSync,
    join,
    openSync,
    closeSync,
    synthesize,
  })
  const {
    want: voiceWant,
    setWant: setVoiceWant,
    probe: voiceProbe,
    taskStatus: voiceTaskStatus,
    killByPort,
    runTask: runVoiceTask,
    heal: healVoiceEngine,
    warmUp: warmUpVoice,
  } = voice

  // ---- 扩展点登记：以后加能力先在这里声明，`/chill/v1/meta` 会自描述 ----
  const caps = createCapabilities({ name: 'dsh-chill-with-you-companion', version: VERSION, log })
  caps.feature('chat', 'DeepSeek 对话 / 表演编排 / 记忆压缩')
  caps.feature('llm', '模型供应商切换（默认共用 DSH 的 key）')
  caps.feature('tts', 'GPT-SoVITS 日文语音合成与 wav 缓存')
  caps.feature('feed', '长轮询推送队列（控制台 → 游戏）')
  caps.feature('voice-admin', '语音引擎起停 / 探活 / 预热 / 自愈')
  caps.feature('game-bridge', '游戏进程探测与拉起')
  caps.feature('assets', '游戏资源清单上报与索引')
  caps.feature('persona', '人设文件读写')

  // ---- 推送队列：长轮询，空转请求挂起 8 秒（游戏端 timeout = 10 秒）----
  const feed = createFeed({ epoch: Math.floor(Date.now() / 1000) })

  /** 把口型二维帧压平成一维数组：JsonUtility 对嵌套数组不可靠，扁平数字最稳。 */
  function flatMouth(mouth) {
    if (!mouth || !Array.isArray(mouth.frames) || !mouth.frames.length) {
      return { mouthFps: 0, mouthFrames: 0, mouthFlat: [] }
    }
    const flat = []
    for (const row of mouth.frames) for (const v of row) flat.push(Math.round(v * 1000) / 1000)
    return { mouthFps: mouth.fps, mouthFrames: mouth.frames.length, mouthFlat: flat }
  }

  /** 某个动画在游戏里的时长（毫秒）。查不到给 0。 */
  function animDurationMs(id) {
    const list = Array.isArray(manifest?.animations) ? manifest.animations : []
    for (const a of list) if (String(a?.id) === String(id)) return Number(a?.durationMs) || 0
    return 0
  }

  /**
   * 这一批动作该用多大范围演。
   *
   * `upper` 只动上半身，坐姿的 base 姿势不动；`full` 会连全身 base 一起切，
   * 换 base 的瞬间整个人会重新摆一次——动作起手时的跳变多半来自这里。
   *
   * 清单里 `_sub` 是挂在上半身的叠加动作，`_base` 才是全身姿势。所以她坐着说话时
   * 选的全是 `_sub`，就该老老实实用 upper，别为了「演得完整」把 base 切掉。
   */
  function scopeFor(cues, phase) {
    const anims = (Array.isArray(cues) ? cues : []).filter((c) => c.slot === 'animations')
    if (anims.length) {
      // 只有真正换全身姿势的才用 full：`_base` 是基础站/坐姿，
      // `wild_*` 是起身那类完整动作。其余（打哈欠、垂肩、点头、摸眼镜）
      // 都是叠在上半身的，用 full 会顺带把 base 重摆一次，起手就跳。
      // 注意别用 /_base/ 这种写法：`story_base001_sub_nod` 里的 `base001` 会被误伤，
      // 结果所有动作都判成全身。要求 `_base` 是独立的一段。
      const fullBody = anims.some((c) => /(?:^|_)base(?:_|$)/.test(String(c.id || '')) || /^anim_wild_/.test(String(c.id || '')))
      if (!fullBody) return 'upper'
    }
    if (phase === 'focus' || phase === 'break') return 'upper'
    return 'full'
  }

  /**
   * 把 `_start` 接上同组的 `_loop`。
   *
   * 游戏的动作是三段式：`xxx_start`（过渡进入，1–1.5 秒）→ `xxx_loop`（保持）
   * → `xxx_end`（过渡退出）。只播 `_start` 的话，过渡动画一播完就硬弹回静态姿势，
   * 看起来就是「动一下然后跳回去」——割裂感就是这么来的。
   *
   * 模型基本只会给 `_start`（它觉得那才是「做这个动作」），所以这里补一段 `_loop` 接着。
   * 同组的段不参与最小间隔约束（见 normalizeCueTiming），否则补上的 loop 反而被推远。
   */
  function chainStartToLoop(list, durMs, subtitleLen) {
    const animIdx = indexManifest(manifest).get('animations')
    const has = (id) => Boolean(animIdx && animIdx.has(id))
    // 和 normalizeCueTiming 用同一套时长估算，两边算出来的窗口必须一致，
    // 否则 end 会落在语音结束之后。
    const real = Math.round(Number(durMs) || 0)
    const chars = Math.max(1, Number(subtitleLen) || 0)
    const est = real > 0 ? real : Math.max(1200, Math.round(chars * 220))
    const windowMs = Math.round(est * 0.9)

    // 模型有时直接给 _loop 或 _end（它以为「做个动作」就是给循环/收尾那一段），
    // 那样没有进入过渡，还是硬切。这里统一按「组」展开，一个组只出一条时间线。
    const groups = new Map()   // base -> { at, why, text }
    const others = []
    for (const c of list) {
      if (c.slot !== 'animations') { others.push(c); continue }
      const seg = String(c.id).match(/^(.*)_(start|loop|end)$/)
      if (!seg) {
        // 裸名也可能是组头：break_tea_sub_drink 自己就是进入段，后面跟着
        // break_tea_sub_drink_loop / _end。当成自包含单段丢掉的话，
        // 一次「喝茶」只演 1833ms，剩下的语音时间她就静止着。
        const bare = String(c.id)
        if (has(bare + '_loop') || has(bare + '_end')) {
          const prevBare = groups.get(bare)
          if (!prevBare) groups.set(bare, { at: Number(c.at) || 0, why: c.why, text: c.text })
          else prevBare.at = Math.min(prevBare.at, Number(c.at) || 0)
          continue
        }
        others.push(c); continue   // 真的自包含（sub_nod 这种），不展开
      }
      const base = seg[1]
      const prev = groups.get(base)
      // 同一个 base 出现多次时取最早的时间点
      if (!prev) groups.set(base, { at: Number(c.at) || 0, why: c.why, text: c.text })
      else prev.at = Math.min(prev.at, Number(c.at) || 0)
    }

    const ordered = Array.from(groups.entries()).sort((a, b) => a[1].at - b[1].at)
    const out = others.slice()
    for (let gi = 0; gi < ordered.length; gi += 1) {
      const [base, g] = ordered[gi]
      // 组头可能是 `xxx_start`，也可能就是裸名 `xxx`（喝茶/哈欠这类）
      const startId = has(base + '_start') ? base + '_start' : (has(base) ? base : '')
      const loopId = base + '_loop'
      const endId = base + '_end'
      const mk = (id, at, dur) => ({ slot: 'animations', id, at, durationMs: dur, why: g.why || '', text: g.text || '' })

      // 时长一律查清单，不能用模型给的——它给的是「它选中那一段」的时长，
      // 拿 _loop 的 50ms 去当 _start 的时长，过渡就变成一闪而过。
      const startDur = startId ? (animDurationMs(startId) || 1000) : 0

      // 1) 进入过渡。没有 start 段就从原始时间点直接开始（单段动画本来就自包含）
      if (startDur) out.push(mk(startId, g.at, startDur))
      const loopAt = g.at + startDur

      // 清单里的 durationMs 是「一个循环周期」，不能当播放时长用，而且有两种极端：
      //   thinking1_loop / confidence_loop = 50ms，jump_loop = 17ms（每秒 20~59 次）
      //   lookaround_loop = 10000ms（整段录制长度）
      // 前者循环播放就是头部 20Hz 抖动，看着像抽搐；这类微动循环不展开，走 start → end。
      const rawLoop = has(loopId) ? (animDurationMs(loopId) || 600) : 0
      const tinyLoop = rawLoop > 0 && rawLoop < 300

      // 收尾过渡只给最后一组。前面几组的 loop 会被下一组的 start 接手，
      // 那条 start 本身就是过渡，不需要再插一个 end 把人家顶掉。
      const isLast = gi === ordered.length - 1
      const hasEnd = isLast && has(endId)
      const endDur = hasEnd ? (animDurationMs(endId) || 1000) : 0
      // 收尾该在什么时候开始：语音结束前把 end 播完。
      const rawEndAt = hasEnd ? windowMs - endDur : 0
      // 留给循环的空隙。start 和 end 本身就占满窗口时（喝茶 1833+1167 对 15 字），
      // 硬塞一个 400ms 的循环只会让它在半途被收尾顶掉，观感像卡了一下。
      // 不够就干脆不插 loop，end 直接接 start。
      const gap = hasEnd ? rawEndAt - loopAt : 0
      const useLoop = Boolean(rawLoop) && !tinyLoop && (!hasEnd || gap >= 600)
      const endAt = useLoop ? rawEndAt : loopAt

      // 2) 过渡播完接循环，别硬弹回静态。
      const loopDur = useLoop ? (hasEnd ? endAt - loopAt : rawLoop) : 0
      // 有的组本身就是一段完整流程（break_tea_sub_maker 的 start 就 8667ms，
      // 整组 17.7 秒），拿它当「边说边做」的动作会演到话说完很久还在动。
      if (loopDur && startDur + loopDur + endDur <= Math.max(windowMs * 2.5, 6000)) out.push(mk(loopId, loopAt, loopDur))

      // 3) 收尾过渡
      if (hasEnd) out.push(mk(endId, loopDur ? endAt : loopAt, endDur))
    }
    // 游戏端按时间线走，数组顺序和时间顺序不一致时容易读错，排一下
    out.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
    return out
  }

  /**
   * 把动作的时间点规范化。
   *
   * 症结：模型给的时间点经常是毫秒（4386、3740），而它并不知道这句话念出来多长。
   * 实测 10–16 字的字幕念完约 2–3 秒，动作却排在 3.7–4.4 秒——她说完话，身体过一秒才反应，
   * 看起来就是延迟抽搐。prompt 已经改成要 0–1 小数，但模型不听话时这里得兜住。
   *
   * 三件事：
   *   1. 毫秒写法按「它以为的整句长度」反推成比例，再乘以真实（或估算的）时长。
   *   2. 同一动作连着出现两次的合并——「点头、点头」只会显得呆。
   *   3. 间隔太近的往后错开，避免两个动作同一毫秒触发。
   */
  function normalizeCueTiming(list, durMs, subtitleLen) {
    const cues = Array.isArray(list) ? list.slice() : []
    if (!cues.length) return cues

    // 真实音频时长优先；没有就按字幕长度估。中文 TTS 约 5.5 字/秒，
    // 再保底 1.2 秒——太短的话动作会挤成一坨。
    const real = Math.round(Number(durMs) || 0)
    const chars = Math.max(1, Number(subtitleLen) || 0)
    const est = real > 0 ? real : Math.max(1200, Math.round(chars * 220))
    const windowMs = Math.round(est * 0.9)   // 收在语音结束前，留一点余量

    // 判断这批是毫秒还是比例：只要有一条 > 1，就按整批毫秒处理。
    const looksMs = cues.some((c) => Number(c.at) > 1)
    let assumed = 0
    if (looksMs) {
      // 模型心里有个「整句多长」的假设。取最大时间点反推：
      // 它通常把最后一个动作排在六成到八成的样子，这里按 0.65 折算。
      const maxAt = Math.max.apply(null, cues.map((c) => Number(c.at) || 0))
      assumed = Math.max(est, maxAt / 0.65)
    }

    const out = []
    for (const c of cues) {
      const raw = Number(c.at) || 0
      const pos = looksMs ? raw / assumed : Math.max(0, Math.min(1, raw))
      const at = Math.round(Math.max(0, Math.min(1, pos)) * windowMs)
      // 相邻同 id 合并：连着两次同一个动作没有信息量
      const prev = out[out.length - 1]
      if (prev && prev.id === c.id && prev.slot === c.slot) continue
      out.push(Object.assign({}, c, { at }))
    }

    // 短句只留一个动作。10 个字左右的话念两秒，中间再换一次姿势就是抽搐；
    // 模型有时不听 prompt，这里硬卡。
    // 只卡 animations——sfx / scene 是音效和场景，跟姿势密度无关，砍掉就少了个音效。
    if (chars < 12) {
      let kept = 0
      const seenBase = new Set()
      const slim = out.filter((c) => {
        if (c.slot !== 'animations') return true
        const base = String(c.id || '').replace(/_(start|loop|end)$/, '')
        if (seenBase.has(base)) return true   // 同一动作的分段一起留
        if (kept >= 1) return false
        seenBase.add(base)
        kept += 1
        return true
      })
      out.length = 0
      out.push.apply(out, slim)
    }

    // 一句话里最多一个头部动作。两个 head 动作同时驱动头骨，出来就是高频抖动；
    // 分段（_start/_loop/_end）算同一个动作，不能拆散。
    {
      let headBase = ''
      const only = out.filter((c) => {
        if (c.slot !== 'animations' || partOf(c.id) !== 'head') return true
        const base = String(c.id || '').replace(/_(start|loop|end)$/, '')
        if (headBase && headBase !== base) return false
        headBase = base
        return true
      })
      out.length = 0
      out.push.apply(out, only)
    }

    // 间隔不能小于「前一个动作自己播完的时间」，否则它还没做完就被下一个顶掉，
    // 看起来就是一串动作连着播。loop 类动作的 durationMs 是一圈的长度，不代表要播这么久，
    // 所以按 1200ms 封顶。
    const MIN_GAP = 1000
    const baseOf = (id) => String(id || '').replace(/_(start|loop|end)$/, '')
    for (let i = 1; i < out.length; i += 1) {
      // 同一动作的分段（start→loop→end）必须首尾相接，不能被间隔约束推开；
      // 推开的后果是 start 播完空等 1.45 秒才进 loop，比不接还难看。
      if (baseOf(out[i].id) === baseOf(out[i - 1].id)) continue
      const prevDur = Math.min(1200, Number(out[i - 1].durationMs) || 0)
      const need = Math.max(MIN_GAP, prevDur + 250)
      const gap = out[i].at - out[i - 1].at
      if (gap < need) out[i].at = out[i - 1].at + need
    }
    // 错开之后可能顶出窗口，整体压回来
    const last = out[out.length - 1]
    if (last && last.at > windowMs && out.length > 1) {
      const span = last.at - (out[0].at || 0)
      const scale = span > 0 ? windowMs / last.at : 1
      for (const c of out) c.at = Math.round(c.at * scale)
    }
    return out
  }

  /** 把一次推送请求整理成游戏端 FeedItemDto 能吃的形状。 */
  function buildCueItem(json) {
    const performance = Array.isArray(json?.performance)
      ? json.performance
      : (json?.id ? [{ slot: 'animations', id: String(json.id), at: 0 }] : [])
    const durMs = Math.round(Number(json?.durationMs) || 0)
    const subtitleLen = String(json?.subtitle || '').length
    const cues = chainStartToLoop(normalizeCueTiming(
      performance.slice(0, 8)
        .map((c) => ({
          slot: String(c?.slot || 'animations'),
          id: String(c?.id || ''),
          at: Number(c?.at) || 0,
          durationMs: Number(c?.durationMs) || animDurationMs(String(c?.id || '')),
          text: typeof c?.text === 'string' ? c.text.slice(0, 40) : '',
          why: typeof c?.why === 'string' ? c.why.slice(0, 24) : '',
        }))
        .filter((c) => c.id),
      durMs,
      subtitleLen,
    ), durMs, subtitleLen)
    const audioUrl = typeof json?.audioUrl === 'string' ? json.audioUrl : ''
    return {
      performance: cues,
      slots: cues.map((c) => c.slot),
      ids: cues.map((c) => c.id),
      ats: cues.map((c) => c.at),
      subtitle: typeof json?.subtitle === 'string' ? json.subtitle.slice(0, cfg.maxSubtitle || 60) : '',
      voice: audioUrl ? { audioUrl } : null,
      audioUrl,
      source: typeof json?.source === 'string' ? json.source.slice(0, 40) : 'console',
      mouthFps: Number(json?.mouthFps) || 0,
      mouthFrames: Number(json?.mouthFrames) || 0,
      mouthFlat: Array.isArray(json?.mouthFlat) ? json.mouthFlat.slice(0, 4000) : [],
      // 调用方明确给了就听它的；没给就按选中的动作自己判断，别一律 full
      motionScope: json?.motionScope === 'upper' || json?.motionScope === 'full'
        ? json.motionScope
        : scopeFor(cues, ''),
      // 这一句的语音有多长。游戏端原来按「字数 × 0.18 秒，最少 4 秒」估字幕停留，
      // 而日语念 20 个汉字往往要六七秒——字幕先没了、话还在说。有这个字段就按它算。
      durationMs: Math.round(Number(json?.durationMs) || 0),
    }
  }

  // ---- 游戏上报的资源清单：落盘一份，重启后仍然可用 ----
  const loadAssets = async () => {
    try {
      const text = await readFile(assetsPath, 'utf8')
      manifest = normalizeManifest(JSON.parse(text))
      log('assets manifest loaded', manifestSize(manifest))
    } catch { /* 没上报过就用空清单 */ }
  }
  // 清单读取是 IO：不阻塞路由注册，读到就用，读不到就是空清单
  void loadAssets()
  // 状态要先读回来：只写不读的话，重启就是"关系清零"，面板还显示已保存。
  // 读失败按默认值走，不挡启动。
  void loadState()
  // 记忆同理：open 幂等，先开一次，/health 首屏就有真实条数
  void loadMemory()


  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/meta',
    note: '能力与扩展点自描述',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      return sendJson(res, 200, Object.assign({ ok: true }, caps.describe(), { feed: feed.stats() }))
    },
  })), 'dsh-chill-with-you-companion: GET /chill/v1/meta')

  // ---- 控制台 → 游戏：推送一条表演 ----
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/play',
    note: '推送一条表演（字幕 / 动作 / 语音）',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const { json } = await readBody(req)
        // 去重闸门：面板发一句话时 /act 已经演过一次，前端还会拿同一份结果再 POST 一次
        // /play（client.js 的历史遗留），两条前后差几毫秒、内容一模一样。
        // 同一个 audioUrl 或同一段字幕在 3 秒内重复进来，直接回原来那条的 seq，不再入队。
        const now = Date.now()
        const sig = String(json?.audioUrl || '') + '|' + String(json?.subtitle || '').slice(0, 40)
        if (sig !== '|' && lastCue.sig === sig && now - lastCue.at < 3000) {
          log('play: 重复推送已忽略', { src: json?.source || '', seq: lastCue.seq })
          return sendJson(res, 200, { ok: true, seq: lastCue.seq, deduped: true })
        }
        const item = buildCueItem(json)
        if (!item.performance.length && !item.subtitle && !item.audioUrl) {
          return sendJson(res, 400, { ok: false, error: 'nothing to play' })
        }
        if (isAutomation(req, json)) item.sandbox = true
        const seq = pushCue(item)
        caps.emit('cue', item)
        return sendJson(res, 200, { ok: true, seq })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })), 'dsh-chill-with-you-companion: POST /chill/v1/play')

  // ---- 游戏 → 控制台：拉取队列（长轮询）----
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/pull',
    note: '长轮询取 cue（无 cue 时挂起 8 秒）',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const since = Number(url.searchParams.get('since') || 0) || 0
      const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 8) || 8))
      const waitParam = url.searchParams.get('wait')
      const wait = waitParam === null ? undefined : Math.min(8000, Math.max(0, Number(waitParam) || 0))
      feed.hold(req, res, { since, limit, wait, sendJson })
    },
  })), 'dsh-chill-with-you-companion: GET /chill/v1/pull')

  // ---- 语音 wav：两种取法都支持 ----
  //   /chill/v1/audio?name=xxx.wav   面板与 act 返回的 audioUrl 用这种
  //   /chill/v1/audio/xxx.wav        表演端按相对路径拼出来后可能变成这种
  const serveAudio = async (res, rawName) => {
    const name = String(rawName || '')
    if (!name || /[/\\]/.test(name) || name.includes('..') || !/^[A-Za-z0-9_.-]+\.wav$/.test(name)) {
      return sendJson(res, 400, { error: 'bad name' })
    }
    try {
      const buffer = await readFile(join(audioDir, name))
      res.statusCode = 200
      res.setHeader('content-type', 'audio/wav')
      res.setHeader('content-length', buffer.length)
      res.setHeader('cache-control', 'no-store')
      return res.end(buffer)
    } catch {
      return sendJson(res, 404, { error: 'not found' })
    }
  }

  registerAudioRoutes({ ctx, caps, authorized, sendJson, serveAudio })

  // ---- 头像：内置默认两张（聪音企鹅 / 玩家少女），可自定义覆盖 ----
  registerAvatarRoutes({ ctx, caps, authorized, sendJson, dataDir: cfg.dataDir })

  // ---- 声线：内置聪音几条 + 自定义（上传参考音频即可） ----
  registerVoiceRoutes({
    ctx, caps, authorized, sendJson, readBody, cfg,
    voices, voiceProbe, voice, audioDir,
  })

  registerKbRoutes({ ctx, caps, authorized, sendJson, readBody, cfg, kb })

  // 氛围那两条：spark 与环境旁白都留在 brain（它们要读状态机与模型），模块只调它们
  registerMoodRoutes({
    ctx, caps, authorized, sendJson, readBody,
    spark, ambientBlock,
    getAmbient: () => ambient, getAmbientAt: () => ambientAt,
    setAmbient: (text, at) => { ambient = text; ambientAt = at },
  })

  // ---- 旁观：他那边干完一轮活，聪音看一眼，值得说才说一句 ----
  // 不注入人设、不碰那条对话：只读它这一轮的产出，然后在聪音自己的链路上说一句话。
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/observe',
    note: '看被观察的会话这一轮干了什么，判断要不要提醒或关心一句',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const { json } = await readBody(req)
        // 一轮正在跑就别插话：她会打断他自己的一轮，记忆里还会多出半截上下文
        if (turnActive) return sendJson(res, 200, { ok: true, speak: false, reason: 'busy' })
        const title = String(json?.title || '').slice(0, 40)
        const rounds = Math.max(0, Math.round(Number(json?.rounds) || 0))
        const minutes = Math.max(0, Math.min(600, Number(json?.minutes) || 0))
        const quietMinutes = Math.max(0, Math.min(600, Number(json?.quietMinutes) || 0))
        const tools = Array.isArray(json?.tools)
          ? json.tools.slice(0, 8).map((t) => String(t).slice(0, 30))
          : []
        const errors = Math.max(0, Math.round(Number(json?.errors) || 0))
        const lastAnswer = String(json?.lastAnswer || '').slice(0, 220)
        const lastAsked = String(json?.lastAsked || '').slice(0, 120)
        const lastSaid = String(json?.lastSaid || '').slice(0, 120)

        const persona = await loadPersona()
        const card = await chars.active()
        const actionMap = Object.assign({}, cfg.actionMap, (card && card.actionMap) || {})

        if (state.phase === 'focus') {
          // 专注中不是不说话，是「值得说才说」：出了错，或者一口气干了 10 分钟以上
          const worthIt = Number(json?.errors) > 0 || Number(json?.minutes) >= 10
          if (!worthIt) return sendJson(res, 200, { ok: true, speak: false, reason: 'focus-quiet' })
        }
        const idle = json?.idle === true
        // 只喂概况，不逐条复述：她的作用是抬眼看一下，不是念工作日志
        const lines = []
        lines.push('（旁白，不是他在说话）你正在旁边看着他的屏幕。' + (idle
          ? '他那边已经安静了一阵子，你刚才主动凑过去看了一眼他在忙什么。'
          : '他有一阵子没理你了，刚在「' + (title || '那个窗口') + '」那边忙完一批活。'))
        const bits = []
        if (rounds > 0) bits.push('一共 ' + rounds + ' 轮')
        if (minutes > 0) bits.push('前后大约 ' + Math.round(minutes * 10) / 10 + ' 分钟')
        if (tools.length) bits.push('动过 ' + tools.join('、'))
        if (errors > 0) bits.push('中间出过 ' + errors + ' 次错')
        if (bits.length) lines.push('这批活大概是：' + bits.join('，') + '。')
        if (lastAsked) lines.push('他最近在弄的事：' + lastAsked)
        if (lastAnswer) lines.push('那边最后一句是：' + lastAnswer)
        if (quietMinutes > 0) lines.push('距离你上一次开口已经 ' + Math.round(quietMinutes * 10) / 10 + ' 分钟了。')
        if (lastSaid) lines.push('你上次说的是「' + lastSaid + '」，别把同样的意思再说一遍。')
        if (state.phase === 'focus') {
          lines.push('（他那边番茄钟正在走，别打断他——要说就一句短的，说完让他接着干。）')
        } else if (state.phase === 'break') {
          lines.push('（他那边番茄钟刚走完，人正在歇着，这会儿说话不怕打扰。）')
        }
        lines.push('')
        lines.push('现在决定要不要出声：')
        lines.push('- 你只看到个大概，就说你自己的反应：一句抱怨、一句自己的状态、或者顺口问一句。')
        lines.push('- 不要说指挥他的话（"站起来""别坐着""先停一下""该歇了"这类）。你想让他歇，就说你自己累了、想动一动——让他自己看出来。')
        lines.push('- 不要复述他干了什么，不要列步骤，不要点评式夸奖（"真厉害""辛苦了"这类别说）。')
        lines.push('- 不要问"需要我帮忙吗"这种客套话；你是个在忙自己事情的人，顺手抬了下眼。')
        lines.push('- 他要是没出岔子、只是正常推进，那也可以干脆不说。')
        lines.push('')
        lines.push('只输出一个 json：{"speak":true|false,"emotion":"…","voice_text":"日文台词","subtitle_text":"中文字幕，10-25 字","performance":[]}')
        const messages = [
          { role: 'system', content: persona },
          { role: 'user', content: lines.join('\n') },
        ]
        const model = await callModel(messages)
        const rawText = String(model.content || '')
        let probe = {}
        try {
          const a = rawText.indexOf('{')
          const b = rawText.lastIndexOf('}')
          if (a >= 0 && b > a) probe = JSON.parse(rawText.slice(a, b + 1)) || {}
        } catch { probe = {} }
        const parsed = parseModelOutput(rawText, {
          emotionSet: EMOTION_SET,
          fallbackEmotion: cfg.fallbackEmotion,
          maxSubtitle: cfg.maxSubtitle,
          maxVoice: cfg.maxVoice,
          textLang: cfg.tts.textLang,
        })
        const subtitle = String(parsed.subtitle_text || '').trim()
        const explicit = probe.speak === true || probe.speak === false ? probe.speak : null
        const speak = explicit === null ? subtitle !== '' : (explicit && subtitle !== '')
        if (!speak) {
          return sendJson(res, 200, { ok: true, speak: false, latencyMs: model.latencyMs, reason: explicit === false ? 'model-declined' : 'empty' })
        }
        const voiceText = String(parsed.voice_text || '').trim()
        const lang = /[\u3040-\u30ff]/.test(voiceText) ? 'ja' : cfg.tts.textLang
        let audio = null
        try {
          audio = voiceText && !parsed.ttsSkip ? await synthesize(voiceText, lang) : null
        } catch (error) {
          log('observe: tts failed', { error: String(error?.message || error) })
        }
        let cues = emotionFallbackCues(parsed.emotion, actionMap, manifest)
        if (cues.length) cues = gateCues(cues, parsed.emotion, cfg, actionMap)
        const item = buildCueItem({
          subtitle,
          audioUrl: (audio && audio.audioUrl) || '',
          performance: cues || [],
          mouthFps: cfg.mouthFps || 0,
          motionScope: scopeFor(cues, state.phase),
          source: 'observe',
          durationMs: audio && audio.duration > 0 ? audio.duration * 1000 : 0,
        })
        const seq = pushCue(item)
        caps.emit('cue', item)
        // 观察时说出来的话也要进聊天历史——否则控制台只看得到她自己开口的那几句，
        // 游戏里演过什么、面板上却是空白。
        try { await appendTurn('', parsed, { skipUser: true }) } catch (error) {
          log('observe appendTurn failed', { error: String(error?.message || error) })
        }
        // 她刚说过话，开口节拍重新计时
        lastTurnAt = Date.now()
        scheduleSpark()
        return sendJson(res, 200, {
          ok: true,
          speak: true,
          subtitle,
          emotion: parsed.emotion,
          voiceText,
          audioUrl: item.audioUrl,
          performance: item.performance,
          seq,
          latencyMs: model.latencyMs,
        })
      } catch (error) {
        log('observe failed', { error: String(error?.message || error) })
        return sendJson(res, 502, { error: { message: String(error?.message || error) } })
      }
    },
  })), 'dsh-chill-with-you-companion: POST /chill/v1/observe')

  // ---- 工作模式：给"被观察的那个 DSH 对话"提供聪音的临时身份块 ----
  // 只产出文本。真正的投递在 Host 侧（index.js）——侧车拿不到 Host 的会话服务。
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/context',
    note: '组装「聪音此刻是谁 / 记得什么 / 会什么」的注入块，供工作模式临时载入到别的对话',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
        const budget = Math.max(400, Math.min(6000, Number(url.searchParams.get('maxChars')) || 3600))
        const q = String(url.searchParams.get('q') || '')
        const card = await chars.active()
        const currentPersona = String(await loadPersona() || '').trim()
        const memBlock = mem.buildMemoryBlock(q, { k: 8, maxChars: 900 })
        let skills = ''
        try { skills = await kb.capabilityBlock() } catch { /* 能力包读不到就算了 */ }
        let loreText = ''
        try { loreText = await chars.loreBlock(q, { k: 2, maxChars: 700, alwaysMax: 600 }) } catch { /* 同上 */ }
        const name = (card && card.name) || '聪音'

        const parts = []
        parts.push('# 这一段对话临时由你扮演「' + name + '」')
        parts.push('不是新开一个角色：面前这个人只是把他自己的这条对话暂时交给' + name + '，好让手上的活儿有人接着干。语气还是' + name + '的，但别用客套话占位置。')
        if (currentPersona) parts.push('## 你是谁\n' + currentPersona)
        if (loreText) parts.push('## 设定\n' + loreText)
        if (skills) parts.push('## 你掌握的领域\n' + skills)
        const facts = String((memBlock && memBlock.facts) || '').trim()
        const summary = String((memBlock && memBlock.summary) || '').trim()
        if (facts || summary) parts.push('## 你记得的事\n' + [summary, facts].filter(Boolean).join('\n'))
        parts.push('## 规矩\n- 先说结论，再给能照做的步骤。\n- 要动文件、跑命令就直接做，做完说清改了什么。\n- 别在回答里提「临时身份」「注入」「系统提示」这类词。')

        let block = parts.join('\n\n')
        if (block.length > budget) block = block.slice(0, budget) + '\n（后面省略）'
        return sendJson(res, 200, {
          ok: true,
          name,
          block,
          chars: block.length,
          parts: {
            persona: currentPersona.length,
            lore: loreText.length,
            skills: skills.length,
            memory: facts.length + summary.length,
          },
        })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })), 'dsh-chill-with-you-companion: /chill/v1/context')
  registerPersonaRoutes({
    ctx, caps, authorized, sendJson, readBody, cfg, chars, log, existsSync, copyFileSync,
    readPersona: async () => { await loadPersona(); return persona },
    setPersona: (text) => { persona = text; personaMtime = 0 },
  })

  // ---- 角色卡 ----
  // GET  /characters                 列表（含 active）
  // POST /characters                 新建 {id,name,tagline}
  // GET  /characters/<id>            详情（含 persona / lore）
  // POST /characters/<id>            保存 {persona,lore,name,tagline,voice,actionMap}
  // POST /characters/<id>/activate   切换当前角色
  registerCharacterRoutes({
    ctx, caps, authorized, sendJson, readBody, chars,
    setPersona: (text) => { persona = text; personaMtime = 0 },
  })

  // ---- 资源清单 ----
  registerAssetRoutes({
    ctx, caps, authorized, sendJson, readBody, log,
    dataDir: cfg.dataDir, getManifest: () => manifest, setManifest: (next) => { manifest = next },
    emit: (next) => caps.emit('assets', next),
  })

  registerAdminRoutes({ ctx, caps, authorized, sendJson, game, gameRunning })

  // ---- 桌面快捷框 ----
  // 以前这里拉的是 tools/ChillQuickBox.exe：一个 WinForms 小窗，得手工用 csc 编译，
  // 还得带着 .cs / .vbs / .manifest / .pos 四个伴生件一起走。现在改成插件自己吐一张
  // 自包含网页，用浏览器的 app 模式开成独立窗口——没有地址栏，观感最接近原来那个框。
  const QUICK_HTML = join(HERE, 'tools', 'quick.html')

  // 快捷框必须有自己的浏览器 profile。Chromium 按 profile 记住上一次 app 窗口的边界：
  // 和默认 profile 共用时，430×560 的小框会把尺寸留在 profile 里，之后任何 app 模式
  // 打开的面板（包括 Harness 自己的窗口）都会继承这个小尺寸——真机表现就是「先开快捷
  // 聊天，再开浏览器，浏览器窗口小得跟快捷框一样」，反过来大窗口也会把快捷框撑大。
  const QUICK_PROFILE = join(cfg.dataDir, 'quickbox-profile')
  const QUICK_W = Number(process.env.CHILL_QUICKBOX_WIDTH || 430)
  const QUICK_H = Number(process.env.CHILL_QUICKBOX_HEIGHT || 187)

  // Chrome 和 Edge 都认 --app。Firefox 不认，会退成普通标签页，所以放在最后兜底。
  // 除了默认安装位置，也看一遍用户目录下的安装（有些机器只装了当前用户）。
  const browserCandidates = () => {
    const local = process.env.LOCALAPPDATA || ''
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    return [
      join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local ? join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      local ? join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
    ].filter((p) => p && existsSync(p))
  }

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/quick',
    note: '快捷对话框页面（自包含 HTML，无构建）',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'method not allowed' })
      }
      let html
      try {
        html = readFileSync(QUICK_HTML)
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: '找不到 tools/quick.html', path: QUICK_HTML })
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': html.length,
        'cache-control': 'no-store',
      })
      if (req.method === 'HEAD') return res.end()
      return res.end(html)
    },
  })), 'dsh-chill-with-you-companion: GET /chill/quick')

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/quickbox',
    note: '拉起快捷对话框（浏览器 app 模式）',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      try {
        // 端口从请求头取，不要在代码里写死 10723——sidecar 也可能落在别的口上。
        const host = String(req.headers.host || '').trim() || '127.0.0.1'
        // 页面本身不鉴权（它就是个壳），但页面里的 fetch 要带 token，所以拼进 URL。
        // 这个地址只有本机拿得到；`?t=` 里就是本机 token，不进日志。
        const url = 'http://' + host + '/chill/quick?t=' + encodeURIComponent(cfg.token)

        // 默认走原生浮窗（WinForms + WebView2）：不启动、也不借用用户的浏览器，
        // 就是一个普通窗口（不强制置顶，不抢焦点）。?browser=1 保留老路径，
        // 作为没有 WebView2 运行时 / SDK 时的退路。
        const wantBrowser = /(?:^|[?&])browser=1(?:&|$)/.test(String(req.url || ''))
        const floatScript = join(HERE, 'tools', 'quickfloat.ps1')
        if (!wantBrowser && existsSync(floatScript)) {
          const psExe = join(process.env.SystemRoot || 'C:\\Windows',
            'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
          const floatLog = join(cfg.dataDir, 'quickfloat.log')
          try {
            const child = spawn(psExe, [
              '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', floatScript,
              '-Url', url,
              '-UserDataDir', join(cfg.dataDir, 'quickfloat'),
              '-Width', String(QUICK_W),
              '-Height', String(QUICK_H),
            ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
            // 浮窗进程活到用户关掉为止，输出攒着，close 时落盘，出问题有据可查
            let floatOut = ''
            const noteFloat = (chunk) => { if (floatOut.length < 4000) floatOut += chunk }
            child.stdout.on('data', noteFloat)
            child.stderr.on('data', noteFloat)
            child.on('error', (err) => {
              try {
                appendFileSync(floatLog, '[' + new Date().toISOString() + '] spawn error: ' +
                  (err && err.code) + ' ' + String(err && err.message || err) + '\n')
              } catch { /* 记不下来就算了 */ }
            })
            child.on('close', () => {
              try {
                appendFileSync(floatLog, '[' + new Date().toISOString() + '] ' + floatOut.trim() + '\n')
              } catch { /* 记不下来就算了 */ }
            })
            return sendJson(res, 200, {
              ok: true,
              mode: 'widget',
              url,
              size: { width: QUICK_W, height: QUICK_H },
            })
          } catch { /* 浮窗起不来就退回浏览器路径 */ }
        }

        const browsers = browserCandidates()
        if (browsers.length > 0) {
          try { mkdirSync(QUICK_PROFILE, { recursive: true }) } catch { /* 建不出来就交给浏览器自己建 */ }
          const boxArgs = [
            '--app=' + url,
            '--window-size=' + QUICK_W + ',' + QUICK_H,
            '--user-data-dir=' + QUICK_PROFILE,
            '--no-first-run',
            '--no-default-browser-check',
            // 关掉会挡住小框的登录同步引导 / 翻译提示 / 侧边栏，否则 430 宽的窗口里
            // 一半面积被浮层吃掉
            '--disable-features=msEdgeIdentityFRE,msEdgeSyncPromo,msEdgeTranslate,Translate,TranslateUI,msEdgeSidebarV2',
            '--disable-sync',
            '--no-service-autorun',
          ]
          const child = spawn(browsers[0], boxArgs, {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          })
          child.on('error', () => { /* 开不开窗口都不该拖垮 sidecar */ })
          child.unref()

          // Chromium 会把 app 窗口建成隐藏或最小化（真机上量到 158×26、坐标 -21333），
          // 这时 --window-size 不管用。用 Win32 兜一次：按进程命令行认出这个 profile 的
          // 窗口、唤出、摆到目标尺寸。ps1 保持纯 ASCII，避开 PS 5.1 读非 BOM 文件的坑。
          const placeScript = join(HERE, 'tools', 'place-window.ps1')
          const placeLogPath = join(cfg.dataDir, 'quickbox-place.log')
          if (existsSync(placeScript)) {
            try {
              // 用绝对路径叫 powershell：sidecar 的 PATH 未必含 System32，spawn 会
              // ENOENT 静默失败（只有 'error' 事件，看不到任何输出）
              const psExe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
              const placer = spawn(psExe, [
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', placeScript,
                // 用 profile 路径认窗口，不用标题：中文标题经命令行传给 powershell 会
                // 被按 ANSI 解释，匹配不上
                '-CommandLineMatch', 'quickbox-profile',
                '-Width', String(QUICK_W),
                '-Height', String(QUICK_H),
                '-DelayMs', '900',
              ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
              // stdio 必须走 pipe：把 stdout 直接重定向到文件 fd 时 PS 5.1 一个字都不写，
              // 出了事完全没有线索。这里攒起来，进程 close 时落盘。
              let placeOut = ''
              const notePlace = (chunk) => { if (placeOut.length < 4000) placeOut += chunk }
              placer.stdout.on('data', notePlace)
              placer.stderr.on('data', notePlace)
              placer.on('error', (err) => {
                try {
                  appendFileSync(placeLogPath,
                    '[' + new Date().toISOString() + '] spawn error: ' + (err && err.code) + ' ' + String(err && err.message || err) + '\n')
                } catch { /* 记不下来就算了 */ }
              })
              placer.on('close', () => {
                try {
                  appendFileSync(placeLogPath, '[' + new Date().toISOString() + '] ' + placeOut.trim() + '\n')
                } catch { /* 记不下来就算了 */ }
              })
            } catch { /* 摆位失败不影响窗口已经打开 */ }
          }

          return sendJson(res, 200, {
            ok: true,
            mode: 'app',
            browser: browsers[0],
            url,
            profile: QUICK_PROFILE,
            size: { width: QUICK_W, height: QUICK_H },
          })
        }
        // 一个 --app 浏览器都没有，就交给系统默认浏览器，至少还能用。
        await execFileAsync('explorer.exe', [url], { windowsHide: true, timeout: 8000 })
        return sendJson(res, 200, { ok: true, mode: 'browser', url })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: String(err?.message || err) })
      }
    },
  })), 'dsh-chill-with-you-companion: POST /chill/v1/quickbox')

  // 只记录、不触发她开口。工作模式下输入框把话投递给被观察的那条 DSH 对话，
  // 走的是 /chill/host/work —— 那条链路和 memory 无关，于是聊天区会空着。
  // 这里让那句话同时落进同一份记录，两个模式看到的才对得上。
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/turn',
    note: '把一句话记进聊天记录（不触发模型）',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const { json } = await readBody(req)
        const role = json?.role === 'assistant' ? 'assistant' : 'user'
        const text = String(json?.text ?? '').trim()
        if (!text) return sendJson(res, 400, { ok: false, error: 'empty text' })
        await ensureDirs()
        await mem.appendTurn({ role, content: text, emotion: String(json?.emotion ?? '') })
        memory = mem.recent(cfg.memoryTurns)
        caps.emit('turn', { role, text, memory: mem.stats() })
        return sendJson(res, 200, { ok: true, role, text })
      } catch (error) {
        log('turn record failed', { error: String(error?.message || error) })
        return sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })), 'dsh-chill-with-you-companion: POST /chill/v1/turn')

  registerPanelRoutes({ ctx, caps, authorized, sendJson, readBody, llm })
  // ---- 语音引擎：状态与起停 ----
  const voiceSnapshot = async (note) => Object.assign({
    ok: true,
    online: await voiceProbe(),
    port: VOICE_PORT,
    task: VOICE_TASK,
    launcher: cfg.tts?.launcher || 'auto',
    ...(await voice.snapshot()),
    taskError: voice.error(),
    ttsEnabled: Boolean(cfg.tts?.enabled),
    ttsUrl: cfg.tts?.url || '',
    textLang: cfg.tts?.textLang || 'ja',
    lastError: lastTtsError,
  }, note ? { note } : {})

  const { voiceAction } = registerVoiceAdminRoutes({ ctx, caps, authorized, sendJson, voiceSnapshot })

  voiceAction('start', async () => {
    setVoiceWant(true)
    if (!(await voiceProbe(true))) {
      void runVoiceTask()
      warmUpVoice()
      return '已请求启动，模型加载约 30–50 秒'
    }
    warmUpVoice()
    return '引擎已在线'
  })

  voiceAction('stop', async () => {
    setVoiceWant(false)
    const killed = await killByPort()
    return killed.length ? '已停止（结束进程 ' + killed.join(',') + '）' : '已停止'
  })

  voiceAction('restart', async () => {
    setVoiceWant(true)
    const online = await runVoiceTask()
    warmUpVoice()
    return online ? '已重启，引擎在线' : '已重启，端口还没起来（看 warm.log）'
  })

  // 这 7 条是直接 webServer.register 的，早先没进 caps 表，于是 /meta 少报 7 条，
  // 排查时容易以为路由丢了。纯自描述登记，不影响匹配。
  for (const r of [
    { kind: 'exact', path: '/chill/v1/health', note: '存活、游戏端是否在线、key 是否就位' },
    { kind: 'exact', path: '/chill/v1/chat/completions', note: 'OpenAI 兼容入口，任何聊天插件可直连' },
    { kind: 'exact', path: '/chill/v1/act', note: '原生演出指令：动作 + 字幕 + 语音' },
    { kind: 'exact', path: '/chill/v1/event', note: '游戏端事件上报（开始 / 暂停 / 结束）' },
    { kind: 'exact', path: '/chill/v1/game', note: '游戏端拉取指令与资源清单' },
    { kind: 'exact', path: '/chill/v1/memory', note: '面板：记忆与长期事实' },
  ]) caps.route(r)

  log('dsh-chill-with-you-companion ready', { version: VERSION, routes: caps.describe().routes.length })

  // 最后启动：她自己的开口节拍（会自己排下一次）
  scheduleSpark()
}
