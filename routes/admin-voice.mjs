/**
 * * 从 brain.mjs 搬出来的路由组
 *
 * 依赖全部注入，模块不自己推导路径 / 不自己持有状态：
 *   ctx / caps / authorized / sendJson / readBody
 */

export function registerVoiceAdminRoutes(deps) {
  const { ctx, caps, authorized, sendJson, voiceSnapshot } = deps

  ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/admin/voice',
    note: '语音引擎状态',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      return sendJson(res, 200, await voiceSnapshot())
    },
  })), 'dsh-chill-with-you-companion: GET /chill/v1/admin/voice')

  const voiceAction = (action, handler) => ctx.effect(() => ctx.webServer.register(caps.route({
    kind: 'exact',
    path: '/chill/v1/admin/voice/' + action,
    note: '语音引擎：' + action,
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const note = await handler()
        return sendJson(res, 200, await voiceSnapshot(note))
      } catch (error) {
        return sendJson(res, 500, Object.assign(await voiceSnapshot(), { ok: false, error: String(error?.message || error) }))
      }
    },
  })), 'dsh-chill-with-you-companion: POST /chill/v1/admin/voice/' + action)
  // brain 里还有 start / stop / restart 三个动词要注册，把注册器交回去，调用点不用改
  return { voiceAction }
}
