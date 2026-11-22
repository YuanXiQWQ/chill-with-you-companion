/**
 * 配置的唯一入口。
 *
 * 之前 DEFAULTS / resolveConfig / readCredentialRef 都塞在 brain.mjs 顶部，
 * 和路由混在一起，加一个配置项要翻半个文件。现在集中到这里：
 *   - DEFAULTS：所有默认值（含 tts 子对象）
 *   - resolveConfig(raw)：补默认值并合并嵌套配置。
 *
 * 新增配置项的顺序约定：先加到 DEFAULTS，再在 cordis.patch.yml 里写覆盖值，
 * 不要在业务代码里出现裸的魔法数字。
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

import { DEFAULT_ACTION_MAP, EXTENDED_ACTION_MAP } from './core.js'

export function makeDefaults(here) {
  return {
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '', // 仅供显式配置的供应商使用。
    model: 'deepseek-flash',
    thinking: 'disabled',
    reasoningEffort: '',
    maxTokens: 600,
    temperature: 0.9,
  // 反重复：同一个词已经说过就压分（frequency），说过就抑制再提（presence）。
  // 论据见 Galetzka et al. 2023 §5.2 —— repetition 与 genericity 是聊天的两大informativ问题，
  // 解码期惩罚是代价最小的一档干预。默认轻推，别压到句子变别扭。
  frequencyPenalty: 0.35,
  presencePenalty: 0.25,
    emotionSet: 'base8',
    fallbackEmotion: 'Agree',
    maxSubtitle: 60,
    maxVoice: 60,
    memoryTurns: 12,
  // 记忆保留上限（天）：超过这个岁数、又不特别重要的，载入时直接清掉
  forgetAfterDays: 180,
    retries: 1,
    requestTimeoutMs: 30000,
    token: '',
    personaPath: join(here, 'persona.md'),
    // 数据目录：聊天记录、音频缓存、知识库、用户自己捏的人设卡都在这里。
    // 留空 = 插件目录下的 data/；填绝对路径 = 与源码分开存放。
    // 也可以设环境变量 CHILL_DATA_DIR。目录不存在时启动会自动创建。
    dataDir: '',
    actionMap: DEFAULT_ACTION_MAP,
    assetBudget: 3200,
    assetPerSlot: 80,
    maxCues: 3,
    motionMode: 'gentle',
    // 专注期要不要下发身体动作。默认 false：DLL 的 FocusMode 本来就会把动作整条跳过，
    // 侧车再下发只会让面板显示一条没演的动作为 true 时恢复旧行为（边专注边做小动作）。
    focusMovesBody: false,
    gestureChance: 0.6,
    gestureCooldownTurns: 2,
    maxAtMs: 60000,
    tts: {
      enabled: false,
      provider: 'gpt-sovits',
      speaker: 10005, // VOICEVOX Nemo「女声1」。
      url: 'http://127.0.0.1:9880',
      refAudio: 'Voice_MainScenario_18_001.wav',
      promptText: '',
      promptLang: 'ja',
      textLang: 'ja',
      speedFactor: 1,
      timeoutMs: 40000,
      retries: 1,
      // 引擎怎么起：
      //   spawn = 插件自己拉 python（不经过 wscript / powershell / 计划任务）
      //   task  = 老路，schtasks /run ChillGSVServer
      //   auto  = 先 spawn，起不来再退到 task
      launcher: 'auto',
      // python 在哪里、仓库在哪里、日志写哪里。留空则由 launcher 自己找。
      engine: {
        executable: '', // VOICEVOX 的便携可执行文件。
        python: '',
        repo: '',
        script: 'api_v2.py',
        config: '',
        log: '',
        env: { HF_ENDPOINT: 'https://hf-mirror.com' },
      },
    },
  }
}

/**
 * 语音引擎的三样东西（python / repo / log）原来在 cordis.patch.yml 里写死绝对路径，
 * 换台机器整段配置就得重写一遍——而且写错了只会在一路走到「起引擎」时才炸。
 * 现在配置留空，按「插件内 tools/ → 插件同级的 tools/」自己找；配置里显式写了
 * 但那个路径不存在，也回落到找到的位置，不让一处笔误把整个语音哑掉。
 */
function discoverEngine(here, dataDir) {
  const roots = [join(here, 'tools'), join(here, '..', 'tools')]
  const pick = (rel) => {
    for (const root of roots) {
      const candidate = join(root, rel)
      if (existsSync(candidate)) return candidate
    }
    return ''
  }
  return {
    python: pick(join('gsv-venv', 'Scripts', 'python.exe')),
    repo: pick(join('gsv-src', 'GPT-SoVITS-main')),
    log: join(dataDir, 'gsv-server.log'),
  }
}

