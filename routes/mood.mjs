/**
 * 氛围路由（/chill/v1/spark · /chill/v1/ambient）：随机灵感与环境旁白。
 *
 * 依赖全部注入，模块不自己推导路径 / 不自己持有状态：
 *   ctx / caps / authorized / sendJson / readBody / spark / ambientBlock / getAmbient / getAmbientAt / setAmbient
 */

export function registerMoodRoutes(deps) {
  const { ctx, caps, authorized, sendJson, readBody, spark, ambientBlock, getAmbient, getAmbientAt, setAmbient } = deps

  // ---- 让她自己开口说一句（纯闲聊，不掺工作）----
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/spark',
    note: '手动触发一次「她自己想说话」，走完整人设链路并推游戏',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      let force = true
      try {
        const { json } = await readBody(req)
        if (json && json.force === false) force = false   // 传 false 走"自动节拍"的规则（专注中会拒）
      } catch { /* 空 body 就是手动触发 */ }
      const r = await spark(force)
      if (!r) return sendJson(res, 200, { ok: false, reason: force ? '这一轮她没说出话' : '还不该开口（专注中或刚说过）' })
      return sendJson(res, 200, Object.assign({ ok: true }, r))
    },
  })), 'dsh-chill-with-you-companion: POST /chill/v1/spark')

  // ---- 旁边的近况：Host 推来，进聪音自己的对话上下文 ----
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/ambient',
    note: '他那边在干什么（进度概况），由 Host 的观察者定期推来',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
        return sendJson(res, 200, { ok: true, text: getAmbient(), at: getAmbientAt(), fresh: Boolean(ambientBlock()) })
      }
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const { json } = await readBody(req)
        const text = String(json?.text || '').slice(0, 600)
        if (text) {
          setAmbient(text, Date.now())
        } else {
          setAmbient('', 0)
        }
        return sendJson(res, 200, { ok: true, chars: getAmbient().length })
      } catch (error) {
        return sendJson(res, 400, { error: String(error?.message || error) })
      }
    },
  })), 'dsh-chill-with-you-companion: /chill/v1/ambient')
}
