/**
 * 模型供应商：一份运行时可改的清单，控制台里选。
 *
 * 「跟 DSH 共用一个」不是比喻——DSH 把各家 key 明文放在 `$DSH_HOME/.credentials.yaml`
 * 的顶层 `refs:` 段里（DEEPSEEK_API_KEY / ARK_API_KEY / TENCENT_API_KEY / …）。
 * provider 只要写 `keyRef` 指向那个名字，就不用在这儿再存一遍密钥。
 * 自己加的 provider 才写 `token`。
 *
 * key 永远不出本进程：控制台只拿到名字和"配没配"的布尔值。
 */
// 本机只有 PowerShell 5.1，写 json 会带 UTF-8 BOM，而 JSON.parse 不剥它
const stripBom = (s) => (typeof s === 'string' && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

export function createLlm({ dataDir, cfg = {}, existsSync, readFileSync, writeFileSync, mkdir, join, log }) {
  const storePath = join(dataDir, 'llm.json')

  // 内置三条：前两条直接借 DSH 的 key，第三条是本地 llama.cpp / ollama 的常见地址。
  const BUILTIN = [
    {
      id: 'dsh-deepseek',
      label: 'DeepSeek · 跟 DSH 共用',
      baseUrl: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-flash',
      keyRef: 'DEEPSEEK_API_KEY',
      source: 'dsh',
    },
    {
      id: 'dsh-ark',
      label: '豆包 ARK · 跟 DSH 共用',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      model: '',
      keyRef: 'ARK_API_KEY',
      source: 'dsh',
    },
    {
      id: 'local',
      label: '本地模型（llama.cpp / ollama）',
      baseUrl: 'http://127.0.0.1:8080/v1/chat/completions',
      model: 'qwen2.5',
      token: '',
      source: 'local',
    },
  ]

  let cache = null
  let cacheAt = 0

  /** 解析 DSH 的 credentials 顶层 refs 段。records 里那个 refs 有缩进，不会误中。 */
  const readDshKeys = () => {
    const now = Date.now()
    if (cache && now - cacheAt < 5000) return cache
    const out = {}
    try {
      // 和 config.mjs 用同一套回落：没有 DSH_HOME 时用 ~/.dsh。
  // 不一致的后果是面板说"没 key"，而主对话链路明明拿得到——同一台机器两套答案。
  const home = String(process.env.DSH_HOME || '') || join(process.env.USERPROFILE || '', '.dsh')
      if (home) {
        const p = join(home, '.credentials.yaml')
        if (existsSync(p)) {
          for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
            if (/^refs:\s*$/.test(raw)) {
              cache = out
              cacheAt = now
              continue
            }
            const m = raw.match(/^ {2}([A-Za-z0-9_]+):\s*"?([^"\s]+)"?\s*$/)
            if (m) out[m[1]] = m[2]
          }
        }
      }
    } catch (error) {
      log('llm: read dsh credentials failed', { error: String(error?.message || error) })
    }
    cache = out
    cacheAt = now
    return out
  }

  const defaults = () => {
    const providers = BUILTIN.map((p) => ({ ...p }))
    // 老配置里已经有 key 的话，把它当成一个独立 provider，不丢
    // 默认就是跟 DSH 共用那一条；插件配置里的 key 只作为备选排在后头，
    // 否则老配置会把默认抢走，用户看到的就不是"共用"。
    if (cfg.apiKey) {
      providers.push({
        id: 'config',
        label: '插件配置里的 key',
        baseUrl: cfg.baseUrl || 'https://api.deepseek.com/v1/chat/completions',
        model: cfg.model || 'deepseek-flash',
        token: cfg.apiKey,
        source: 'config',
      })
    }
    return { active: 'dsh-deepseek', providers }
  }

  const normalize = (raw) => {
    const list = Array.isArray(raw?.providers) ? raw.providers : []
    const providers = list
      .filter((p) => p && typeof p === 'object' && p.id)
      .map((p) => ({
        id: String(p.id),
        label: String(p.label || p.id),
        baseUrl: String(p.baseUrl || ''),
        model: String(p.model || ''),
        keyRef: p.keyRef ? String(p.keyRef) : '',
        token: p.token ? String(p.token) : '',
        headers: p.headers && typeof p.headers === 'object' ? p.headers : {},
        source: String(p.source || 'custom'),
      }))
    // 内置项即使被删也从清单里补回来，不然切不回"跟 DSH 共用"
    for (const b of BUILTIN) {
      if (!providers.some((p) => p.id === b.id)) providers.push({ ...b })
    }
    const active = providers.some((p) => p.id === raw?.active) ? String(raw.active) : providers[0].id
    return { active, providers }
  }

  const load = () => {
    try {
      if (existsSync(storePath)) return normalize(JSON.parse(stripBom(readFileSync(storePath, 'utf8'))))
    } catch (error) {
      log('llm: read store failed, using defaults', { error: String(error?.message || error) })
    }
    return normalize(defaults())
  }

  const save = (state) => {
    const next = normalize(state)
    try {
      if (mkdir) mkdir(dataDir, { recursive: true })
    } catch { /* 已存在 */ }
    writeFileSync(storePath, JSON.stringify(next, null, 2), 'utf8')
    return next
  }

  /** 控制台需要的视图：密钥一律不出进程，只报「配没配」。 */
  const view = () => {
    const state = load()
    const keys = readDshKeys()
    return {
      active: state.active,
      providers: state.providers.map((p) => {
        const hasKey = Boolean(pickKey(p))
        return {
          id: p.id,
          label: p.label,
          baseUrl: p.baseUrl,
          model: p.model,
          source: p.source,
          keyRef: p.keyRef || '',
          hasKey,
          // 内置不允许删，删了也补回来
          builtin: BUILTIN.some((b) => b.id === p.id),
        }
      }),
      // 供"添加时选一个 DSH 里的 key"用，只有名字
      dshKeys: Object.keys(keys).sort(),
    }
  }

  /** 当前生效的一条，交给 callModel。热路径，缓存 1.5 秒别每次读盘。 */
  let resolveCache = null
  let resolveAt = 0
  const bump = () => { resolveCache = null; resolveAt = 0; cache = null; cacheAt = 0 }
  /**
   * 一段解析，三处共用（resolve / test / view 的「配没配」）。优先级从高到低：
   *   ① provider 自己的 token（面板里填的、/llm add 加的）
   *   ② 用户显式设的环境变量（keyRef 指向的名字）
   *   ③ dsh 的 .credentials.yaml
   *   ④ 宿主借来的 CHILL_DSH_KEY —— 只有 CHILL_DSH_KEY_REF 与 keyRef 相同才用，
   *      否则选了豆包却拿 DeepSeek 的 key 去请求，只会换来 401。
   */
  const pickKey = (p) => {
    if (!p) return ''
    if (p.token) return String(p.token)
    const ref = String(p.keyRef || '')
    if (!ref) return ''
    const fromEnv = String(process.env[ref] || '')
    if (fromEnv) return fromEnv
    const fromFile = readDshKeys()[ref] || ''
    if (fromFile) return fromFile
    if (String(process.env.CHILL_DSH_KEY_REF || '') === ref) return String(process.env.CHILL_DSH_KEY || '')
    return ''
  }

  const resolve = () => {
    const now = Date.now()
    if (resolveCache && now - resolveAt < 1500) return resolveCache
    const state = load()
    const p = state.providers.find((x) => x.id === state.active) || state.providers[0]
    let out
    if (!p) {
      out = { id: '', label: '', baseUrl: cfg.baseUrl || '', model: cfg.model || '', apiKey: cfg.apiKey || '', headers: {} }
    } else {
      const apiKey = pickKey(p)
      out = {
        id: p.id,
        label: p.label,
        baseUrl: p.baseUrl,
        model: p.model || cfg.model || '',
        apiKey,
        headers: p.headers || {},
        source: p.source,
      }
    }
    resolveCache = out
    resolveAt = now
    return out
  }

  const activate = (id) => {
    const state = load()
    if (!state.providers.some((p) => p.id === id)) return { ok: false, error: '没有这个 provider: ' + id }
    state.active = String(id)
    save(state)
    bump()
    return { ok: true }
  }

  /** 加一条自定义的。id 由 label 派生，重复就加后缀。 */
  const add = (input = {}) => {
    const state = load()
    const baseUrl = String(input.baseUrl || '').trim()
    if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: 'baseUrl 要以 http(s):// 开头' }
    const slug = String(input.label || input.model || 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'custom'
    let id = slug
    let n = 2
    while (state.providers.some((p) => p.id === id)) { id = slug + '-' + n; n += 1 }
    state.providers.push({
      id,
      label: String(input.label || input.model || id).slice(0, 40),
      baseUrl,
      model: String(input.model || '').trim(),
      keyRef: input.keyRef ? String(input.keyRef) : '',
      token: input.token ? String(input.token) : '',
      headers: {},
      source: 'custom',
    })
    save(state)
    bump()
    return { ok: true, id }
  }

  const remove = (id) => {
    const state = load()
    if (BUILTIN.some((b) => b.id === id)) return { ok: false, error: '内置 provider 不能删' }
    const before = state.providers.length
    state.providers = state.providers.filter((p) => p.id !== id)
    if (state.providers.length === before) return { ok: false, error: '没有这个 provider: ' + id }
    if (state.active === id) state.active = state.providers[0].id
    save(state)
    bump()
    return { ok: true }
  }

  /** 连通性测试：只要一句极短的回复，不为内容、只看通不通。 */
  const test = async (id) => {
    const state = load()
    const target = id ? state.providers.find((p) => p.id === id) : null
    const saved = state.active
    if (target) state.active = target.id
    const p = target || state.providers.find((x) => x.id === state.active)
    const live = target ? { ...target, apiKey: pickKey(target) } : resolve()
    state.active = saved
    if (live.authError) return { ok: false, error: live.authError }
    if (!live.apiKey) return { ok: false, error: '这个 provider 没有可用的 key：' + (p?.keyRef || '填 token') }
    if (!live.baseUrl) return { ok: false, error: '没填 baseUrl' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    const t0 = Date.now()
    try {
      const response = await fetch(live.baseUrl, {
        method: 'POST',
        headers: Object.assign(
          { 'content-type': 'application/json', authorization: 'Bearer ' + live.apiKey },
          live.headers || {},
        ),
        body: JSON.stringify({
          model: live.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 8,
          stream: false,
        }),
        signal: controller.signal,
      })
      const ms = Date.now() - t0
      const text = await response.text()
      if (!response.ok) return { ok: false, ms, error: response.status + ' ' + text.slice(0, 160) }
      let got = ''
      try {
        const data = JSON.parse(text)
        got = String(data?.choices?.[0]?.message?.content || '').slice(0, 40)
      } catch { got = text.slice(0, 40) }
      return { ok: true, ms, model: live.model, reply: got }
    } catch (error) {
      const ms = Date.now() - t0
      return { ok: false, ms, error: String(error?.message || error) }
    } finally {
      clearTimeout(timer)
    }
  }

  return { view, resolve, activate, add, remove, test, storePath }
}