export function resolveConfig(raw = {}, here = process.cwd()) {
  const defaults = makeDefaults(here)
  const cfg = { ...defaults, ...(raw || {}) }
  cfg.tts = { ...defaults.tts, ...(raw?.tts || {}) }
  cfg.tts.engine = { ...defaults.tts.engine, ...(raw?.tts?.engine || {}) }
  // 相对路径一律相对插件根解析。写死盘符会让插件绑死在某台机器的某个目录上，
  // 一挪位置语音就哑。绝对路径照旧可用，向后兼容。
  const isAbsolutePath = (v) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(v)
  // 数据目录：配置 > 环境变量 CHILL_DATA_DIR > 插件目录下的 data/。
  // 留空是常态（随包默认），填绝对路径就把私人数据挪出源码树。
  const rawDataDir = String(cfg.dataDir || process.env.CHILL_DATA_DIR || '').trim()
  cfg.dataDir = !rawDataDir
    ? join(here, 'data')
    : isAbsolutePath(rawDataDir) ? rawDataDir : join(here, rawDataDir)
  if (cfg.tts.refAudio && !isAbsolutePath(cfg.tts.refAudio)) {
    cfg.tts.refAudio = join(here, 'ref', cfg.tts.refAudio)
  }
  for (const key of ['executable', 'python', 'repo', 'log']) {
    const value = cfg.tts.engine[key]
    if (value && typeof value === 'string' && !isAbsolutePath(value)) {
      cfg.tts.engine[key] = join(here, value)
    }
  }
  // 上面那轮解完可能还是空的（配置里就是这么留空的），按约定位置再找一遍。
  // log 是待生成的文件，不能拿 existsSync 判它，只在没写的时候补默认位置。
  const found = discoverEngine(here, cfg.dataDir)
  for (const key of ['executable', 'python', 'repo', 'log']) {
    const value = cfg.tts.engine[key]
    if (!value) {
      cfg.tts.engine[key] = found[key]
    } else if (key !== 'log' && !existsSync(value) && found[key]) {
      cfg.tts.engine[key] = found[key]
    }
  }
  // 推理配置是仓库里的文件，相对的是 repo 而不是插件根。
  const engineCfg = cfg.tts.engine.config
  if (engineCfg && typeof engineCfg === 'string' && !isAbsolutePath(engineCfg)) {
    cfg.tts.engine.config = cfg.tts.engine.repo ? join(cfg.tts.engine.repo, engineCfg) : engineCfg
  }
  // 动作表始终以扩展表为底：表演端（ChillPerformer）认这些真实 clip，
  // 而配置文件里的 emotionSet 可能还是旧的 'base8'（它只影响提示词候选的旧语义），
  // 一旦跟着它退回 8 键，Shy/Laugh/Cheer 这些情绪就补不出任何动作。2026-11-13 修。
  cfg.actionMap = { ...EXTENDED_ACTION_MAP, ...(raw?.actionMap || {}) }
  // 鉴权 token：配置 > 环境变量 CHILL_TOKEN > <数据目录>/token（没有就生成一个）。
  // 以前留空等于「不校验」，本机任何进程都能读她的记忆、改她的人设、往游戏里塞台词。
  // 现在这条路没了：要么配置给，要么环境变量给，要么自动生成。
  cfg.token = resolveToken({ explicit: cfg.token, dataDir: cfg.dataDir })
  return cfg
}

/**
 * 取（必要时生成）本机 token。
 *
 * 生成用 `flag: 'wx'`：两个进程同时启动时只有一个能写成功，另一个读回同一个值，
 * 不会出现「宿主一个 token、侧车另一个 token」然后互相 401 的鬼故事。
 * token 只落在文件里——日志、`view()`、health、面板一律不出现它的值。
 */
export function resolveToken({ explicit = '', dataDir = '' } = {}) {
  const fromConfig = String(explicit || '').trim()
  if (fromConfig) return fromConfig
  const fromEnv = String(process.env.CHILL_TOKEN || '').trim()
  if (fromEnv) return fromEnv
  if (!dataDir) return ''
  const file = join(dataDir, 'token')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    // 手改成空文件也当没有：重新生成，而不是放行。
    if (existing) return existing
  } catch { /* 还没有：下面生成 */ }
  const fresh = randomBytes(32).toString('hex')
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, fresh + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    try { chmodSync(file, 0o600) } catch { /* Windows 上无意义，忽略 */ }
    return fresh
  } catch (error) {
    // EEXIST = 另一个进程刚写完，直接读它的
    try {
      const peer = readFileSync(file, 'utf8').trim()
      if (peer) return peer
    } catch { /* 落下去 */ }
    throw new Error('无法建立本机 token：' + String(error?.message || error))
  }
}
