/**
 * 声线库 —— GPT-SoVITS 的参考音频集合。
 *
 * 一条声线 = 一段参考 wav + 它对应的文本/语言 + 语速。
 * 内置几条从游戏里抓出来的聪音语音（只读，不能删），用户可以自己加：
 * 上传一段 3–10 秒的干净人声，写上那段话的原文，就能拿来当参考音。
 *
 * 目录结构：
 *   data/voices/index.json          { active, items: [...] }
 *   data/voices/audio/<id>.wav      用户上传的参考音频
 *   ref/*.wav                       游戏原始语音（内置声线直接引用，不复制）
 */

import { readFile, writeFile, mkdir, stat, rm, rename } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'

// 本机只有 PowerShell 5.1，写 json 会带 UTF-8 BOM，而 JSON.parse 不剥它：
// 一度"被 PowerShell 碰过的文件"全被当成损坏（角色卡消失、配置回默认、记忆首行丢失）。
const stripBom = (s) => (typeof s === 'string' && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const LANGS = ['ja', 'zh', 'en', 'ko', 'yue']
const MAX_AUDIO = 12 * 1024 * 1024
const MAX_ITEMS = 60

export const DEFAULT_VOICES = [
  {
    id: 'satone',
    name: '聪音 · 日常',
    note: '游戏主剧情原声，默认声线',
    builtin: true,
    file: 'ref/Voice_MainScenario_18_001.wav',
    promptText: '',
    promptLang: 'ja',
    textLang: 'ja',
    speedFactor: 1.0,
  },
  {
    id: 'satone-soft',
    name: '聪音 · 轻声',
    note: '第 18 话的另一句，气声更明显',
    builtin: true,
    file: 'ref/Voice_MainScenario_18_003.wav',
    promptText: '',
    promptLang: 'ja',
    textLang: 'ja',
    speedFactor: 1.0,
  },
  {
    id: 'satone-calm',
    name: '聪音 · 认真',
    note: '语速偏稳，适合讲设定',
    builtin: true,
    file: 'ref/Voice_MainScenario_18_004.wav',
    promptText: '',
    promptLang: 'ja',
    textLang: 'ja',
    speedFactor: 0.95,
  },
  {
    id: 'satone-noon',
    name: '聪音 · 午间',
    note: '午间招呼，句尾上扬',
    builtin: true,
    file: 'ref/Voice_GameStart_Noon_2_004.wav',
    promptText: '',
    promptLang: 'ja',
    textLang: 'ja',
    speedFactor: 1.05,
  },
]

function clampText(value, max) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').slice(0, max)
}

function clampLang(value, fallback) {
  const lang = String(value || '').trim()
  return LANGS.includes(lang) ? lang : fallback
}

function clampSpeed(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.min(2, Math.max(0.5, Math.round(n * 100) / 100))
}

function isWav(buf) {
  if (!buf || buf.length < 44) return false
  return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE'
}

function wavInfo(buf) {
  try {
    let rate = 0
    let ch = 0
    let bits = 0
    let pos = 12
    while (pos + 8 <= buf.length) {
      const id = buf.toString('ascii', pos, pos + 4)
      const size = buf.readUInt32LE(pos + 4)
      if (id === 'fmt ') {
        ch = buf.readUInt16LE(pos + 10)
        rate = buf.readUInt32LE(pos + 12)
        bits = buf.readUInt16LE(pos + 22)
      } else if (id === 'data') {
        const bytes = Math.min(size, buf.length - pos - 8)
        const duration = rate && ch && bits ? bytes / (rate * ch * (bits / 8)) : 0
        return { rate, ch, bits, duration: Math.round(duration * 100) / 100, bytes }
      }
      pos += 8 + size + (size % 2)
    }
  } catch { /* 坏文件就返回空信息 */ }
  return { rate: 0, ch: 0, bits: 0, duration: 0, bytes: buf ? buf.length : 0 }
}

