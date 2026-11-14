/**
 * 控制台「模型」页的读写口（`/chill/v1/llm`）。
 *
 * 从 brain.mjs 搬出来的第一组路由。选它打头的原因：handler 只碰注入进来的 llm，
 * 不读也不写 brain 的内部状态（persona / manifest / state 都不碰），所以可以整块搬，
 * 不用先立 owner 对象。后面 persona / characters / assets 那几组同理搬之前要先有 owner。
 */
export function registerPanelRoutes(deps) {
  const { ctx, caps, authorized, sendJson, readBody, llm } = deps

  // ---- 模型供应商：控制台「模型」页的读写口 ----
  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/llm',
    note: '模型供应商：GET 列表 / POST 切换 · 添加 · 删除 · 测试',
    handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const withState = (extra) => Object.assign(
        { ok: true },
        llm.view(),
        // 「当前生效」连同 key 出处一起回，面板才不用猜
        { current: llm.resolve().id, currentKeyFrom: llm.resolve().keyFrom },
        extra || {},
      )
      if (req.method === 'GET') return sendJson(res, 200, withState())
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      let body = {}
      try { body = (await readBody(req)).json || {} } catch { body = {} }
      const action = String(body.action || '')
      if (action === 'activate') {
        const r = llm.activate(body.id)
        return sendJson(res, r.ok ? 200 : 400, withState(r.ok ? {} : { ok: false, error: r.error }))
      }
      if (action === 'add') {
        const r = llm.add(body.provider || body)
        return sendJson(res, r.ok ? 200 : 400, withState(r.ok ? { added: r.id } : { ok: false, error: r.error }))
      }
      if (action === 'remove') {
        const r = llm.remove(body.id)
        return sendJson(res, r.ok ? 200 : 400, withState(r.ok ? {} : { ok: false, error: r.error }))
      }
      if (action === 'test') {
        const probe = await llm.test(body.id)
        return sendJson(res, 200, withState({ probe }))
      }
      return sendJson(res, 400, { error: 'unknown action: ' + action })
    },
  })), 'dsh-chill-with-you-companion: /chill/v1/llm')
}
