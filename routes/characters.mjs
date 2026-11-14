/**
 * 角色卡路由（`/chill/v1/characters`）：列表 / 详情 / 保存 / 新建 / 激活。
 *
 * 激活会改"当前人设"，但人设本体仍归 brain 所有（提示词里大量直接读它）。
 * 所以这里不持有副本，只调注入进来的 setPersona 写回一处——避免"模块里改一份、
 * brain 里读另一份"这种最难查的双份状态。
 */
export function registerCharacterRoutes(deps) {
  const { ctx, caps, authorized, sendJson, readBody, chars, setPersona } = deps

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'prefix',
    path: '/chill/v1/characters',
    note: '角色卡：列表 / 详情 / 保存 / 新建 / 激活',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      let tail = String(req.url || '').split('?')[0].replace('/chill/v1/characters', '').replace(/\/+$/, '')
      const segs = tail.split('/').filter(Boolean).map((s) => {
        try { return decodeURIComponent(s) } catch { return s }
      })
      const method = req.method
      const readJsonBody = async (limit) => {
        const { raw } = await readBody(req, limit)
        const text = String(raw || '').trim()
        if (!text) return {}
        return JSON.parse(text)
      }
      try {
        if (segs.length === 0) {
          if (method === 'GET') return sendJson(res, 200, Object.assign({ ok: true }, await chars.list()))
          if (method === 'POST') {
            const body = await readJsonBody(64 * 1024)
            const out = await chars.create(body)
            if (out.error) return sendJson(res, 400, { ok: false, error: out.error })
            return sendJson(res, 200, { ok: true, card: out.card })
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }
        const id = segs[0]
        if (segs[1] === 'activate') {
          if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
          const card = await chars.activate(id)
          if (!card) return sendJson(res, 404, { ok: false, error: 'no such character' })
          setPersona(card.persona)
          return sendJson(res, 200, { ok: true, active: card.id, name: card.name, chars: card.persona.length })
        }
        if (segs.length !== 1) return sendJson(res, 404, { error: 'not found' })
        if (method === 'GET') {
          const card = await chars.get(id)
          if (!card) return sendJson(res, 404, { ok: false, error: 'no such character' })
          return sendJson(res, 200, { ok: true, card })
        }
        if (method === 'POST') {
          const body = await readJsonBody(512 * 1024)
          delete body.id
          delete body.builtin
          const card = await chars.save(id, body)
          if (!card) return sendJson(res, 404, { ok: false, error: 'no such character' })
          const now = await chars.active()
          if (now && now.id === id) setPersona(now.persona)
          return sendJson(res, 200, { ok: true, card, active: now ? now.id === id : false })
        }
        return sendJson(res, 405, { error: 'method not allowed' })
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: String(error?.message || error) })
      }
    },
  })), 'dsh-chill-with-you-companion: /chill/v1/characters')
}
