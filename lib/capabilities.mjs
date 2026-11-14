/**
 * 扩展点登记处。
 *
 * 目的：以后加功能（新 TTS、新动作库、外部事件源、别的表演端）不要再改 brain.mjs
 * 的路由，而是：
 *   1. `caps.feature('xxx', '一句话说明')` —— 声明能力，`/chill/v1/meta` 会列出来；
 *   2. `caps.hook('cue', fn)` / `caps.hook('turn', fn)` —— 挂在已有流程上；
 *   3. `caps.route({kind, path, note})` —— 注册新路由时顺带登记，便于 `/meta` 自描述。
 *
 * 钩子是**同步、隔离**的：一个钩子抛错只记日志，绝不打断主流程。
 * 真正的异步副作用由钩子自己 fire-and-forget，避免拖慢对话。
 */
export function createCapabilities({ name = 'dsh-chill-with-you-companion', version = '0.0.0', log = () => {} } = {}) {
  const startedAt = Date.now()
  const features = new Map()
  const hooks = new Map()
  const routes = []

  const feature = (id, note = '') => {
    features.set(String(id), { id: String(id), note: String(note) })
    return id
  }

  const hook = (event, fn) => {
    const key = String(event)
    if (typeof fn !== 'function') return () => {}
    if (!hooks.has(key)) hooks.set(key, [])
    hooks.get(key).push(fn)
    return () => {
      const list = hooks.get(key) || []
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    }
  }

  /** 触发钩子。返回第一个非 undefined 的结果，供"可覆盖"的扩展点使用。 */
  const emit = (event, payload) => {
    const list = hooks.get(String(event))
    if (!list || !list.length) return undefined
    let result
    for (const fn of list.slice()) {
      try {
        const out = fn(payload)
        if (out !== undefined && result === undefined) result = out
      } catch (error) {
        log('hook failed', { event: String(event), error: String(error?.message || error) })
      }
    }
    return result
  }

  const route = (desc) => {
    const kind = desc.kind || 'exact'
    // 同 (kind, path) 再登记一次只会让 /meta 里出现两条一样的，实际匹配永远是前一条。
    // 旧实现照单全收，于是文档说"会抛错"、代码却静默重复。
    if (routes.some((r) => r.kind === kind && r.path === desc.path)) {
      log('route 重复登记，已忽略', { kind, path: String(desc.path) })
      return desc
    }
    routes.push({ kind, path: desc.path, note: desc.note || '' })
    return desc
  }

  const describe = () => ({
    name,
    version,
    uptimeMs: Date.now() - startedAt,
    features: [...features.values()],
    hooks: [...hooks.entries()].map(([event, list]) => ({ event, handlers: list.length })),
    routes: routes.slice(),
  })

  return { feature, hook, emit, route, describe, features, hooks }
}