export function createVoices({ dir, refDir, log = () => {} }) {
  const audioDir = join(dir, 'audio')
  const indexFile = join(dir, 'index.json')

  let state = { active: DEFAULT_VOICES[0].id, items: [] }
  let loaded = false
  let loadError = ''

  const fileOf = (item) => {
    if (!item) return ''
    if (isAbsolute(item.file)) return item.file
    if (item.builtin) return join(refDir, item.file)
    return join(audioDir, item.file)
  }

  const hydrate = (item) => {
    const base = {
      id: String(item.id || ''),
      name: clampText(item.name, 40).trim() || item.id,
      note: clampText(item.note, 120).trim(),
      builtin: Boolean(item.builtin),
      file: String(item.file || ''),
      promptText: clampText(item.promptText, 300),
      promptLang: clampLang(item.promptLang, 'ja'),
      textLang: clampLang(item.textLang, 'ja'),
      speedFactor: clampSpeed(item.speedFactor),
      bytes: Number(item.bytes) || 0,
      duration: Number(item.duration) || 0,
      rate: Number(item.rate) || 0,
      createdAt: item.createdAt || '',
    }
    base.path = fileOf(base)
    return base
  }

  async function load() {
    if (loaded) return state
    loaded = true
    try {
      const raw = JSON.parse(stripBom(await readFile(indexFile, 'utf8')))
      const items = Array.isArray(raw.items) ? raw.items : []
      state = {
        active: typeof raw.active === 'string' ? raw.active : DEFAULT_VOICES[0].id,
        items: items.map(hydrate).filter((v) => v.id),
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        loadError = String(error.message || error)
      // 坏文件改名留证：留在原地的话，下一次 persist() 会把它整个覆盖掉
      try { await rename(indexFile, indexFile + '.bad-' + Date.now()) } catch { /* 无文件 */ }
        log('voices: 读取 index.json 失败，改用内置声线', loadError)
      }
      state = { active: DEFAULT_VOICES[0].id, items: [] }
    }
    // 内置声线永远在最前面补齐（用户删不掉，也不会被自定义覆盖）
    // 顺序要按 DEFAULT_VOICES 重建：以前用 unshift，每 load 一次内置顺序整体倒过来，
    // active 兜底项跟着漂，用户看到的默认声线每次刷新都不一样。
    const builtinItems = []
    for (const d of DEFAULT_VOICES) {
      const file = d.file.replace(/^ref\//, '')
      builtinItems.push(state.items.find((v) => v.id === d.id) || hydrate({ ...d, file }))
    }
    const customItems = state.items.filter((v) => !DEFAULT_VOICES.some((d) => d.id === v.id))
    state.items = builtinItems.concat(customItems)
    // 给内置声线补上实际文件信息
    for (const v of state.items) {
      try {
        const info = await stat(v.path)
        if (v.bytes !== info.size) {
          v.bytes = info.size
          try {
            const w = wavInfo(await readFile(v.path))
            v.duration = w.duration
            v.rate = w.rate
          } catch { /* 读不出就算 */ }
        }
      } catch {
        v.missing = true
      }
    }
    if (!state.items.some((v) => v.id === state.active)) state.active = DEFAULT_VOICES[0].id
    return state
  }

  async function persist() {
    await mkdir(audioDir, { recursive: true })
    const plain = {
      active: state.active,
      items: state.items.map((v) => ({
        id: v.id,
        name: v.name,
        note: v.note,
        builtin: v.builtin,
        file: v.file,
        promptText: v.promptText,
        promptLang: v.promptLang,
        textLang: v.textLang,
        speedFactor: v.speedFactor,
        bytes: v.bytes,
        duration: v.duration,
        rate: v.rate,
        createdAt: v.createdAt,
      })),
    }
    // 先写 tmp 再 rename：直接覆盖时中途崩就是空文件，
    // 下次 load 解析失败，用户自定义的全部声线元数据一次性没了。
    const tmp = indexFile + '.tmp-' + process.pid + '-' + Date.now()
    try {
      await writeFile(tmp, JSON.stringify(plain, null, 2) + '\n', 'utf8')
      await rename(tmp, indexFile)
    } catch (error) {
      try { await rm(tmp, { force: true }) } catch { /* 清不掉就算了 */ }
      throw error
    }
  }

  async function list() {
    const s = await load()
    return {
      active: s.active,
      items: s.items.map((v) => ({ ...v })),
      loadError,
    }
  }

  async function get(id) {
    const s = await load()
    return s.items.find((v) => v.id === id) || null
  }

  async function activeVoice() {
    const s = await load()
    return s.items.find((v) => v.id === s.active) || s.items[0]
      // 兜底也要剥 ref/ 前缀，否则路径变成 <dataDir>/voices/ref/xxx.wav，合成读不到文件
      || hydrate({ ...DEFAULT_VOICES[0], file: DEFAULT_VOICES[0].file.replace(/^ref\//, '') })
  }

  async function activate(id) {
    const s = await load()
    const item = s.items.find((v) => v.id === id)
    if (!item) return { error: '没有这条声线' }
    s.active = id
    await persist()
    log('voices: 切换声线', { id })
    return { ok: true, active: id }
  }

  async function create(input = {}) {
    const s = await load()
    const raw = String(input.id || input.name || '').trim().toLowerCase()
    const id = raw.replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
    if (!ID_RE.test(id)) return { error: 'id 只能用 a-z 0-9 _ -，2–32 个字符' }
    if (s.items.some((v) => v.id === id)) return { error: '这个 id 已经有声线了' }
    if (s.items.filter((v) => !v.builtin).length >= MAX_ITEMS) return { error: '最多 ' + MAX_ITEMS + ' 条自定义声线' }
    const item = hydrate({
      id,
      name: input.name || id,
      note: input.note || '',
      builtin: false,
      file: id + '.wav',
      promptText: input.promptText || '',
      promptLang: input.promptLang,
      textLang: input.textLang,
      speedFactor: input.speedFactor,
      createdAt: new Date().toISOString(),
    })
    s.items.push(item)
    await persist()
    log('voices: 新增声线', { id, name: item.name })
    return { ok: true, item }
  }

  async function saveAudio(id, buf) {
    const s = await load()
    const item = s.items.find((v) => v.id === id)
    if (!item) return { error: '没有这条声线' }
    if (item.builtin) return { error: '内置声线不能替换音频，请新建一条' }
    if (!isWav(buf)) return { error: '只收 WAV（RIFF/WAVE），建议 3–10 秒、单声道' }
    if (buf.length > MAX_AUDIO) return { error: '文件太大（上限 12 MB）' }
    await mkdir(audioDir, { recursive: true })
    const file = join(audioDir, id + '.wav')
    await writeFile(file + '.tmp', buf)
    await rm(file, { force: true })
    await writeFile(file, buf)
    await rm(file + '.tmp', { force: true })
    const w = wavInfo(buf)
    item.file = id + '.wav'
    item.path = file
    item.bytes = buf.length
    item.duration = w.duration
    item.rate = w.rate
    delete item.missing
    await persist()
    log('voices: 上传参考音频', { id, bytes: buf.length, duration: w.duration })
    return { ok: true, item, wav: w }
  }

  async function remove(id) {
    const s = await load()
    const item = s.items.find((v) => v.id === id)
    if (!item) return { error: '没有这条声线' }
    if (item.builtin) return { error: '内置声线不能删' }
    s.items = s.items.filter((v) => v.id !== id)
    if (s.active === id) s.active = DEFAULT_VOICES[0].id
    await persist()
    await rm(join(audioDir, id + '.wav'), { force: true })
    log('voices: 删除声线', { id })
    return { ok: true, active: s.active }
  }

  return { dir, audioDir, list, get, activeVoice, activate, create, saveAudio, remove, wavInfo, isWav }
}
